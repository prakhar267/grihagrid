import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runAccountSecurityCanary } from "../scripts/account-security-canary.mjs";

const ORIGIN = "https://account-security.example.test";
const WORKER_VERSION = "11111111-1111-4111-8111-111111111111";
const OTHER_WORKER_VERSION = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const EMAIL = "release-canary-unique@example.test";
const INITIAL_PASSWORD = "Initial password kept private 2026!";
const NEXT_PASSWORD = "Rotated password kept private 2026!";
const scriptPath = fileURLToPath(new URL("../scripts/account-security-canary.mjs", import.meta.url));

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sqliteTimestamp(epochMs) {
  return new Date(epochMs).toISOString().slice(0, 19).replace("T", " ");
}

function cookies(request) {
  const values = new Map();
  for (const part of (request.headers.get("cookie") || "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    values.set(part.slice(0, separator).trim(), part.slice(separator + 1).trim());
  }
  return values;
}

function json(payload, status = 200, setCookies = []) {
  const headers = new Headers({ "content-type": "application/json" });
  for (const value of setCookies) headers.append("set-cookie", value);
  return new Response(JSON.stringify(payload), { status, headers });
}

function empty(status, setCookies = []) {
  const headers = new Headers();
  for (const value of setCookies) headers.append("set-cookie", value);
  return new Response(null, { status, headers });
}

class FakeAccountSecurityServer {
  constructor({ workerVersion = WORKER_VERSION, failure = "" } = {}) {
    this.workerVersion = workerVersion;
    this.failure = failure;
    this.user = null;
    this.sessions = new Map();
    this.nextSession = 1;
    this.requests = [];
    this.sessionReviewCount = 0;
    this.preRevokeTokens = [];
    this.rejectedPreRevokeTokens = new Set();
    this.prePasswordTokens = [];
    this.rejectedPrePasswordTokens = new Set();
    this.sessionRevocationCount = 0;
    this.passwordRotationCount = 0;
    this.logoutRequestCount = 0;
  }

  sessionCookies(session, clear = false) {
    const suffix = "Path=/; Secure; SameSite=Strict";
    return clear
      ? [
          `__Host-grihagrid_session=; Max-Age=0; HttpOnly; ${suffix}`,
          `grihagrid_csrf=; Max-Age=0; ${suffix}`,
        ]
      : [
          `__Host-grihagrid_session=${session.token}; HttpOnly; ${suffix}`,
          `grihagrid_csrf=${session.csrf}; ${suffix}`,
        ];
  }

  createSession() {
    const sequence = this.nextSession;
    this.nextSession += 1;
    const now = Date.now();
    const session = {
      token: `private-session-token-${sequence}`,
      csrf: `private-csrf-token-${sequence}`,
      startedAt: sqliteTimestamp(now - sequence * 1_000),
      expiresAt: sqliteTimestamp(now + 7 * 24 * 60 * 60 * 1_000),
    };
    this.sessions.set(session.token, session);
    return session;
  }

  authenticated(request) {
    return this.sessions.get(cookies(request).get("__Host-grihagrid_session"));
  }

  userPayload(csrfToken) {
    return {
      user: { id: USER_ID, email: this.user.email, name: "Account Security Release Canary" },
      csrfToken,
    };
  }

  publicSession(session, current) {
    return {
      current,
      startedAt: session.startedAt,
      expiresAt: session.expiresAt,
    };
  }

  async fetch(input, init = {}) {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const body = request.method === "GET" || request.method === "HEAD"
      ? null
      : JSON.parse(await request.text() || "{}");
    this.requests.push({ method: request.method, path: url.pathname, body });

    if (url.pathname === "/api/readiness" && request.method === "GET") {
      return json({
        status: "ready",
        releaseId: this.workerVersion,
        checks: { authSchema: "current" },
        capabilities: {
          accountSecurity: true,
          paidCheckout: false,
          paidFulfillment: false,
          privateUploads: false,
        },
      });
    }

    if (url.pathname === "/api/auth/register" && request.method === "POST") {
      if (this.failure === "registration_network") {
        throw new Error(`network exposed ${body.password} private-session-token-network`);
      }
      if (request.headers.get("origin") !== ORIGIN || this.user) {
        return json({ code: this.user ? "email_in_use" : "origin_rejected" }, this.user ? 409 : 403);
      }
      this.user = { id: USER_ID, email: body.email, password: body.password };
      const session = this.createSession();
      return json(this.userPayload(session.csrf), 201, this.sessionCookies(session));
    }

    if (url.pathname === "/api/auth/login" && request.method === "POST") {
      if (!this.user || body.email !== this.user.email || body.password !== this.user.password) {
        return json({ code: "invalid_credentials" }, 401);
      }
      const session = this.createSession();
      return json(this.userPayload(session.csrf), 200, this.sessionCookies(session));
    }

    if (url.pathname === "/api/auth/me" && request.method === "GET") {
      const suppliedToken = cookies(request).get("__Host-grihagrid_session");
      const session = this.authenticated(request);
      if (!session) {
        if (this.preRevokeTokens.includes(suppliedToken)) this.rejectedPreRevokeTokens.add(suppliedToken);
        if (this.prePasswordTokens.includes(suppliedToken)) this.rejectedPrePasswordTokens.add(suppliedToken);
        return json({ code: "unauthenticated" }, 401);
      }
      return json(this.userPayload(session.csrf));
    }

    if (url.pathname === "/api/auth/sessions" && request.method === "GET") {
      const suppliedToken = cookies(request).get("__Host-grihagrid_session");
      const session = this.authenticated(request);
      if (!session) return json({ code: "unauthenticated" }, 401);
      this.sessionReviewCount += 1;
      let reviewedSessions = [
        this.publicSession(session, true),
        ...[...this.sessions.values()]
          .filter((candidate) => candidate.token !== suppliedToken)
          .map((candidate) => this.publicSession(candidate, false)),
      ];
      if (this.failure === "pre_session_review_identifier" && this.sessionReviewCount === 1) {
        reviewedSessions[0].sessionId = "private-session-identifier";
      }
      if (this.failure === "pre_session_review_order" && this.sessionReviewCount === 1) {
        reviewedSessions = reviewedSessions.reverse();
      }
      if (this.failure === "pre_session_review_expired" && this.sessionReviewCount === 1) {
        reviewedSessions[1].expiresAt = "2020-01-02 00:00:00";
      }
      if (this.failure === "post_session_review_identifier" && this.sessionReviewCount === 2) {
        reviewedSessions[1].sessionId = "private-session-identifier";
      }
      return json({ sessions: reviewedSessions, hasMore: false });
    }

    if (url.pathname === "/api/auth/sessions/revoke-others" && request.method === "POST") {
      const session = this.authenticated(request);
      const requestCookies = cookies(request);
      if (!session
          || request.headers.get("origin") !== ORIGIN
          || request.headers.get("x-csrf-token") !== session.csrf
          || requestCookies.get("grihagrid_csrf") !== session.csrf) {
        return json({ code: "csrf_rejected" }, 403);
      }
      if (this.failure === "session_revocation") {
        return json({
          code: "private_failure",
          password: body.currentPassword,
          cookie: request.headers.get("cookie"),
          userId: USER_ID,
        }, 500);
      }
      if (body.currentPassword !== this.user.password) {
        return json({ code: "current_password_incorrect" }, 401);
      }
      if (this.failure === "session_revocation_no_rotation") {
        return json({
          ...this.userPayload(session.csrf),
          sessions: [this.publicSession(session, true)],
          hasMore: false,
        });
      }
      this.preRevokeTokens = [...this.sessions.keys()];
      if (this.failure === "session_revocation_retains_current") {
        this.sessions.clear();
        this.sessions.set(session.token, session);
      } else {
        this.sessions.clear();
      }
      this.sessionRevocationCount += 1;
      const replacement = this.createSession();
      return json({
        ...this.userPayload(replacement.csrf),
        sessions: [this.publicSession(replacement, true)],
        hasMore: false,
      }, 200, this.sessionCookies(replacement));
    }

    if (url.pathname === "/api/auth/password" && request.method === "PUT") {
      const session = this.authenticated(request);
      const requestCookies = cookies(request);
      if (!session
          || request.headers.get("origin") !== ORIGIN
          || request.headers.get("x-csrf-token") !== session.csrf
          || requestCookies.get("grihagrid_csrf") !== session.csrf) {
        return json({ code: "csrf_rejected" }, 403);
      }
      if (this.failure === "password_rotation") {
        return json({
          code: "private_failure",
          password: body.newPassword,
          cookie: request.headers.get("cookie"),
          sessionId: session.token,
        }, 500);
      }
      if (body.currentPassword !== this.user.password) {
        return json({ code: "current_password_incorrect" }, 401);
      }
      this.prePasswordTokens = [...this.sessions.keys()];
      if (this.failure === "password_rotation_retains_current") {
        this.sessions.clear();
        this.sessions.set(session.token, session);
      } else {
        this.sessions.clear();
      }
      this.user.password = body.newPassword;
      this.passwordRotationCount += 1;
      const replacement = this.createSession();
      return json(this.userPayload(replacement.csrf), 200, this.sessionCookies(replacement));
    }

    if (url.pathname === "/api/auth/logout" && request.method === "POST") {
      this.logoutRequestCount += 1;
      const suppliedToken = cookies(request).get("__Host-grihagrid_session");
      const session = this.sessions.get(suppliedToken);
      if (session && request.headers.get("x-csrf-token") !== session.csrf) {
        return json({ code: "csrf_rejected" }, 403);
      }
      if ((this.failure === "logout_once" && this.logoutRequestCount === 1)
          || (this.failure === "second_logout_once" && this.logoutRequestCount === 2)) {
        return json({
          code: "private_failure",
          cookie: request.headers.get("cookie"),
          userId: USER_ID,
        }, 500);
      }
      if (this.failure === "logout_retains_session" && this.logoutRequestCount === 1) {
        return empty(204, this.sessionCookies(null, true));
      }
      this.sessions.delete(suppliedToken);
      return empty(204, this.sessionCookies(null, true));
    }

    return json({ code: "not_found" }, 404);
  }
}

function options(server, extra = {}) {
  return {
    expectedWorkerVersion: WORKER_VERSION,
    fetch: server.fetch.bind(server),
    passwordFactory: () => NEXT_PASSWORD,
    ...extra,
  };
}

function credentials(extra = {}) {
  return { email: EMAIL, initialPassword: INITIAL_PASSWORD, ...extra };
}

function evidenceFrom(error) {
  assert.equal(error?.name, "AccountSecurityCanaryError");
  assert.ok(error.releaseEvidence);
  return error.releaseEvidence;
}

function assertNoSecretMaterial(value) {
  const serialized = JSON.stringify(value);
  for (const secret of [
    EMAIL,
    INITIAL_PASSWORD,
    NEXT_PASSWORD,
    USER_ID,
    "private-session-token",
    "private-csrf-token",
    "private-session-identifier",
  ]) {
    assert.equal(serialized.includes(secret), false, `evidence leaked ${secret}`);
  }
}

test("account-security canary proves identifier-free review, revoke-others, password rotation, and logout without secret output", async () => {
  const server = new FakeAccountSecurityServer();
  const result = await runAccountSecurityCanary(ORIGIN, credentials(), options(server));

  assert.equal(result.outcome, "passed");
  assert.equal(result.origin, ORIGIN);
  assert.equal(result.expectedWorkerVersion, WORKER_VERSION);
  assert.equal(result.observedWorkerVersion, WORKER_VERSION);
  assert.equal(result.accountLocator.normalizedEmailSha256, digest(EMAIL));
  assert.equal(result.accountLocator.registeredUserIdSha256, digest(USER_ID));
  assert.equal(result.accountLocator.identityVerified, true);
  assert.equal(result.externalAccountCleanupRequired, true);
  assert.deepEqual(result.proofs, {
    workerVersionMatched: true,
    accountSecurityReady: true,
    launchControlsClosed: true,
    accountRegistered: true,
    accountIdentityVerified: true,
    secondPreBoundarySessionCreated: true,
    preBoundarySessionsListedIdentifierFree: true,
    revokeOthersBoundaryRotated: true,
    bothPreBoundarySessionsRevoked: true,
    revokeReplacementSessionWorks: true,
    unchangedPasswordCreatedPostBoundarySession: true,
    postBoundarySessionsListedIdentifierFree: true,
    passwordRotated: true,
    bothPrePasswordChangeSessionsRevoked: true,
    passwordReplacementSessionWorks: true,
    oldPasswordRejected: true,
    newPasswordAccepted: true,
    passwordReplacementSessionLoggedOut: true,
    newPasswordSessionLoggedOut: true,
  });
  assert.deepEqual(result.cleanup, { logoutAttempts: 2, logoutAcknowledged: 2, logoutFailures: 0 });
  assert.equal(result.failurePhase, null);
  assert.equal(result.requestCount, 21);
  assert.equal(result.checks.length, result.requestCount);
  assert.ok(result.checks.length <= 32);
  assert.deepEqual(result.checks.map((check) => check.name), [
    "readiness",
    "register",
    "registered_session_identity",
    "second_pre_boundary_login",
    "pre_boundary_session_review",
    "revoke_other_sessions",
    "first_pre_boundary_session_rejected",
    "second_pre_boundary_session_rejected",
    "revoke_replacement_session_identity",
    "unchanged_password_post_boundary_login",
    "post_boundary_session_review",
    "password_rotation",
    "first_pre_password_change_session_rejected",
    "second_pre_password_change_session_rejected",
    "password_replacement_session_identity",
    "old_password_rejected",
    "new_password_accepted",
    "password_replacement_session_logout",
    "password_replacement_session_logout_replay",
    "new_password_session_logout",
    "new_password_session_logout_replay",
  ]);
  assert.equal(server.sessionReviewCount, 2);
  assert.equal(server.sessionRevocationCount, 1);
  assert.equal(server.preRevokeTokens.length, 2);
  assert.equal(server.rejectedPreRevokeTokens.size, 2);
  assert.equal(server.prePasswordTokens.length, 2);
  assert.equal(server.rejectedPrePasswordTokens.size, 2);
  assert.equal(server.passwordRotationCount, 1);
  assert.equal(server.sessions.size, 0);
  assert.equal(server.user.password, NEXT_PASSWORD);
  assert.deepEqual(
    server.requests
      .filter((request) => request.path === "/api/auth/sessions")
      .map(({ method, path, body }) => ({ method, path, body })),
    [
      { method: "GET", path: "/api/auth/sessions", body: null },
      { method: "GET", path: "/api/auth/sessions", body: null },
    ],
  );
  const revokeRequests = server.requests.filter((request) => request.path === "/api/auth/sessions/revoke-others");
  assert.deepEqual(revokeRequests, [{
    method: "POST",
    path: "/api/auth/sessions/revoke-others",
    body: { currentPassword: INITIAL_PASSWORD },
  }]);
  assertNoSecretMaterial(result);
});

test("a wrong Worker version stops before creating a synthetic account", async () => {
  const server = new FakeAccountSecurityServer({ workerVersion: OTHER_WORKER_VERSION });
  await assert.rejects(
    () => runAccountSecurityCanary(ORIGIN, credentials(), options(server)),
    (error) => {
      const evidence = evidenceFrom(error);
      assert.equal(error.message, "account-security canary failed during readiness");
      assert.equal(evidence.outcome, "failed");
      assert.equal(evidence.failurePhase, "readiness");
      assert.equal(evidence.observedWorkerVersion, OTHER_WORKER_VERSION);
      assert.equal(evidence.proofs.workerVersionMatched, false);
      assert.equal(evidence.externalAccountCleanupRequired, false);
      assert.equal(evidence.requestCount, 1);
      assertNoSecretMaterial(error);
      return true;
    },
  );
  assert.equal(server.user, null);
  assert.equal(server.sessions.size, 0);
});

test("pre-boundary review fails closed on identifiers, expired entries, or non-current-first ordering and cleans up", async () => {
  for (const failure of [
    "pre_session_review_identifier",
    "pre_session_review_expired",
    "pre_session_review_order",
  ]) {
    const server = new FakeAccountSecurityServer({ failure });
    await assert.rejects(
      () => runAccountSecurityCanary(ORIGIN, credentials(), options(server)),
      (error) => {
        const evidence = evidenceFrom(error);
        assert.equal(error.message, "account-security canary failed during pre_boundary_session_review");
        assert.equal(evidence.failurePhase, "pre_boundary_session_review");
        assert.equal(evidence.proofs.secondPreBoundarySessionCreated, true);
        assert.equal(evidence.proofs.preBoundarySessionsListedIdentifierFree, false);
        assert.equal(evidence.proofs.revokeOthersBoundaryRotated, false);
        assert.deepEqual(evidence.cleanup, { logoutAttempts: 2, logoutAcknowledged: 2, logoutFailures: 0 });
        assert.equal(evidence.requestCount, 7);
        assertNoSecretMaterial(error);
        return true;
      },
    );
    assert.equal(server.sessions.size, 0);
    assert.equal(server.sessionRevocationCount, 0);
  }
});

test("revoke-others failures and missing cookie rotation stay bounded and clean up both pre-boundary sessions", async () => {
  for (const failure of ["session_revocation", "session_revocation_no_rotation"]) {
    const server = new FakeAccountSecurityServer({ failure });
    await assert.rejects(
      () => runAccountSecurityCanary(ORIGIN, credentials(), options(server)),
      (error) => {
        const evidence = evidenceFrom(error);
        assert.equal(error.message, "account-security canary failed during revoke_other_sessions");
        assert.equal(evidence.failurePhase, "revoke_other_sessions");
        assert.equal(evidence.proofs.preBoundarySessionsListedIdentifierFree, true);
        assert.equal(evidence.proofs.revokeOthersBoundaryRotated, false);
        assert.equal(evidence.proofs.bothPreBoundarySessionsRevoked, false);
        assert.deepEqual(evidence.cleanup, { logoutAttempts: 2, logoutAcknowledged: 2, logoutFailures: 0 });
        assert.equal(evidence.requestCount, 8);
        assertNoSecretMaterial(error);
        return true;
      },
    );
    assert.equal(server.sessions.size, 0);
  }
});

test("a rotated revoke response that retains the prior current cookie fails closed and logs out every represented jar", async () => {
  const server = new FakeAccountSecurityServer({ failure: "session_revocation_retains_current" });
  await assert.rejects(
    () => runAccountSecurityCanary(ORIGIN, credentials(), options(server)),
    (error) => {
      const evidence = evidenceFrom(error);
      assert.equal(error.message, "account-security canary failed during first_pre_boundary_session_rejected");
      assert.equal(evidence.failurePhase, "first_pre_boundary_session_rejected");
      assert.equal(evidence.proofs.revokeOthersBoundaryRotated, true);
      assert.equal(evidence.proofs.bothPreBoundarySessionsRevoked, false);
      assert.deepEqual(evidence.cleanup, { logoutAttempts: 3, logoutAcknowledged: 3, logoutFailures: 0 });
      assert.equal(evidence.requestCount, 10);
      assertNoSecretMaterial(error);
      return true;
    },
  );
  assert.equal(server.sessions.size, 0);
  assert.equal(server.logoutRequestCount, 3);
});

test("post-boundary review rejects identifier-bearing session entries and logs out both live jars", async () => {
  const server = new FakeAccountSecurityServer({ failure: "post_session_review_identifier" });
  await assert.rejects(
    () => runAccountSecurityCanary(ORIGIN, credentials(), options(server)),
    (error) => {
      const evidence = evidenceFrom(error);
      assert.equal(error.message, "account-security canary failed during post_boundary_session_review");
      assert.equal(evidence.failurePhase, "post_boundary_session_review");
      assert.equal(evidence.proofs.revokeOthersBoundaryRotated, true);
      assert.equal(evidence.proofs.bothPreBoundarySessionsRevoked, true);
      assert.equal(evidence.proofs.unchangedPasswordCreatedPostBoundarySession, true);
      assert.equal(evidence.proofs.postBoundarySessionsListedIdentifierFree, false);
      assert.equal(evidence.proofs.passwordRotated, false);
      assert.deepEqual(evidence.cleanup, { logoutAttempts: 2, logoutAcknowledged: 2, logoutFailures: 0 });
      assert.equal(evidence.requestCount, 13);
      assertNoSecretMaterial(error);
      return true;
    },
  );
  assert.equal(server.sessions.size, 0);
  assert.equal(server.user.password, INITIAL_PASSWORD);
});

test("password-rotation failures after revoke-others return bounded evidence and logout every live session", async () => {
  const server = new FakeAccountSecurityServer({ failure: "password_rotation" });
  await assert.rejects(
    () => runAccountSecurityCanary(ORIGIN, credentials(), options(server)),
    (error) => {
      const evidence = evidenceFrom(error);
      assert.equal(error.message, "account-security canary failed during password_rotation");
      assert.equal(evidence.outcome, "failed");
      assert.equal(evidence.failurePhase, "password_rotation");
      assert.equal(evidence.proofs.accountRegistered, true);
      assert.equal(evidence.proofs.preBoundarySessionsListedIdentifierFree, true);
      assert.equal(evidence.proofs.revokeOthersBoundaryRotated, true);
      assert.equal(evidence.proofs.bothPreBoundarySessionsRevoked, true);
      assert.equal(evidence.proofs.unchangedPasswordCreatedPostBoundarySession, true);
      assert.equal(evidence.proofs.postBoundarySessionsListedIdentifierFree, true);
      assert.equal(evidence.proofs.passwordRotated, false);
      assert.deepEqual(evidence.cleanup, { logoutAttempts: 2, logoutAcknowledged: 2, logoutFailures: 0 });
      assert.equal(evidence.externalAccountCleanupRequired, true);
      assert.equal(evidence.requestCount, 14);
      assertNoSecretMaterial(error);
      return true;
    },
  );
  assert.equal(server.sessions.size, 0);
  assert.equal(server.user.password, INITIAL_PASSWORD);
});

test("a rotated password response that retains its prior current cookie fails closed and cleans every represented jar", async () => {
  const server = new FakeAccountSecurityServer({ failure: "password_rotation_retains_current" });
  await assert.rejects(
    () => runAccountSecurityCanary(ORIGIN, credentials(), options(server)),
    (error) => {
      const evidence = evidenceFrom(error);
      assert.equal(error.message, "account-security canary failed during first_pre_password_change_session_rejected");
      assert.equal(evidence.failurePhase, "first_pre_password_change_session_rejected");
      assert.equal(evidence.proofs.passwordRotated, true);
      assert.equal(evidence.proofs.bothPrePasswordChangeSessionsRevoked, false);
      assert.deepEqual(evidence.cleanup, { logoutAttempts: 3, logoutAcknowledged: 3, logoutFailures: 0 });
      assert.equal(evidence.requestCount, 16);
      assertNoSecretMaterial(error);
      return true;
    },
  );
  assert.equal(server.sessions.size, 0);
  assert.equal(server.user.password, NEXT_PASSWORD);
  assert.equal(server.logoutRequestCount, 3);
});

test("a failed explicit logout is counted and each distinct live session is retried during cleanup", async () => {
  const server = new FakeAccountSecurityServer({ failure: "logout_once" });
  await assert.rejects(
    () => runAccountSecurityCanary(ORIGIN, credentials(), options(server)),
    (error) => {
      const evidence = evidenceFrom(error);
      assert.equal(error.message, "account-security canary failed during password_replacement_session_logout");
      assert.equal(evidence.failurePhase, "password_replacement_session_logout");
      assert.equal(evidence.proofs.newPasswordAccepted, true);
      assert.equal(evidence.proofs.passwordReplacementSessionLoggedOut, false);
      assert.equal(evidence.proofs.newPasswordSessionLoggedOut, false);
      assert.deepEqual(evidence.cleanup, { logoutAttempts: 3, logoutAcknowledged: 2, logoutFailures: 1 });
      assert.equal(evidence.requestCount, 20);
      assertNoSecretMaterial(error);
      return true;
    },
  );
  assert.equal(server.sessions.size, 0);
  assert.equal(server.logoutRequestCount, 3);
});

test("a logout acknowledgement that retains the session is caught by replay and the replay jar is cleaned", async () => {
  const server = new FakeAccountSecurityServer({ failure: "logout_retains_session" });
  await assert.rejects(
    () => runAccountSecurityCanary(ORIGIN, credentials(), options(server)),
    (error) => {
      const evidence = evidenceFrom(error);
      assert.equal(error.message, "account-security canary failed during password_replacement_session_logout_replay");
      assert.equal(evidence.failurePhase, "password_replacement_session_logout_replay");
      assert.equal(evidence.proofs.newPasswordAccepted, true);
      assert.equal(evidence.proofs.passwordReplacementSessionLoggedOut, false);
      assert.equal(evidence.proofs.newPasswordSessionLoggedOut, false);
      assert.deepEqual(evidence.cleanup, { logoutAttempts: 3, logoutAcknowledged: 3, logoutFailures: 0 });
      assert.equal(evidence.requestCount, 21);
      assertNoSecretMaterial(error);
      return true;
    },
  );
  assert.equal(server.sessions.size, 0);
  assert.equal(server.logoutRequestCount, 3);
});

test("a failed second explicit logout keeps its replay jar available for exact cleanup", async () => {
  const server = new FakeAccountSecurityServer({ failure: "second_logout_once" });
  await assert.rejects(
    () => runAccountSecurityCanary(ORIGIN, credentials(), options(server)),
    (error) => {
      const evidence = evidenceFrom(error);
      assert.equal(error.message, "account-security canary failed during new_password_session_logout");
      assert.equal(evidence.failurePhase, "new_password_session_logout");
      assert.equal(evidence.proofs.passwordReplacementSessionLoggedOut, true);
      assert.equal(evidence.proofs.newPasswordSessionLoggedOut, false);
      assert.deepEqual(evidence.cleanup, { logoutAttempts: 3, logoutAcknowledged: 2, logoutFailures: 1 });
      assert.equal(evidence.requestCount, 21);
      assertNoSecretMaterial(error);
      return true;
    },
  );
  assert.equal(server.sessions.size, 0);
  assert.equal(server.logoutRequestCount, 3);
});

test("an ambiguous registration network failure never echoes the thrown secret and flags exact external cleanup", async () => {
  const server = new FakeAccountSecurityServer({ failure: "registration_network" });
  await assert.rejects(
    () => runAccountSecurityCanary(ORIGIN, credentials(), options(server)),
    (error) => {
      const evidence = evidenceFrom(error);
      assert.equal(error.message, "account-security canary failed during register");
      assert.equal(evidence.failurePhase, "register");
      assert.equal(evidence.externalAccountCleanupRequired, true);
      assert.equal(evidence.accountLocator.normalizedEmailSha256, digest(EMAIL));
      assert.equal(evidence.accountLocator.registeredUserIdSha256, null);
      assert.equal(evidence.requestCount, 2);
      assert.equal(evidence.checks[1].status, null);
      assertNoSecretMaterial(error);
      return true;
    },
  );
});

test("unsafe inputs fail before fetch and still expose redacted bounded evidence", async () => {
  let fetchCount = 0;
  const neverFetch = async () => {
    fetchCount += 1;
    throw new Error("must not fetch");
  };
  const cases = [
    ["http://account-security.example.test", credentials(), { fetch: neverFetch }],
    ["https://user:password@account-security.example.test", credentials(), { fetch: neverFetch }],
    [ORIGIN, credentials({ email: "not-an-email" }), { fetch: neverFetch }],
    [ORIGIN, credentials({ initialPassword: "short" }), { fetch: neverFetch }],
    [ORIGIN, credentials(), { fetch: neverFetch, expectedWorkerVersion: "main" }],
    [ORIGIN, credentials(), { fetch: neverFetch, timeoutMs: 0 }],
    [ORIGIN, credentials(), { fetch: "not-a-function" }],
  ];

  for (const [origin, suppliedCredentials, suppliedOptions] of cases) {
    await assert.rejects(
      () => runAccountSecurityCanary(origin, suppliedCredentials, suppliedOptions),
      (error) => {
        const evidence = evidenceFrom(error);
        assert.equal(error.message, "account-security canary failed during input_validation");
        assert.equal(evidence.outcome, "failed");
        assert.equal(evidence.failurePhase, "input_validation");
        assert.equal(evidence.requestCount, 0);
        assert.equal(evidence.externalAccountCleanupRequired, false);
        assertNoSecretMaterial(error);
        return true;
      },
    );
  }
  assert.equal(fetchCount, 0);
});

test("the password factory cannot reuse the current password or emit an unsupported shape", async () => {
  const server = new FakeAccountSecurityServer();
  let attempts = 0;
  await assert.rejects(
    () => runAccountSecurityCanary(ORIGIN, credentials(), options(server, {
      passwordFactory: () => {
        attempts += 1;
        return attempts === 1 ? INITIAL_PASSWORD : "short";
      },
    })),
    (error) => {
      const evidence = evidenceFrom(error);
      assert.equal(error.message, "account-security canary failed during password_generation");
      assert.equal(evidence.failurePhase, "password_generation");
      assert.equal(evidence.requestCount, 0);
      assert.equal(evidence.externalAccountCleanupRequired, false);
      assertNoSecretMaterial(error);
      return true;
    },
  );
  assert.equal(attempts, 3);
  assert.equal(server.user, null);
});

test("the CLI prints bounded JSON evidence and a fixed safe error on failure", () => {
  const cliPassword = "CLI password must never be printed 2026!";
  const cliEmail = "cli-secret-email@example.test";
  const result = spawnSync(process.execPath, [scriptPath, "http://unsafe.example.test"], {
    encoding: "utf8",
    env: {
      ...process.env,
      GRIHAGRID_ACCOUNT_SECURITY_EMAIL: cliEmail,
      GRIHAGRID_ACCOUNT_SECURITY_INITIAL_PASSWORD: cliPassword,
      EXPECT_WORKER_VERSION: WORKER_VERSION,
    },
  });

  assert.equal(result.status, 1);
  assert.equal(result.signal, null);
  assert.equal(result.stderr, "account-security canary failed during input_validation\n");
  const evidence = JSON.parse(result.stdout);
  assert.equal(evidence.outcome, "failed");
  assert.equal(evidence.failurePhase, "input_validation");
  assert.equal(evidence.requestCount, 0);
  assert.equal(result.stdout.includes(cliPassword), false);
  assert.equal(result.stdout.includes(cliEmail), false);
  assert.equal(result.stderr.includes(cliPassword), false);
  assert.equal(result.stderr.includes(cliEmail), false);
});
