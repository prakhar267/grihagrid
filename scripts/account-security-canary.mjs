#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RECORDED_CHECKS = 32;
const SESSION_COOKIE = "__Host-grihagrid_session";
const CSRF_COOKIE = "grihagrid_csrf";
const WORKER_VERSION_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SQLITE_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u;

class AccountSecurityCanaryError extends Error {
  constructor(phase) {
    super(`account-security canary failed during ${phase}`);
    this.name = "AccountSecurityCanaryError";
    this.phase = phase;
  }
}

function isDirectExecution() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    process.stderr.write("account-security canary failed during entrypoint_resolution\n");
    process.exitCode = 1;
    return false;
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalOrigin(raw) {
  let origin;
  try {
    origin = new URL(String(raw || ""));
  } catch {
    throw new AccountSecurityCanaryError("input_validation");
  }
  if (origin.protocol !== "https:" || origin.username || origin.password) {
    throw new AccountSecurityCanaryError("input_validation");
  }
  origin.pathname = "/";
  origin.search = "";
  origin.hash = "";
  return origin;
}

function normalizeInputs(credentials, options) {
  const email = typeof credentials?.email === "string" ? credentials.email.trim().toLowerCase() : "";
  const initialPassword = typeof credentials?.initialPassword === "string" ? credentials.initialPassword : "";
  const expectedWorkerVersion = options.expectedWorkerVersion == null
    ? ""
    : String(options.expectedWorkerVersion).trim();
  const timeoutMs = options.timeoutMs == null ? DEFAULT_TIMEOUT_MS : Number(options.timeoutMs);
  if (email.length < 3 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    throw new AccountSecurityCanaryError("input_validation");
  }
  if (initialPassword.length < 10 || initialPassword.length > 128) {
    throw new AccountSecurityCanaryError("input_validation");
  }
  if (expectedWorkerVersion && !WORKER_VERSION_PATTERN.test(expectedWorkerVersion)) {
    throw new AccountSecurityCanaryError("input_validation");
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new AccountSecurityCanaryError("input_validation");
  }
  if (options.fetch !== undefined && typeof options.fetch !== "function") {
    throw new AccountSecurityCanaryError("input_validation");
  }
  if (options.passwordFactory !== undefined && typeof options.passwordFactory !== "function") {
    throw new AccountSecurityCanaryError("input_validation");
  }
  return { email, initialPassword, expectedWorkerVersion, timeoutMs };
}

function generatedPassword(passwordFactory, initialPassword) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const candidate = passwordFactory
      ? passwordFactory()
      : `Gg!${randomUUID()}-${randomUUID()}`;
    if (typeof candidate === "string"
        && candidate.length >= 10
        && candidate.length <= 128
        && candidate !== initialPassword) {
      return candidate;
    }
  }
  throw new AccountSecurityCanaryError("password_generation");
}

function setCookieValues(response) {
  if (typeof response.headers.getSetCookie === "function") return response.headers.getSetCookie();
  const combined = response.headers.get("set-cookie");
  return combined ? [combined] : [];
}

function mergeCookies(jar, response) {
  for (const header of setCookieValues(response)) {
    const pairs = String(header).match(/(?:^|,\s*)([^=;,\s]+)=([^;,]*)/gu) || [];
    for (const entry of pairs) {
      const pair = entry.replace(/^,\s*/u, "").split(";", 1)[0];
      const separator = pair.indexOf("=");
      if (separator < 1) continue;
      const name = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      if (value) jar.set(name, value);
      else jar.delete(name);
    }
  }
}

function cookieHeader(jar) {
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

function csrfToken(jar) {
  const value = jar.get(CSRF_COOKIE) || "";
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

function hasAuthentication(jar) {
  return Boolean(jar.get(SESSION_COOKIE) && csrfToken(jar));
}

function sameAccount(payload, email, userId = "") {
  const payloadEmail = typeof payload?.user?.email === "string" ? payload.user.email.trim().toLowerCase() : "";
  const payloadUserId = typeof payload?.user?.id === "string" ? payload.user.id : "";
  return payloadEmail === email && Boolean(payloadUserId) && (!userId || payloadUserId === userId);
}

function safeFailure(phase) {
  return new AccountSecurityCanaryError(phase || "unknown");
}

export async function runAccountSecurityCanary(rawOrigin, credentials, options = {}) {
  const startedAt = new Date().toISOString();
  const checks = [];
  const proofs = {
    workerVersionMatched: false,
    accountSecurityReady: false,
    launchControlsClosed: false,
    accountRegistered: false,
    accountIdentityVerified: false,
    secondPreBoundarySessionCreated: false,
    preBoundarySessionsListedIdentifierFree: false,
    revokeOthersBoundaryRotated: false,
    bothPreBoundarySessionsRevoked: false,
    revokeReplacementSessionWorks: false,
    unchangedPasswordCreatedPostBoundarySession: false,
    postBoundarySessionsListedIdentifierFree: false,
    passwordRotated: false,
    bothPrePasswordChangeSessionsRevoked: false,
    passwordReplacementSessionWorks: false,
    oldPasswordRejected: false,
    newPasswordAccepted: false,
    passwordReplacementSessionLoggedOut: false,
    newPasswordSessionLoggedOut: false,
  };
  const cleanup = {
    logoutAttempts: 0,
    logoutAcknowledged: 0,
    logoutFailures: 0,
  };
  let requestCount = 0;
  let origin = null;
  let normalizedEmail = "";
  let expectedWorkerVersion = "";
  let observedWorkerVersion = "";
  let registeredUserId = "";
  let registrationAttempted = false;
  let phase = "input_validation";
  let primaryError = null;
  const primaryJar = new Map();
  const secondPreBoundaryJar = new Map();
  const postBoundaryJar = new Map();
  const newPasswordJar = new Map();
  const capturedPrimaryPreBoundaryJar = new Map();
  const capturedPrimaryPrePasswordChangeJar = new Map();
  const passwordReplacementLogoutReplayJar = new Map();
  const newPasswordLogoutReplayJar = new Map();

  function recordCheck(entry) {
    requestCount += 1;
    if (checks.length < MAX_RECORDED_CHECKS) checks.push(entry);
  }

  try {
    origin = canonicalOrigin(rawOrigin);
    const inputs = normalizeInputs(credentials, options);
    normalizedEmail = inputs.email;
    expectedWorkerVersion = inputs.expectedWorkerVersion;
    phase = "password_generation";
    const nextPassword = generatedPassword(options.passwordFactory, inputs.initialPassword);
    const fetchImplementation = options.fetch || globalThis.fetch;

    async function call(label, path, {
      jar,
      method = "GET",
      body,
      expected = [200],
    } = {}) {
      phase = label;
      const started = performance.now();
      const headers = new Headers({ "user-agent": "grihagrid-account-security-synthetic/1.0" });
      if (jar?.size) headers.set("cookie", cookieHeader(jar));
      if (body !== undefined) headers.set("content-type", "application/json");
      if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
        headers.set("origin", origin.origin);
        const csrf = jar ? csrfToken(jar) : "";
        if (csrf && !path.startsWith("/api/auth/login") && !path.startsWith("/api/auth/register")) {
          headers.set("x-csrf-token", csrf);
        }
      }
      let response;
      try {
        response = await fetchImplementation(new URL(path, origin), {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          redirect: "error",
          signal: AbortSignal.timeout(inputs.timeoutMs),
        });
      } catch {
        recordCheck({ name: label, method, route: path, status: null, latencyMs: Math.round(performance.now() - started) });
        throw safeFailure(label);
      }
      if (!(response instanceof Response)) {
        recordCheck({ name: label, method, route: path, status: null, latencyMs: Math.round(performance.now() - started) });
        throw safeFailure(label);
      }
      if (jar) mergeCookies(jar, response);
      let payload = null;
      if (response.status !== 204 && (response.headers.get("content-type") || "").startsWith("application/json")) {
        try {
          payload = await response.json();
        } catch {
          recordCheck({ name: label, method, route: path, status: response.status, latencyMs: Math.round(performance.now() - started) });
          throw safeFailure(label);
        }
      }
      recordCheck({ name: label, method, route: path, status: response.status, latencyMs: Math.round(performance.now() - started) });
      if (!expected.includes(response.status)) throw safeFailure(label);
      return payload;
    }

    function requireCondition(condition) {
      if (!condition) throw safeFailure(phase);
    }

    function requireAuthenticatedResponse(jar, payload, userId = "") {
      requireCondition(hasAuthentication(jar));
      requireCondition(sameAccount(payload, normalizedEmail, userId));
      requireCondition(typeof payload?.csrfToken === "string" && payload.csrfToken === csrfToken(jar));
    }

    function requireIdentifierFreeSessionList(payload, expectedCount, envelopeKeys = ["hasMore", "sessions"]) {
      requireCondition(payload && typeof payload === "object" && !Array.isArray(payload));
      requireCondition(JSON.stringify(Object.keys(payload).sort()) === JSON.stringify([...envelopeKeys].sort()));
      requireCondition(payload.hasMore === false);
      requireCondition(Array.isArray(payload.sessions) && payload.sessions.length === expectedCount);
      for (const [index, session] of payload.sessions.entries()) {
        requireCondition(session && typeof session === "object" && !Array.isArray(session));
        requireCondition(JSON.stringify(Object.keys(session).sort())
          === JSON.stringify(["current", "expiresAt", "startedAt"]));
        requireCondition(session.current === (index === 0));
        requireCondition(typeof session.startedAt === "string" && SQLITE_TIMESTAMP_PATTERN.test(session.startedAt));
        requireCondition(typeof session.expiresAt === "string" && SQLITE_TIMESTAMP_PATTERN.test(session.expiresAt));
        const startedAt = Date.parse(`${session.startedAt.replace(" ", "T")}Z`);
        const expiresAt = Date.parse(`${session.expiresAt.replace(" ", "T")}Z`);
        requireCondition(Number.isFinite(startedAt) && Number.isFinite(expiresAt));
        requireCondition(startedAt < expiresAt && expiresAt > Date.now());
      }
    }

    async function me(label, jar, expected = [200]) {
      return call(label, "/api/auth/me", { jar, expected });
    }

    async function logoutAndProve(label, jar, replayJar) {
      requireCondition(hasAuthentication(jar));
      replayJar.clear();
      for (const [name, value] of jar) replayJar.set(name, value);
      cleanup.logoutAttempts += 1;
      try {
        await call(`${label}_logout`, "/api/auth/logout", { jar, method: "POST", body: {}, expected: [204] });
        cleanup.logoutAcknowledged += 1;
      } catch (error) {
        cleanup.logoutFailures += 1;
        throw error;
      }
      requireCondition(!jar.has(SESSION_COOKIE) && !jar.has(CSRF_COOKIE));
      const replay = await me(`${label}_logout_replay`, replayJar, [401]);
      requireCondition(replay?.code === "unauthenticated");
      replayJar.clear();
    }

    phase = "readiness";
    const readiness = await call("readiness", "/api/readiness");
    observedWorkerVersion = typeof readiness?.releaseId === "string" ? readiness.releaseId : "";
    requireCondition(WORKER_VERSION_PATTERN.test(observedWorkerVersion));
    proofs.workerVersionMatched = !expectedWorkerVersion || observedWorkerVersion === expectedWorkerVersion;
    requireCondition(proofs.workerVersionMatched);
    proofs.accountSecurityReady = readiness?.checks?.authSchema === "current"
      && readiness?.capabilities?.accountSecurity === true;
    requireCondition(proofs.accountSecurityReady);
    proofs.launchControlsClosed = readiness?.capabilities?.paidCheckout === false
      && readiness?.capabilities?.paidFulfillment === false
      && readiness?.capabilities?.privateUploads === false;
    requireCondition(proofs.launchControlsClosed);

    registrationAttempted = true;
    const registered = await call("register", "/api/auth/register", {
      jar: primaryJar,
      method: "POST",
      body: {
        name: "Account Security Release Canary",
        email: normalizedEmail,
        password: inputs.initialPassword,
      },
      expected: [201],
    });
    requireAuthenticatedResponse(primaryJar, registered);
    registeredUserId = registered.user.id;
    proofs.accountRegistered = true;

    const registeredMe = await me("registered_session_identity", primaryJar);
    requireCondition(sameAccount(registeredMe, normalizedEmail, registeredUserId));
    proofs.accountIdentityVerified = true;

    const secondLogin = await call("second_pre_boundary_login", "/api/auth/login", {
      jar: secondPreBoundaryJar,
      method: "POST",
      body: { email: normalizedEmail, password: inputs.initialPassword },
    });
    requireAuthenticatedResponse(secondPreBoundaryJar, secondLogin, registeredUserId);
    requireCondition(primaryJar.get(SESSION_COOKIE) !== secondPreBoundaryJar.get(SESSION_COOKIE));
    proofs.secondPreBoundarySessionCreated = true;

    const preBoundaryReview = await call("pre_boundary_session_review", "/api/auth/sessions", {
      jar: primaryJar,
    });
    requireIdentifierFreeSessionList(preBoundaryReview, 2);
    proofs.preBoundarySessionsListedIdentifierFree = true;

    capturedPrimaryPreBoundaryJar.clear();
    for (const [name, value] of primaryJar) capturedPrimaryPreBoundaryJar.set(name, value);
    const capturedSecondPreBoundary = new Map(secondPreBoundaryJar);
    const primaryPreBoundarySession = primaryJar.get(SESSION_COOKIE);
    const revokedOthers = await call("revoke_other_sessions", "/api/auth/sessions/revoke-others", {
      jar: primaryJar,
      method: "POST",
      body: { currentPassword: inputs.initialPassword },
    });
    requireAuthenticatedResponse(primaryJar, revokedOthers, registeredUserId);
    requireIdentifierFreeSessionList(
      revokedOthers,
      1,
      ["csrfToken", "hasMore", "sessions", "user"],
    );
    requireCondition(primaryJar.get(SESSION_COOKIE) !== primaryPreBoundarySession);
    proofs.revokeOthersBoundaryRotated = true;

    const firstPreBoundaryRejected = await me(
      "first_pre_boundary_session_rejected",
      capturedPrimaryPreBoundaryJar,
      [401],
    );
    const secondPreBoundaryRejected = await me(
      "second_pre_boundary_session_rejected",
      capturedSecondPreBoundary,
      [401],
    );
    requireCondition(firstPreBoundaryRejected?.code === "unauthenticated"
      && secondPreBoundaryRejected?.code === "unauthenticated");
    proofs.bothPreBoundarySessionsRevoked = true;
    capturedPrimaryPreBoundaryJar.clear();
    capturedSecondPreBoundary.clear();
    secondPreBoundaryJar.clear();

    const revokeReplacementMe = await me("revoke_replacement_session_identity", primaryJar);
    requireCondition(sameAccount(revokeReplacementMe, normalizedEmail, registeredUserId));
    proofs.revokeReplacementSessionWorks = true;

    const unchangedPasswordLogin = await call("unchanged_password_post_boundary_login", "/api/auth/login", {
      jar: postBoundaryJar,
      method: "POST",
      body: { email: normalizedEmail, password: inputs.initialPassword },
    });
    requireAuthenticatedResponse(postBoundaryJar, unchangedPasswordLogin, registeredUserId);
    requireCondition(postBoundaryJar.get(SESSION_COOKIE) !== primaryJar.get(SESSION_COOKIE));
    proofs.unchangedPasswordCreatedPostBoundarySession = true;

    const postBoundaryReview = await call("post_boundary_session_review", "/api/auth/sessions", {
      jar: primaryJar,
    });
    requireIdentifierFreeSessionList(postBoundaryReview, 2);
    proofs.postBoundarySessionsListedIdentifierFree = true;

    capturedPrimaryPrePasswordChangeJar.clear();
    for (const [name, value] of primaryJar) capturedPrimaryPrePasswordChangeJar.set(name, value);
    const capturedSecondPrePasswordChange = new Map(postBoundaryJar);
    const primaryPrePasswordChangeSession = primaryJar.get(SESSION_COOKIE);
    const changed = await call("password_rotation", "/api/auth/password", {
      jar: primaryJar,
      method: "PUT",
      body: { currentPassword: inputs.initialPassword, newPassword: nextPassword },
    });
    requireAuthenticatedResponse(primaryJar, changed, registeredUserId);
    requireCondition(primaryJar.get(SESSION_COOKIE) !== primaryPrePasswordChangeSession);
    proofs.passwordRotated = true;

    const firstPrePasswordChangeRejected = await me(
      "first_pre_password_change_session_rejected",
      capturedPrimaryPrePasswordChangeJar,
      [401],
    );
    const secondPrePasswordChangeRejected = await me(
      "second_pre_password_change_session_rejected",
      capturedSecondPrePasswordChange,
      [401],
    );
    requireCondition(firstPrePasswordChangeRejected?.code === "unauthenticated"
      && secondPrePasswordChangeRejected?.code === "unauthenticated");
    proofs.bothPrePasswordChangeSessionsRevoked = true;
    capturedPrimaryPrePasswordChangeJar.clear();
    capturedSecondPrePasswordChange.clear();
    postBoundaryJar.clear();

    const replacementMe = await me("password_replacement_session_identity", primaryJar);
    requireCondition(sameAccount(replacementMe, normalizedEmail, registeredUserId));
    proofs.passwordReplacementSessionWorks = true;

    const rejectedOldPassword = await call("old_password_rejected", "/api/auth/login", {
      jar: new Map(),
      method: "POST",
      body: { email: normalizedEmail, password: inputs.initialPassword },
      expected: [401],
    });
    requireCondition(rejectedOldPassword?.code === "invalid_credentials");
    proofs.oldPasswordRejected = true;

    const acceptedNewPassword = await call("new_password_accepted", "/api/auth/login", {
      jar: newPasswordJar,
      method: "POST",
      body: { email: normalizedEmail, password: nextPassword },
    });
    requireAuthenticatedResponse(newPasswordJar, acceptedNewPassword, registeredUserId);
    requireCondition(newPasswordJar.get(SESSION_COOKIE) !== primaryJar.get(SESSION_COOKIE));
    proofs.newPasswordAccepted = true;

    await logoutAndProve("password_replacement_session", primaryJar, passwordReplacementLogoutReplayJar);
    proofs.passwordReplacementSessionLoggedOut = true;
    await logoutAndProve("new_password_session", newPasswordJar, newPasswordLogoutReplayJar);
    proofs.newPasswordSessionLoggedOut = true;
  } catch (error) {
    primaryError = error instanceof AccountSecurityCanaryError ? error : safeFailure(phase);
  } finally {
    // If the main proof fails early, revoke every session still represented by
    // a live in-memory jar. Logout is idempotent for already-revoked sessions.
    const acknowledgedCleanupSessions = new Set();
    for (const [label, jar] of [
      ["cleanup_primary", primaryJar],
      ["cleanup_second_pre_boundary", secondPreBoundaryJar],
      ["cleanup_post_boundary", postBoundaryJar],
      ["cleanup_new_password", newPasswordJar],
      ["cleanup_captured_primary_pre_boundary", capturedPrimaryPreBoundaryJar],
      ["cleanup_captured_primary_pre_password_change", capturedPrimaryPrePasswordChangeJar],
      ["cleanup_password_replacement_logout_replay", passwordReplacementLogoutReplayJar],
      ["cleanup_new_password_logout_replay", newPasswordLogoutReplayJar],
    ]) {
      if (!hasAuthentication(jar) || !origin) continue;
      const representedSession = jar.get(SESSION_COOKIE);
      if (acknowledgedCleanupSessions.has(representedSession)) {
        jar.clear();
        continue;
      }
      cleanup.logoutAttempts += 1;
      const headers = new Headers({
        "content-type": "application/json",
        "cookie": cookieHeader(jar),
        "origin": origin.origin,
        "user-agent": "grihagrid-account-security-synthetic/1.0",
        "x-csrf-token": csrfToken(jar),
      });
      const started = performance.now();
      try {
        const fetchImplementation = options.fetch || globalThis.fetch;
        const response = await fetchImplementation(new URL("/api/auth/logout", origin), {
          method: "POST",
          headers,
          body: "{}",
          redirect: "error",
          signal: AbortSignal.timeout(
            Number.isInteger(Number(options.timeoutMs)) ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS,
          ),
        });
        mergeCookies(jar, response);
        recordCheck({ name: label, method: "POST", route: "/api/auth/logout", status: response.status, latencyMs: Math.round(performance.now() - started) });
        if (response.status === 204) {
          cleanup.logoutAcknowledged += 1;
          acknowledgedCleanupSessions.add(representedSession);
        }
        else cleanup.logoutFailures += 1;
      } catch {
        recordCheck({ name: label, method: "POST", route: "/api/auth/logout", status: null, latencyMs: Math.round(performance.now() - started) });
        cleanup.logoutFailures += 1;
      }
      jar.clear();
    }
  }

  const evidence = {
    outcome: primaryError ? "failed" : "passed",
    origin: origin?.origin || null,
    startedAt,
    checkedAt: new Date().toISOString(),
    expectedWorkerVersion: expectedWorkerVersion || null,
    observedWorkerVersion: observedWorkerVersion || null,
    accountLocator: {
      algorithm: "sha256",
      normalizedEmailSha256: normalizedEmail ? sha256(normalizedEmail) : null,
      registeredUserIdSha256: registeredUserId ? sha256(registeredUserId) : null,
      identityVerified: proofs.accountIdentityVerified,
    },
    externalAccountCleanupRequired: proofs.accountRegistered || registrationAttempted,
    proofs,
    cleanup,
    requestCount,
    checks,
    failurePhase: primaryError?.phase || null,
  };
  if (primaryError) {
    primaryError.releaseEvidence = evidence;
    throw primaryError;
  }
  return evidence;
}

if (isDirectExecution()) {
  try {
    const result = await runAccountSecurityCanary(
      process.argv[2] || process.env.GRIHAGRID_ACCOUNT_SECURITY_ORIGIN,
      {
        email: process.env.GRIHAGRID_ACCOUNT_SECURITY_EMAIL,
        initialPassword: process.env.GRIHAGRID_ACCOUNT_SECURITY_INITIAL_PASSWORD,
      },
      {
        expectedWorkerVersion: process.env.EXPECT_WORKER_VERSION || process.env.EXPECT_RELEASE_ID,
      },
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    if (error?.releaseEvidence) process.stdout.write(`${JSON.stringify(error.releaseEvidence, null, 2)}\n`);
    process.stderr.write(`${error?.name === "AccountSecurityCanaryError" ? error.message : "account-security canary failed"}\n`);
    process.exitCode = 1;
  }
}
