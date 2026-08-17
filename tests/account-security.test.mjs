import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import worker from "../worker/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDirectory = path.join(root, "migrations");
const ORIGIN = "https://app.example.test";
const INITIAL_PASSWORD = "correct horse battery staple";
const SECOND_PASSWORD = "a different secure password 2026";
const THIRD_PASSWORD = "third secure password for race A";
const FOURTH_PASSWORD = "fourth secure password for race B";
const assets = { fetch: async () => new Response("missing", { status: 404 }) };

class MemoryKv {
  constructor({ fail = false } = {}) {
    this.fail = fail;
    this.values = new Map();
  }

  async get(key) {
    if (this.fail) throw new Error("synthetic KV read failure");
    return this.values.get(key) || null;
  }

  async put(key, value) {
    if (this.fail) throw new Error("synthetic KV write failure");
    this.values.set(key, value);
  }

  clear() {
    this.values.clear();
  }
}

function migrationStatements(source) {
  const statements = [];
  let lines = [];
  let trigger = false;
  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("--") || /^PRAGMA\s+/iu.test(line)) continue;
    if (!lines.length) trigger = /^CREATE\s+TRIGGER\b/iu.test(line);
    lines.push(rawLine);
    const complete = trigger ? /\bEND;\s*$/iu.test(line) : /;\s*$/u.test(line);
    if (!complete) continue;
    statements.push(lines.join("\n").trim());
    lines = [];
    trigger = false;
  }
  assert.equal(lines.length, 0, "migration contains an incomplete SQL statement");
  return statements;
}

async function migrationNames() {
  return (await readdir(migrationsDirectory)).filter((name) => name.endsWith(".sql")).sort();
}

async function applyMigrations(db, names) {
  for (const name of names) {
    const source = await readFile(path.join(migrationsDirectory, name), "utf8");
    for (const statement of migrationStatements(source)) await db.prepare(statement).run();
  }
}

async function realD1(context, suffix) {
  const databaseName = `acct-${suffix}`;
  const miniflare = new Miniflare({
    workers: [{
      config: {
        name: `acct-worker-${suffix}`,
        type: "worker",
        compatibilityDate: "2026-08-01",
        manifest: {
          mainModule: "index.mjs",
          modulesRoot: process.cwd(),
          modules: { "index.mjs": { type: "esm", contents: "export default {}" } },
        },
        env: { DB: { type: "d1", name: databaseName } },
      },
    }],
  });
  context.after(() => miniflare.dispose());
  return miniflare.getD1Database("DB");
}

async function call(env, pathname, {
  method = "GET",
  body,
  auth,
  origin = method === "GET" || method === "HEAD" ? undefined : ORIGIN,
  headers = {},
} = {}) {
  const requestHeaders = new Headers(headers);
  if (body !== undefined) requestHeaders.set("content-type", "application/json");
  if (auth) {
    requestHeaders.set("cookie", auth.cookie);
    requestHeaders.set("x-csrf-token", auth.csrf);
  }
  if (origin !== undefined) requestHeaders.set("origin", origin);
  const response = await worker.fetch(new Request(`${ORIGIN}${pathname}`, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
  const text = await response.text();
  let payload = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = text; }
  }
  return { response, payload };
}

function authFromResponse(response, payload) {
  const setCookies = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie") || ""];
  const session = /__Host-grihagrid_session=([^;,]+)/u.exec(setCookies.join(";"))?.[1];
  assert.ok(session, "successful authentication must rotate the session cookie");
  assert.equal(typeof payload?.csrfToken, "string");
  assert.ok(payload.csrfToken.length >= 32);
  return {
    csrf: payload.csrfToken,
    cookie: `__Host-grihagrid_session=${session}; grihagrid_csrf=${payload.csrfToken}`,
  };
}

async function register(env, email) {
  const result = await call(env, "/api/auth/register", {
    method: "POST",
    body: { name: "Account Security Owner", email, password: INITIAL_PASSWORD },
  });
  assert.equal(result.response.status, 201, JSON.stringify(result.payload));
  return { ...authFromResponse(result.response, result.payload), user: result.payload.user };
}

async function login(env, email, password) {
  const result = await call(env, "/api/auth/login", {
    method: "POST",
    body: { email, password },
  });
  return result.response.status === 200
    ? { ...result, auth: authFromResponse(result.response, result.payload) }
    : result;
}

async function accountSnapshot(db, userId) {
  const user = await db.prepare(
    `SELECT id,password_hash,password_salt,password_iterations,password_algorithm,
            auth_generation,auth_revision_id,password_changed_at
       FROM users WHERE id=?`,
  ).bind(userId).first();
  const sessions = (await db.prepare(
    `SELECT id,user_id,token_hash,csrf_hash,expires_at,created_at,last_seen_at,
            auth_generation,auth_revision_id
       FROM sessions WHERE user_id=? ORDER BY id`,
  ).bind(userId).all()).results;
  return { user, sessions };
}

async function clearPasswordAttempts(db, userId) {
  await db.prepare("DELETE FROM password_change_attempt_counters WHERE user_id=?").bind(userId).run();
}

async function withPasswordDerivationCount(action) {
  const original = crypto.subtle.deriveBits;
  let derivations = 0;
  crypto.subtle.deriveBits = async function countedDeriveBits(...arguments_) {
    if (arguments_[0]?.name === "PBKDF2") derivations += 1;
    return original.apply(this, arguments_);
  };
  try {
    return { result: await action(), derivations };
  } finally {
    crypto.subtle.deriveBits = original;
  }
}

function passwordRequest(auth, currentPassword, newPassword, extra = {}) {
  return {
    method: "PUT",
    auth,
    body: { currentPassword, newPassword, ...extra },
  };
}

function sessionRevocationRequest(auth, currentPassword, extra = {}) {
  return {
    method: "POST",
    auth,
    body: { currentPassword, ...extra },
  };
}

function staleLoginDatabase(db, userId) {
  let advanced = false;
  return {
    prepare(sql) {
      const prepared = db.prepare(sql);
      if (!sql.includes("FROM users WHERE email=?")) return prepared;
      return {
        bind(...values) {
          const bound = prepared.bind(...values);
          return {
            async first() {
              const row = await bound.first();
              if (!advanced && sql.includes("FROM users WHERE email=?")) {
                advanced = true;
                await db.prepare(
                  `UPDATE users
                      SET auth_generation=auth_generation+1,auth_revision_id=?
                    WHERE id=?`,
                ).bind(randomUUID(), userId).run();
              }
              return row;
            },
            run: (...arguments_) => bound.run(...arguments_),
            all: (...arguments_) => bound.all(...arguments_),
          };
        },
        first: (...arguments_) => prepared.first(...arguments_),
        run: (...arguments_) => prepared.run(...arguments_),
        all: (...arguments_) => prepared.all(...arguments_),
      };
    },
    batch: (...arguments_) => db.batch(...arguments_),
  };
}

function failedPasswordAdmissionDatabase(db) {
  return {
    prepare(sql) {
      if (sql.includes("INSERT INTO password_change_attempt_counters")) {
        return {
          bind() {
            return {
              async first() {
                throw new Error("synthetic D1 password admission failure");
              },
            };
          },
        };
      }
      return db.prepare(sql);
    },
    batch: (...arguments_) => db.batch(...arguments_),
  };
}

test("0015 preserves populated generation-one rows and previous-Worker inserts while forward auth stays generation-bound", { timeout: 60_000 }, async (context) => {
  const db = await realD1(context, "migration");
  const names = await migrationNames();
  assert.equal(names.includes("0015_account_security.sql"), true);
  await applyMigrations(db, names.filter((name) => ["0001_initial.sql", "0002_backend.sql"].includes(name)));
  await db.prepare(
    `INSERT INTO users
       (id,email,name,created_at,password_hash,password_salt,password_iterations,password_algorithm)
     VALUES ('legacy-user','legacy@example.test','Legacy','2026-08-15 00:00:00','hash-1','salt-1',100000,'PBKDF2-SHA256')`,
  ).run();
  await db.prepare(
    `INSERT INTO sessions (id,user_id,token_hash,csrf_hash,expires_at,created_at,last_seen_at)
     VALUES ('legacy-session','legacy-user','legacy-token','legacy-csrf','2099-01-01 00:00:00','2026-08-15 00:00:00','2026-08-15 00:00:00')`,
  ).run();

  await applyMigrations(db, ["0015_account_security.sql"]);
  const migratedUser = await db.prepare(
    "SELECT auth_generation,auth_revision_id,password_changed_at FROM users WHERE id='legacy-user'",
  ).first();
  const migratedSession = await db.prepare(
    "SELECT auth_generation,auth_revision_id FROM sessions WHERE id='legacy-session'",
  ).first();
  assert.deepEqual(migratedUser, { auth_generation: 1, auth_revision_id: null, password_changed_at: null });
  assert.deepEqual(migratedSession, { auth_generation: 1, auth_revision_id: null });
  assert.equal((await db.prepare(
    `SELECT COUNT(*) AS count FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.user_id='legacy-user' AND s.auth_generation=u.auth_generation
        AND s.auth_revision_id IS u.auth_revision_id`,
  ).first()).count, 1);

  await db.prepare(
    `UPDATE users
        SET password_hash='hash-2',password_salt='salt-2',auth_generation=2,
            auth_revision_id='rollback-auth-revision-2',password_changed_at='2026-08-16 00:00:00'
      WHERE id='legacy-user'`,
  ).run();
  await db.prepare(
    `INSERT INTO sessions (id,user_id,token_hash,csrf_hash,expires_at,created_at,last_seen_at)
     VALUES ('rollback-session','legacy-user','rollback-token','rollback-csrf','2099-01-01 00:00:00','2026-08-16 00:00:00','2026-08-16 00:00:00')`,
  ).run();
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM sessions WHERE user_id='legacy-user'").first()).count, 2);
  assert.equal((await db.prepare(
    `SELECT COUNT(*) AS count FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.user_id='legacy-user' AND s.auth_generation=u.auth_generation
        AND s.auth_revision_id IS u.auth_revision_id`,
  ).first()).count, 0, "the forward Worker must reject legacy sessions created during rollback");
  await assert.rejects(
    () => db.prepare("UPDATE sessions SET auth_generation=2 WHERE id='rollback-session'").run(),
    /session authentication state is immutable/iu,
  );

  await db.prepare(
    `INSERT INTO users
       (id,email,name,created_at,password_hash,password_salt,password_iterations,password_algorithm,password_changed_at)
     VALUES ('same-second-user','same-second@example.test','Same Second','2026-08-16 00:00:00',
             'same-hash-1','same-salt-1',100000,'PBKDF2-SHA256','2026-08-16 00:00:00')`,
  ).run();
  await db.prepare(
    `UPDATE users
        SET password_hash='same-hash-2',password_salt='same-salt-2',auth_generation=2,
            auth_revision_id='same-second-auth-revision',password_changed_at='2026-08-16 00:00:00'
      WHERE id='same-second-user'`,
  ).run();
  assert.equal((await db.prepare(
    "SELECT auth_generation,password_changed_at FROM users WHERE id='same-second-user'",
  ).first()).auth_generation, 2, "second-resolution timestamps must not reject an immediate valid rotation");
});

test("password change is strict, fail-closed, atomic, revoking, and race-safe on real D1", { timeout: 120_000 }, async (context) => {
  const db = await realD1(context, "endpoint");
  await applyMigrations(db, (await migrationNames()).filter((name) => [
    "0001_initial.sql",
    "0002_backend.sql",
    "0015_account_security.sql",
    "0017_login_attempt_fence.sql",
  ].includes(name)));
  const kv = new MemoryKv();
  const env = {
    ASSETS: assets,
    DB: db,
    GRIHAGRID_CACHE: kv,
    APP_ORIGIN: ORIGIN,
    PAID_CHECKOUT_ENABLED: "false",
    DECISION_COMPARE_FULFILLMENT_ENABLED: "false",
    ENABLED_PAYMENT_PLANS: "",
  };

  const readiness = await call(env, "/api/readiness");
  assert.equal(readiness.response.status, 503, JSON.stringify(readiness.payload));
  assert.equal(readiness.payload.checks.authSchema, "current");
  assert.equal(readiness.payload.capabilities.accountSecurity, false, "the deliberately minimal D1 fixture is not globally ready");
  assert.equal(readiness.payload.capabilities.paidCheckout, false);
  assert.equal(readiness.payload.capabilities.privateUploads, false);

  const email = "account-security-owner@example.test";
  const primary = await register(env, email);
  const otherDeviceLogin = await login(env, email, INITIAL_PASSWORD);
  assert.equal(otherDeviceLogin.response.status, 200, JSON.stringify(otherDeviceLogin.payload));
  const otherDevice = otherDeviceLogin.auth;
  const baseline = await accountSnapshot(db, primary.user.id);
  assert.equal(baseline.user.auth_generation, 1);
  assert.equal(baseline.user.auth_revision_id, null);
  assert.equal(baseline.sessions.length, 2);

  const postAlias = await call(env, "/api/auth/password", {
    ...passwordRequest(primary, INITIAL_PASSWORD, SECOND_PASSWORD),
    method: "POST",
  });
  assert.equal(postAlias.response.status, 405);
  assert.equal(postAlias.response.headers.get("allow"), "PUT");
  assert.deepEqual(await accountSnapshot(db, primary.user.id), baseline);

  kv.clear();
  const crossOrigin = await call(env, "/api/auth/password", {
    ...passwordRequest(primary, INITIAL_PASSWORD, SECOND_PASSWORD),
    origin: "https://evil.example.test",
  });
  assert.equal(crossOrigin.response.status, 403);
  assert.equal(crossOrigin.payload.code, "origin_rejected");
  assert.deepEqual(await accountSnapshot(db, primary.user.id), baseline);

  const badCsrf = await call(env, "/api/auth/password", {
    method: "PUT",
    auth: { ...primary, csrf: "attacker-csrf" },
    body: { currentPassword: INITIAL_PASSWORD, newPassword: SECOND_PASSWORD },
  });
  assert.equal(badCsrf.response.status, 403);
  assert.equal(badCsrf.payload.code, "csrf_rejected");
  assert.deepEqual(await accountSnapshot(db, primary.user.id), baseline);

  const noKv = await call({ ...env, GRIHAGRID_CACHE: undefined }, "/api/auth/password", passwordRequest(primary, INITIAL_PASSWORD, SECOND_PASSWORD));
  assert.equal(noKv.response.status, 503);
  assert.equal(noKv.payload.code, "abuse_control_unavailable");
  assert.deepEqual(await accountSnapshot(db, primary.user.id), baseline);

  const failedKv = await call({ ...env, GRIHAGRID_CACHE: new MemoryKv({ fail: true }) }, "/api/auth/password", passwordRequest(primary, INITIAL_PASSWORD, SECOND_PASSWORD));
  assert.equal(failedKv.response.status, 503);
  assert.equal(failedKv.payload.code, "abuse_control_unavailable");
  assert.deepEqual(await accountSnapshot(db, primary.user.id), baseline);

  kv.clear();
  const failedD1Admission = await call(
    { ...env, DB: failedPasswordAdmissionDatabase(db) },
    "/api/auth/password",
    passwordRequest(primary, INITIAL_PASSWORD, SECOND_PASSWORD),
  );
  assert.equal(failedD1Admission.response.status, 503);
  assert.equal(failedD1Admission.payload.code, "abuse_control_unavailable");
  assert.deepEqual(await accountSnapshot(db, primary.user.id), baseline);
  assert.equal((await db.prepare(
    "SELECT COUNT(*) AS count FROM password_change_attempt_counters WHERE user_id=?",
  ).bind(primary.user.id).first()).count, 0);

  for (const body of [
    { currentPassword: INITIAL_PASSWORD },
    { currentPassword: INITIAL_PASSWORD, newPassword: SECOND_PASSWORD, userId: primary.user.id },
    { currentPassword: 42, newPassword: SECOND_PASSWORD },
    { currentPassword: INITIAL_PASSWORD, newPassword: { value: SECOND_PASSWORD } },
  ]) {
    kv.clear();
    const invalid = await call(env, "/api/auth/password", { method: "PUT", auth: primary, body });
    assert.equal(invalid.response.status, 400, JSON.stringify(invalid.payload));
    assert.equal(invalid.payload.code, "invalid_password_change");
    assert.deepEqual(await accountSnapshot(db, primary.user.id), baseline);
  }

  kv.clear();
  const wrongCurrent = await call(env, "/api/auth/password", passwordRequest(primary, "wrong current password", SECOND_PASSWORD));
  assert.equal(wrongCurrent.response.status, 401);
  assert.equal(wrongCurrent.payload.code, "current_password_incorrect");
  assert.deepEqual(await accountSnapshot(db, primary.user.id), baseline);

  kv.clear();
  const reused = await call(env, "/api/auth/password", passwordRequest(primary, INITIAL_PASSWORD, INITIAL_PASSWORD));
  assert.equal(reused.response.status, 400);
  assert.equal(reused.payload.code, "password_reuse");
  assert.deepEqual(await accountSnapshot(db, primary.user.id), baseline);

  await clearPasswordAttempts(db, primary.user.id);
  const deliberatelyNonAtomicKv = { get: async () => null, put: async () => {} };
  const parallelGuesses = await Promise.all(Array.from({ length: 20 }, () => call(
    { ...env, GRIHAGRID_CACHE: deliberatelyNonAtomicKv },
    "/api/auth/password",
    passwordRequest(primary, "wrong current password", SECOND_PASSWORD),
  )));
  assert.equal(parallelGuesses.filter((result) => result.response.status === 401).length, 5);
  assert.equal(parallelGuesses.filter((result) => result.response.status === 429).length, 15);
  assert.equal((await db.prepare(
    "SELECT request_count FROM password_change_attempt_counters WHERE user_id=?",
  ).bind(primary.user.id).first()).request_count, 5, "parallel KV bypasses must still stop at the atomic D1 account cap");

  await clearPasswordAttempts(db, primary.user.id);
  kv.clear();
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const limited = await call(env, "/api/auth/password", passwordRequest(primary, "wrong current password", SECOND_PASSWORD));
    assert.equal(limited.response.status, attempt <= 5 ? 401 : 429, JSON.stringify(limited.payload));
    if (attempt === 6) assert.equal(limited.payload.code, "rate_limited");
  }
  assert.deepEqual(await accountSnapshot(db, primary.user.id), baseline);

  await clearPasswordAttempts(db, primary.user.id);
  await db.prepare(
    `CREATE TRIGGER e2e_fail_password_replacement
       BEFORE INSERT ON sessions WHEN NEW.auth_generation=2
     BEGIN
       SELECT RAISE(ABORT, 'synthetic replacement insert failure');
     END`,
  ).run();
  kv.clear();
  const seededBeforeFailure = await login(env, email, "wrong current password");
  assert.equal(seededBeforeFailure.response.status, 401);
  const fenceBeforeFailure = await db.prepare(
    "SELECT * FROM login_attempt_fences WHERE user_id=?",
  ).bind(primary.user.id).first();
  assert.equal(fenceBeforeFailure.request_count, 1);
  kv.clear();
  const injectedFailure = await call(env, "/api/auth/password", passwordRequest(primary, INITIAL_PASSWORD, SECOND_PASSWORD));
  assert.equal(injectedFailure.response.status, 500, JSON.stringify(injectedFailure.payload));
  assert.equal(injectedFailure.payload.code, "internal_error");
  assert.deepEqual(await accountSnapshot(db, primary.user.id), baseline, "D1 must roll back credentials, generation, delete, and insert together");
  assert.deepEqual(
    await db.prepare("SELECT * FROM login_attempt_fences WHERE user_id=?").bind(primary.user.id).first(),
    fenceBeforeFailure,
    "a rolled-back password change must retain the existing login fence",
  );
  await db.prepare("DROP TRIGGER e2e_fail_password_replacement").run();

  await clearPasswordAttempts(db, primary.user.id);
  kv.clear();
  const changed = await call(env, "/api/auth/password", passwordRequest(primary, INITIAL_PASSWORD, SECOND_PASSWORD));
  assert.equal(changed.response.status, 200, JSON.stringify(changed.payload));
  assert.equal(changed.response.headers.get("cache-control"), "no-store");
  assert.deepEqual(Object.keys(changed.payload).sort(), ["csrfToken", "user"]);
  assert.equal(JSON.stringify(changed.payload).includes("password"), false);
  const replacement = authFromResponse(changed.response, changed.payload);
  const committed = await accountSnapshot(db, primary.user.id);
  assert.equal(committed.user.auth_generation, 2);
  assert.match(committed.user.auth_revision_id, /^[0-9a-f-]{36}$/u);
  assert.equal(typeof committed.user.password_changed_at, "string");
  assert.equal(committed.sessions.length, 1);
  assert.equal(committed.sessions[0].auth_generation, 2);
  assert.equal(committed.sessions[0].auth_revision_id, committed.user.auth_revision_id);
  assert.notEqual(committed.user.password_hash, baseline.user.password_hash);
  assert.notEqual(committed.user.password_salt, baseline.user.password_salt);
  assert.equal(
    await db.prepare("SELECT user_id FROM login_attempt_fences WHERE user_id=?").bind(primary.user.id).first(),
    null,
    "the exact committed replacement session must clear the prior login fence",
  );

  for (const revoked of [primary, otherDevice]) {
    const me = await call(env, "/api/auth/me", { auth: revoked });
    assert.equal(me.response.status, 401);
    assert.equal(me.payload.code, "unauthenticated");
  }
  const replacementMe = await call(env, "/api/auth/me", { auth: replacement });
  assert.equal(replacementMe.response.status, 200);
  const oldLogin = await login(env, email, INITIAL_PASSWORD);
  assert.equal(oldLogin.response.status, 401);
  assert.equal(oldLogin.payload.code, "invalid_credentials");
  const newLogin = await login(env, email, SECOND_PASSWORD);
  assert.equal(newLogin.response.status, 200, JSON.stringify(newLogin.payload));

  // Remove the extra login session so the race assertion starts with one exact
  // bearer. Both requests authenticate the same generation; their conditional
  // batches must leave one winner and one replacement session.
  await db.prepare("DELETE FROM sessions WHERE id=?").bind(
    (await db.prepare("SELECT id FROM sessions WHERE user_id=? AND id!=? LIMIT 1")
      .bind(primary.user.id, committed.sessions[0].id).first()).id,
  ).run();
  await clearPasswordAttempts(db, primary.user.id);
  kv.clear();
  const seededBeforeRace = await login(env, email, "wrong current password");
  assert.equal(seededBeforeRace.response.status, 401);
  assert.equal((await db.prepare(
    "SELECT request_count FROM login_attempt_fences WHERE user_id=?",
  ).bind(primary.user.id).first()).request_count, 1);
  kv.clear();
  const race = await Promise.all([
    call(env, "/api/auth/password", passwordRequest(replacement, SECOND_PASSWORD, THIRD_PASSWORD)),
    call(env, "/api/auth/password", passwordRequest(replacement, SECOND_PASSWORD, FOURTH_PASSWORD)),
  ]);
  const winners = race.filter((result) => result.response.status === 200);
  const losers = race.filter((result) => result.response.status !== 200);
  assert.equal(winners.length, 1, JSON.stringify(race.map((result) => ({ status: result.response.status, payload: result.payload }))));
  assert.equal(losers.length, 1);
  assert.ok([401, 409].includes(losers[0].response.status));
  if (losers[0].response.status === 409) assert.equal(losers[0].payload.code, "auth_state_changed");
  const afterRace = await accountSnapshot(db, primary.user.id);
  assert.equal(afterRace.user.auth_generation, 3);
  assert.equal(afterRace.sessions.length, 1);
  assert.equal(afterRace.sessions[0].auth_generation, 3);
  assert.equal(afterRace.sessions[0].auth_revision_id, afterRace.user.auth_revision_id);
  assert.equal(
    await db.prepare("SELECT user_id FROM login_attempt_fences WHERE user_id=?").bind(primary.user.id).first(),
    null,
    "one winning rotation must clear the fence while the losing batch remains a no-op",
  );
  const winningPassword = race[0].response.status === 200 ? THIRD_PASSWORD : FOURTH_PASSWORD;
  const losingPassword = race[0].response.status === 200 ? FOURTH_PASSWORD : THIRD_PASSWORD;
  assert.equal((await login(env, email, winningPassword)).response.status, 200);
  assert.equal((await login(env, email, losingPassword)).response.status, 401);

  const staleEmail = "stale-login@example.test";
  const staleOwner = await register(env, staleEmail);
  const beforeStaleLogin = await accountSnapshot(db, staleOwner.user.id);
  const staleResult = await login(
    { ...env, DB: staleLoginDatabase(db, staleOwner.user.id) },
    staleEmail,
    INITIAL_PASSWORD,
  );
  assert.equal(staleResult.response.status, 401, JSON.stringify(staleResult.payload));
  assert.deepEqual(staleResult.payload, {
    error: "email or password is incorrect",
    code: "invalid_credentials",
  });
  assert.deepEqual(staleResult.response.headers.getSetCookie(), []);
  const afterStaleLogin = await accountSnapshot(db, staleOwner.user.id);
  assert.equal(afterStaleLogin.user.auth_generation, 2);
  assert.equal(afterStaleLogin.sessions.length, beforeStaleLogin.sessions.length);
  const staleMe = await call(env, "/api/auth/me", { auth: staleOwner });
  assert.equal(staleMe.response.status, 401, "the generation-only revocation must invalidate the prior bearer");
});

test("session review is bounded, current-auth-only, identifier-free, and read-only on real D1", { timeout: 120_000 }, async (context) => {
  const db = await realD1(context, "session-review");
  await applyMigrations(db, (await migrationNames()).filter((name) => [
    "0001_initial.sql",
    "0002_backend.sql",
    "0015_account_security.sql",
    "0017_login_attempt_fence.sql",
  ].includes(name)));
  const env = {
    ASSETS: assets,
    DB: db,
    GRIHAGRID_CACHE: new MemoryKv(),
    APP_ORIGIN: ORIGIN,
    PAID_CHECKOUT_ENABLED: "false",
    DECISION_COMPARE_FULFILLMENT_ENABLED: "false",
    ENABLED_PAYMENT_PLANS: "",
  };
  const email = "session-review-owner@example.test";
  const primary = await register(env, email);
  const second = await login(env, email, INITIAL_PASSWORD);
  const third = await login(env, email, INITIAL_PASSWORD);
  assert.equal(second.response.status, 200);
  assert.equal(third.response.status, 200);

  const before = await accountSnapshot(db, primary.user.id);
  const rawToken = /__Host-grihagrid_session=([^;]+)/u.exec(primary.cookie)?.[1] || "";
  const currentTokenHash = createHash("sha256").update(rawToken).digest("base64url");
  const currentSessionId = before.sessions.find((row) => row.token_hash === currentTokenHash)?.id;
  assert.ok(currentSessionId);
  for (let index = 0; index < 22; index += 1) {
    const secondValue = String(index).padStart(2, "0");
    await db.prepare(
      `INSERT INTO sessions
         (id,user_id,token_hash,csrf_hash,expires_at,created_at,last_seen_at,auth_generation,auth_revision_id)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    ).bind(
      `bounded-session-${secondValue}`,
      primary.user.id,
      `bounded-token-hash-${secondValue}`,
      `bounded-csrf-hash-${secondValue}`,
      "2099-01-01 00:00:00",
      `2026-08-16 00:00:${secondValue}`,
      `2026-08-16 00:00:${secondValue}`,
      1,
      null,
    ).run();
  }
  await db.prepare(
    `INSERT INTO sessions
       (id,user_id,token_hash,csrf_hash,expires_at,created_at,last_seen_at,auth_generation,auth_revision_id)
     VALUES ('expired-session',?,'expired-token-hash','expired-csrf-hash','2020-01-02 00:00:00',
             '2020-01-01 00:00:00','2020-01-01 00:00:00',1,NULL)`,
  ).bind(primary.user.id).run();
  await db.prepare(
    `INSERT INTO sessions
       (id,user_id,token_hash,csrf_hash,expires_at,created_at,last_seen_at,auth_generation,auth_revision_id)
     VALUES ('stale-auth-session',?,'stale-auth-token-hash','stale-auth-csrf-hash','2099-01-02 00:00:00',
             '2098-01-01 00:00:00','2098-01-01 00:00:00',2,'stale-auth-revision')`,
  ).bind(primary.user.id).run();
  const storedBeforeReview = await accountSnapshot(db, primary.user.id);

  const reviewed = await call(env, "/api/auth/sessions", { auth: primary });
  assert.equal(reviewed.response.status, 200, JSON.stringify(reviewed.payload));
  assert.equal(reviewed.response.headers.get("cache-control"), "no-store");
  assert.deepEqual(Object.keys(reviewed.payload).sort(), ["hasMore", "sessions"]);
  assert.equal(reviewed.payload.hasMore, true);
  assert.equal(reviewed.payload.sessions.length, 21, "current plus at most 20 other sessions must be returned");
  assert.equal(reviewed.payload.sessions.filter((session) => session.current).length, 1);
  assert.equal(reviewed.payload.sessions[0].current, true);
  const expectedOtherStarts = storedBeforeReview.sessions
    .filter((session) => session.id !== currentSessionId
      && session.auth_generation === storedBeforeReview.user.auth_generation
      && session.auth_revision_id === storedBeforeReview.user.auth_revision_id
      && Date.parse(`${session.expires_at.replace(" ", "T")}Z`) > Date.now())
    .sort((left, right) => right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id))
    .slice(0, 20)
    .map((session) => session.created_at);
  assert.deepEqual(
    reviewed.payload.sessions.slice(1).map((session) => session.startedAt),
    expectedOtherStarts,
    "other sessions must remain in exact newest-first order with a stable ID tie-break",
  );
  for (const session of reviewed.payload.sessions) {
    assert.deepEqual(Object.keys(session).sort(), ["current", "expiresAt", "startedAt"]);
    assert.match(session.startedAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u);
    assert.match(session.expiresAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u);
  }
  const serialized = JSON.stringify(reviewed.payload);
  for (const forbidden of [
    primary.user.id,
    "bounded-session-",
    "bounded-token-hash-",
    "bounded-csrf-hash-",
    "2098-01-01 00:00:00",
    email,
    "session_id",
    "last_seen",
    "auth_generation",
    "auth_revision",
    "userAgent",
    "ipAddress",
  ]) assert.equal(serialized.includes(forbidden), false, forbidden);
  const after = await accountSnapshot(db, primary.user.id);
  assert.deepEqual(after, storedBeforeReview, "review must not update last-seen time or any authentication row");
  assert.equal(after.sessions.length, before.sessions.length + 24, "review must not prune or update session rows");

  const noAuth = await call(env, "/api/auth/sessions");
  assert.equal(noAuth.response.status, 401);
  assert.equal(noAuth.payload.code, "unauthenticated");
  const wrongMethod = await call(env, "/api/auth/sessions", { method: "POST", auth: primary, body: {} });
  assert.equal(wrongMethod.response.status, 405);
  assert.equal(wrongMethod.response.headers.get("allow"), "GET");

  await db.prepare("UPDATE sessions SET created_at='not-a-time' WHERE id=?").bind(currentSessionId).run();
  const malformed = await call(env, "/api/auth/sessions", { auth: primary });
  assert.equal(malformed.response.status, 503);
  assert.deepEqual(malformed.payload, {
    error: "session review is temporarily unavailable",
    code: "session_review_unavailable",
  });

  await db.prepare("UPDATE sessions SET created_at=? WHERE id=?")
    .bind(storedBeforeReview.sessions.find((session) => session.id === currentSessionId).created_at, currentSessionId).run();
  const selectedOtherId = storedBeforeReview.sessions.find((session) => session.created_at === expectedOtherStarts[0]
    && session.id !== currentSessionId)?.id;
  assert.ok(selectedOtherId);
  await db.prepare("UPDATE sessions SET created_at='not-a-time' WHERE id=?").bind(selectedOtherId).run();
  const malformedOther = await call(env, "/api/auth/sessions", { auth: primary });
  assert.equal(malformedOther.response.status, 503);
  assert.equal(malformedOther.payload.code, "session_review_unavailable");
});

test("password-confirmed session revocation is strict, atomic, generation-fenced, and preserves credentials", { timeout: 120_000 }, async (context) => {
  const db = await realD1(context, "session-revoke");
  await applyMigrations(db, (await migrationNames()).filter((name) => [
    "0001_initial.sql",
    "0002_backend.sql",
    "0015_account_security.sql",
    "0017_login_attempt_fence.sql",
  ].includes(name)));
  const kv = new MemoryKv();
  const env = {
    ASSETS: assets,
    DB: db,
    GRIHAGRID_CACHE: kv,
    APP_ORIGIN: ORIGIN,
    PAID_CHECKOUT_ENABLED: "false",
    DECISION_COMPARE_FULFILLMENT_ENABLED: "false",
    ENABLED_PAYMENT_PLANS: "",
  };
  const email = "session-revoke-owner@example.test";
  const primary = await register(env, email);
  const secondLogin = await login(env, email, INITIAL_PASSWORD);
  const thirdLogin = await login(env, email, INITIAL_PASSWORD);
  assert.equal(secondLogin.response.status, 200);
  assert.equal(thirdLogin.response.status, 200);
  const retained = [primary, secondLogin.auth, thirdLogin.auth];
  const baseline = await accountSnapshot(db, primary.user.id);
  assert.equal(baseline.sessions.length, 3);

  const wrongMethod = await call(env, "/api/auth/sessions/revoke-others", {
    ...sessionRevocationRequest(primary, INITIAL_PASSWORD),
    method: "PUT",
  });
  assert.equal(wrongMethod.response.status, 405);
  assert.equal(wrongMethod.response.headers.get("allow"), "POST");
  assert.deepEqual(await accountSnapshot(db, primary.user.id), baseline);

  kv.clear();
  const crossOrigin = await call(env, "/api/auth/sessions/revoke-others", {
    ...sessionRevocationRequest(primary, INITIAL_PASSWORD),
    origin: "https://evil.example.test",
  });
  assert.equal(crossOrigin.response.status, 403);
  assert.equal(crossOrigin.payload.code, "origin_rejected");
  assert.deepEqual(await accountSnapshot(db, primary.user.id), baseline);

  const badCsrf = await call(env, "/api/auth/sessions/revoke-others", {
    method: "POST",
    auth: { ...primary, csrf: "attacker-csrf" },
    body: { currentPassword: INITIAL_PASSWORD },
  });
  assert.equal(badCsrf.response.status, 403);
  assert.equal(badCsrf.payload.code, "csrf_rejected");
  assert.deepEqual(await accountSnapshot(db, primary.user.id), baseline);

  const noKv = await call(
    { ...env, GRIHAGRID_CACHE: undefined },
    "/api/auth/sessions/revoke-others",
    sessionRevocationRequest(primary, INITIAL_PASSWORD),
  );
  assert.equal(noKv.response.status, 503);
  assert.equal(noKv.payload.code, "abuse_control_unavailable");
  assert.deepEqual(await accountSnapshot(db, primary.user.id), baseline);

  const failedKv = await call(
    { ...env, GRIHAGRID_CACHE: new MemoryKv({ fail: true }) },
    "/api/auth/sessions/revoke-others",
    sessionRevocationRequest(primary, INITIAL_PASSWORD),
  );
  assert.equal(failedKv.response.status, 503);
  assert.equal(failedKv.payload.code, "abuse_control_unavailable");
  assert.deepEqual(await accountSnapshot(db, primary.user.id), baseline);

  kv.clear();
  const failedAdmission = await call(
    { ...env, DB: failedPasswordAdmissionDatabase(db) },
    "/api/auth/sessions/revoke-others",
    sessionRevocationRequest(primary, INITIAL_PASSWORD),
  );
  assert.equal(failedAdmission.response.status, 503);
  assert.equal(failedAdmission.payload.code, "abuse_control_unavailable");
  assert.deepEqual(await accountSnapshot(db, primary.user.id), baseline);

  for (const body of [
    {},
    { currentPassword: INITIAL_PASSWORD, sessionId: baseline.sessions[1].id },
    { currentPassword: 42 },
    { currentPassword: { value: INITIAL_PASSWORD } },
  ]) {
    kv.clear();
    const invalid = await call(env, "/api/auth/sessions/revoke-others", { method: "POST", auth: primary, body });
    assert.equal(invalid.response.status, 400, JSON.stringify(invalid.payload));
    assert.equal(invalid.payload.code, "invalid_session_revocation");
    assert.deepEqual(await accountSnapshot(db, primary.user.id), baseline);
  }

  await clearPasswordAttempts(db, primary.user.id);
  kv.clear();
  const wrongAttempt = await withPasswordDerivationCount(() => call(
      env,
      "/api/auth/sessions/revoke-others",
      sessionRevocationRequest(primary, "wrong current password"),
  ));
  const wrongPassword = wrongAttempt.result;
  assert.equal(wrongPassword.response.status, 401);
  assert.equal(wrongPassword.payload.code, "current_password_incorrect");
  assert.equal(wrongAttempt.derivations, 1, "an admitted wrong password must execute exactly one PBKDF2 derivation");
  assert.equal((await db.prepare(
    "SELECT request_count FROM password_change_attempt_counters WHERE user_id=?",
  ).bind(primary.user.id).first()).request_count, 1);
  assert.deepEqual(await accountSnapshot(db, primary.user.id), baseline);

  for (const [label, suppliedPassword] of [
    ["short", "123456789"],
    ["long", "x".repeat(129)],
  ]) {
    await clearPasswordAttempts(db, primary.user.id);
    kv.clear();
    const attempt = await withPasswordDerivationCount(() => call(
      env,
      "/api/auth/sessions/revoke-others",
      sessionRevocationRequest(primary, suppliedPassword),
    ));
    assert.equal(attempt.result.response.status, 401, label);
    assert.equal(attempt.result.payload.code, "current_password_incorrect", label);
    assert.equal(attempt.derivations, 1, `${label} password must execute exactly one dummy PBKDF2 derivation`);
    assert.equal((await db.prepare(
      "SELECT request_count FROM password_change_attempt_counters WHERE user_id=?",
    ).bind(primary.user.id).first()).request_count, 1, label);
    assert.deepEqual(await accountSnapshot(db, primary.user.id), baseline, label);
  }

  const validHash = baseline.user.password_hash;
  const validSalt = baseline.user.password_salt;
  const malformedRecords = [
    ["hash", "%%%", validSalt, 100_000, "PBKDF2-SHA256"],
    ["salt", validHash, "%%%", 100_000, "PBKDF2-SHA256"],
    ["iterations", validHash, validSalt, 99_999, "PBKDF2-SHA256"],
    ["algorithm", validHash, validSalt, 100_000, "PBKDF2-SHA1"],
  ];
  for (const [label, passwordHash, passwordSalt, passwordIterations, passwordAlgorithm] of malformedRecords) {
    const userId = randomUUID();
    const sessionId = randomUUID();
    const sessionToken = `malformed-session-${label}-${randomUUID()}`;
    const csrf = `malformed-csrf-${label}-${randomUUID()}`;
    const malformedAuth = {
      csrf,
      cookie: `__Host-grihagrid_session=${sessionToken}; grihagrid_csrf=${csrf}`,
    };
    await db.prepare(
      `INSERT INTO users
         (id,email,name,created_at,password_hash,password_salt,password_iterations,password_algorithm,
          password_changed_at,auth_generation,auth_revision_id)
       VALUES (?,?,?,?,?,?,?,?,?,1,NULL)`,
    ).bind(
      userId,
      `malformed-${label}@example.test`,
      "Malformed credential fixture",
      "2026-08-17 00:00:00",
      passwordHash,
      passwordSalt,
      passwordIterations,
      passwordAlgorithm,
      "2026-08-17 00:00:00",
    ).run();
    await db.prepare(
      `INSERT INTO sessions
         (id,user_id,token_hash,csrf_hash,expires_at,created_at,last_seen_at,auth_generation,auth_revision_id)
       VALUES (?,?,?,?,?,?,?,1,NULL)`,
    ).bind(
      sessionId,
      userId,
      createHash("sha256").update(sessionToken).digest("base64url"),
      createHash("sha256").update(csrf).digest("base64url"),
      "2099-01-01 00:00:00",
      "2026-08-17 00:00:00",
      "2026-08-17 00:00:00",
    ).run();
    const malformedBaseline = await accountSnapshot(db, userId);
    kv.clear();
    const attempt = await withPasswordDerivationCount(() => call(
      env,
      "/api/auth/sessions/revoke-others",
      sessionRevocationRequest(malformedAuth, INITIAL_PASSWORD),
    ));
    assert.equal(attempt.result.response.status, 401, label);
    assert.equal(attempt.result.payload.code, "current_password_incorrect", label);
    assert.equal(attempt.derivations, 1, `${label} record must execute exactly one dummy PBKDF2 derivation`);
    assert.equal((await db.prepare(
      "SELECT request_count FROM password_change_attempt_counters WHERE user_id=?",
    ).bind(userId).first()).request_count, 1, label);
    assert.deepEqual(await accountSnapshot(db, userId), malformedBaseline, label);
  }

  await clearPasswordAttempts(db, primary.user.id);
  kv.clear();
  const sharedStepUpAttempts = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    sharedStepUpAttempts.push(await call(
      env,
      "/api/auth/sessions/revoke-others",
      sessionRevocationRequest(primary, "wrong current password"),
    ));
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    sharedStepUpAttempts.push(await call(
      env,
      "/api/auth/password",
      passwordRequest(primary, "wrong current password", SECOND_PASSWORD),
    ));
  }
  assert.deepEqual(sharedStepUpAttempts.map((result) => result.response.status), [401, 401, 401, 401, 401, 429]);
  assert.equal(sharedStepUpAttempts.at(-1).payload.code, "rate_limited");
  assert.equal((await db.prepare(
    "SELECT request_count FROM password_change_attempt_counters WHERE user_id=?",
  ).bind(primary.user.id).first()).request_count, 5, "both current-password surfaces must share one atomic account cap");
  assert.deepEqual(await accountSnapshot(db, primary.user.id), baseline);

  await clearPasswordAttempts(db, primary.user.id);
  kv.clear();
  const seededFence = await login(env, email, "wrong current password");
  assert.equal(seededFence.response.status, 401);
  const fenceBefore = await db.prepare("SELECT * FROM login_attempt_fences WHERE user_id=?")
    .bind(primary.user.id).first();
  assert.equal(fenceBefore.request_count, 1);
  await db.prepare(
    `CREATE TRIGGER e2e_fail_session_revocation_replacement
       BEFORE INSERT ON sessions WHEN NEW.auth_generation=2
     BEGIN
       SELECT RAISE(ABORT, 'synthetic session revocation insert failure');
     END`,
  ).run();
  kv.clear();
  const injectedFailure = await call(
    env,
    "/api/auth/sessions/revoke-others",
    sessionRevocationRequest(primary, INITIAL_PASSWORD),
  );
  assert.equal(injectedFailure.response.status, 500, JSON.stringify(injectedFailure.payload));
  assert.equal(injectedFailure.payload.code, "internal_error");
  assert.deepEqual(await accountSnapshot(db, primary.user.id), baseline);
  assert.deepEqual(
    await db.prepare("SELECT * FROM login_attempt_fences WHERE user_id=?").bind(primary.user.id).first(),
    fenceBefore,
    "a failed revoke boundary must neither clear nor mutate the login fence",
  );
  await db.prepare("DROP TRIGGER e2e_fail_session_revocation_replacement").run();

  await clearPasswordAttempts(db, primary.user.id);
  kv.clear();
  const revoked = await call(
    env,
    "/api/auth/sessions/revoke-others",
    sessionRevocationRequest(primary, INITIAL_PASSWORD),
  );
  assert.equal(revoked.response.status, 200, JSON.stringify(revoked.payload));
  assert.equal(revoked.response.headers.get("cache-control"), "no-store");
  assert.deepEqual(Object.keys(revoked.payload).sort(), ["csrfToken", "hasMore", "sessions", "user"]);
  assert.deepEqual(revoked.payload.sessions.map((session) => Object.keys(session).sort()), [
    ["current", "expiresAt", "startedAt"],
  ]);
  assert.equal(revoked.payload.sessions[0].current, true);
  assert.equal(revoked.payload.hasMore, false);
  const replacement = authFromResponse(revoked.response, revoked.payload);
  const committed = await accountSnapshot(db, primary.user.id);
  assert.equal(committed.user.auth_generation, baseline.user.auth_generation + 1);
  assert.match(committed.user.auth_revision_id, /^[0-9a-f-]{36}$/u);
  assert.equal(committed.user.password_hash, baseline.user.password_hash);
  assert.equal(committed.user.password_salt, baseline.user.password_salt);
  assert.equal(committed.user.password_iterations, baseline.user.password_iterations);
  assert.equal(committed.user.password_algorithm, baseline.user.password_algorithm);
  assert.equal(committed.user.password_changed_at, baseline.user.password_changed_at);
  assert.equal(committed.sessions.length, 1);
  assert.equal(committed.sessions[0].auth_generation, committed.user.auth_generation);
  assert.equal(committed.sessions[0].auth_revision_id, committed.user.auth_revision_id);
  assert.deepEqual(
    await db.prepare("SELECT * FROM login_attempt_fences WHERE user_id=?").bind(primary.user.id).first(),
    fenceBefore,
    "revoking sessions without changing the password must not reopen the login fence",
  );
  for (const oldSession of retained) {
    const me = await call(env, "/api/auth/me", { auth: oldSession });
    assert.equal(me.response.status, 401);
    assert.equal(me.payload.code, "unauthenticated");
  }
  assert.equal((await call(env, "/api/auth/me", { auth: replacement })).response.status, 200);

  kv.clear();
  const postBoundaryLogin = await login(env, email, INITIAL_PASSWORD);
  assert.equal(postBoundaryLogin.response.status, 200, "the unchanged password may legitimately create a new post-boundary session");
  const afterNewLogin = await call(env, "/api/auth/sessions", { auth: replacement });
  assert.equal(afterNewLogin.response.status, 200);
  assert.equal(afterNewLogin.payload.sessions.length, 2);
  assert.equal(afterNewLogin.payload.hasMore, false);

  await clearPasswordAttempts(db, primary.user.id);
  kv.clear();
  const race = await Promise.all([
    call(env, "/api/auth/sessions/revoke-others", sessionRevocationRequest(replacement, INITIAL_PASSWORD)),
    call(env, "/api/auth/sessions/revoke-others", sessionRevocationRequest(replacement, INITIAL_PASSWORD)),
  ]);
  const winners = race.filter((result) => result.response.status === 200);
  const losers = race.filter((result) => result.response.status !== 200);
  assert.equal(winners.length, 1, JSON.stringify(race.map((result) => result.response.status)));
  assert.equal(losers.length, 1);
  assert.ok([401, 409].includes(losers[0].response.status));
  if (losers[0].response.status === 409) assert.equal(losers[0].payload.code, "auth_state_changed");
  const afterRace = await accountSnapshot(db, primary.user.id);
  assert.equal(afterRace.user.auth_generation, committed.user.auth_generation + 1);
  assert.equal(afterRace.sessions.length, 1);
  const winnerAuth = authFromResponse(winners[0].response, winners[0].payload);
  assert.equal((await call(env, "/api/auth/me", { auth: winnerAuth })).response.status, 200);
  assert.equal((await call(env, "/api/auth/me", { auth: replacement })).response.status, 401);
  assert.equal((await call(env, "/api/auth/me", { auth: postBoundaryLogin.auth })).response.status, 401);
});
