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
    this.preChangeTokens = [];
    this.rejectedPreChangeTokens = new Set();
    this.passwordRotationCount = 0;
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
    const session = {
      token: `private-session-token-${sequence}`,
      csrf: `private-csrf-token-${sequence}`,
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
        if (this.preChangeTokens.includes(suppliedToken)) this.rejectedPreChangeTokens.add(suppliedToken);
        return json({ code: "unauthenticated" }, 401);
      }
      return json(this.userPayload(session.csrf));
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
      this.preChangeTokens = [...this.sessions.keys()];
      this.sessions.clear();
      this.user.password = body.newPassword;
      this.passwordRotationCount += 1;
      const replacement = this.createSession();
      return json(this.userPayload(replacement.csrf), 200, this.sessionCookies(replacement));
    }

    if (url.pathname === "/api/auth/logout" && request.method === "POST") {
      const suppliedToken = cookies(request).get("__Host-grihagrid_session");
      const session = this.sessions.get(suppliedToken);
      if (session && request.headers.get("x-csrf-token") !== session.csrf) {
        return json({ code: "csrf_rejected" }, 403);
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
  ]) {
    assert.equal(serialized.includes(secret), false, `evidence leaked ${secret}`);
  }
}

test("account-security canary proves rotation, global old-session revocation, re-login, and logout without secret output", async () => {
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
    secondOldSessionCreated: true,
    passwordRotated: true,
    bothPreChangeSessionsRevoked: true,
    replacementSessionWorks: true,
    oldPasswordRejected: true,
    newPasswordAccepted: true,
    replacementSessionLoggedOut: true,
    newLoginSessionLoggedOut: true,
  });
  assert.deepEqual(result.cleanup, { logoutAttempts: 2, logoutAcknowledged: 2, logoutFailures: 0 });
  assert.equal(result.failurePhase, null);
  assert.equal(result.requestCount, 14);
  assert.equal(result.checks.length, result.requestCount);
  assert.ok(result.checks.length <= 32);
  assert.deepEqual(server.preChangeTokens.length, 2);
  assert.equal(server.rejectedPreChangeTokens.size, 2);
  assert.equal(server.passwordRotationCount, 1);
  assert.equal(server.sessions.size, 0);
  assert.equal(server.user.password, NEXT_PASSWORD);
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

test("rotation failures return bounded evidence and best-effort logout every working session", async () => {
  const server = new FakeAccountSecurityServer({ failure: "password_rotation" });
  await assert.rejects(
    () => runAccountSecurityCanary(ORIGIN, credentials(), options(server)),
    (error) => {
      const evidence = evidenceFrom(error);
      assert.equal(error.message, "account-security canary failed during password_rotation");
      assert.equal(evidence.outcome, "failed");
      assert.equal(evidence.failurePhase, "password_rotation");
      assert.equal(evidence.proofs.accountRegistered, true);
      assert.equal(evidence.proofs.secondOldSessionCreated, true);
      assert.equal(evidence.proofs.passwordRotated, false);
      assert.deepEqual(evidence.cleanup, { logoutAttempts: 2, logoutAcknowledged: 2, logoutFailures: 0 });
      assert.equal(evidence.externalAccountCleanupRequired, true);
      assert.equal(evidence.requestCount, 7);
      assertNoSecretMaterial(error);
      return true;
    },
  );
  assert.equal(server.sessions.size, 0);
  assert.equal(server.user.password, INITIAL_PASSWORD);
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
