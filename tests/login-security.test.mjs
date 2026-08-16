import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import worker from "../worker/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDirectory = path.join(root, "migrations");
const ORIGIN = "https://app.example.test";
const PASSWORD = "correct horse battery staple";
const WRONG_PASSWORD = "definitely not the right password";
const assets = { fetch: async () => new Response("missing", { status: 404 }) };
const requiredMigrations = [
  "0001_initial.sql",
  "0002_backend.sql",
  "0015_account_security.sql",
  "0017_login_attempt_fence.sql",
];

class MemoryKv {
  constructor({ fail = false, nonAtomic = false } = {}) {
    this.fail = fail;
    this.nonAtomic = nonAtomic;
    this.values = new Map();
  }

  async get(key) {
    if (this.fail) throw new Error("synthetic KV read failure");
    if (this.nonAtomic) return null;
    return this.values.get(key) || null;
  }

  async put(key, value) {
    if (this.fail) throw new Error("synthetic KV write failure");
    if (!this.nonAtomic) this.values.set(key, value);
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

async function applyMigrations(db) {
  for (const name of requiredMigrations) {
    const source = await readFile(path.join(migrationsDirectory, name), "utf8");
    for (const statement of migrationStatements(source)) await db.prepare(statement).run();
  }
}

async function realD1(context, suffix) {
  const databaseName = `login-${suffix}`;
  const miniflare = new Miniflare({
    workers: [{
      config: {
        name: `login-worker-${suffix}`,
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
  const db = await miniflare.getD1Database("DB");
  await applyMigrations(db);
  return db;
}

async function environment(context, suffix) {
  const DB = await realD1(context, suffix);
  return {
    DB,
    env: { ASSETS: assets, DB, GRIHAGRID_CACHE: new MemoryKv() },
  };
}

async function call(env, pathname, {
  body,
  headers = {},
  ip = "203.0.113.10",
  method = "POST",
  origin = ORIGIN,
} = {}) {
  const requestHeaders = new Headers(headers);
  requestHeaders.set("cf-connecting-ip", ip);
  if (origin !== undefined) requestHeaders.set("origin", origin);
  let requestBody;
  if (body !== undefined) {
    requestHeaders.set("content-type", "application/json");
    requestBody = typeof body === "string" ? body : JSON.stringify(body);
  }
  const response = await worker.fetch(new Request(`${ORIGIN}${pathname}`, {
    method,
    headers: requestHeaders,
    body: requestBody,
  }), env);
  const text = await response.text();
  let payload = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = text; }
  }
  return { payload, response };
}

function setCookies(response) {
  return typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : response.headers.get("set-cookie") ? [response.headers.get("set-cookie")] : [];
}

function assertNoCookies(response) {
  assert.deepEqual(setCookies(response), []);
  assert.equal(response.headers.get("set-cookie"), null);
}

function failureSignature(result) {
  return {
    status: result.response.status,
    payload: result.payload,
    cacheControl: result.response.headers.get("cache-control"),
    contentType: result.response.headers.get("content-type"),
    cookies: setCookies(result.response),
  };
}

async function register(env, email = "login-owner@example.test") {
  const result = await call(env, "/api/auth/register", {
    body: { name: "Login Security Owner", email, password: PASSWORD },
  });
  assert.equal(result.response.status, 201, JSON.stringify(result.payload));
  assert.equal(typeof result.payload?.user?.id, "string");
  return result.payload.user;
}

async function login(env, email, password, options = {}) {
  return call(env, "/api/auth/login", {
    body: { email, password },
    ...options,
  });
}

function interceptLoginFence(db, outcome) {
  return {
    prepare: (...arguments_) => db.prepare(...arguments_),
    async batch() {
      if (outcome instanceof Error) throw outcome;
      return [
        { success: true, results: [outcome] },
        { success: true, results: [outcome] },
      ];
    },
  };
}

function softDeleteAfterLoginLookup(db, userId) {
  let deleted = false;
  return {
    prepare(sql) {
      const statement = db.prepare(sql);
      if (!sql.includes("FROM users WHERE email=? AND deleted_at IS NULL")) return statement;
      return {
        bind(...values) {
          const bound = statement.bind(...values);
          return {
            async first() {
              const row = await bound.first();
              if (row && !deleted) {
                deleted = true;
                await db.prepare("UPDATE users SET deleted_at=? WHERE id=?")
                  .bind("2026-08-16 12:00:00", userId)
                  .run();
              }
              return row;
            },
            run: (...arguments_) => bound.run(...arguments_),
            all: (...arguments_) => bound.all(...arguments_),
          };
        },
        first: (...arguments_) => statement.first(...arguments_),
        run: (...arguments_) => statement.run(...arguments_),
        all: (...arguments_) => statement.all(...arguments_),
      };
    },
    batch: (...arguments_) => db.batch(...arguments_),
  };
}

test("0017 creates a bounded, account-keyed fence that cannot retain login identifiers", { timeout: 30_000 }, async (context) => {
  const { DB, env } = await environment(context, "migration");
  const columns = (await DB.prepare("PRAGMA table_info(login_attempt_fences)").all()).results;
  assert.deepEqual(columns.map(({ name }) => name), [
    "user_id",
    "window_started_at",
    "expires_at",
    "request_count",
    "limit_count",
    "updated_at",
  ]);
  assert.equal(columns.find(({ name }) => name === "user_id")?.pk, 1);
  assert.equal(columns.some(({ name }) => /email|ip|password|hash/iu.test(name)), false);

  const foreignKeys = (await DB.prepare("PRAGMA foreign_key_list(login_attempt_fences)").all()).results;
  assert.equal(foreignKeys.some(({ from, table, to, on_delete }) => (
    from === "user_id" && table === "users" && to === "id" && on_delete === "CASCADE"
  )), true);

  const user = await register(env, "privacy-owner@example.test");
  for (const timestamps of [
    ["0000-invalid", "2026-08-16 12:15:00", "2026-08-16 12:05:00"],
    ["2026-08-16 12:00:00", "zzzz-invalid", "2026-08-16 12:05:00"],
    ["2026-08-16 12:00:00", "2026-08-16 12:15:00", "2026-08-16 12:05:00x"],
  ]) {
    await assert.rejects(
      DB.prepare(
        `INSERT INTO login_attempt_fences
           (user_id,window_started_at,expires_at,request_count,limit_count,updated_at)
         VALUES (?,?,?,?,?,?)`,
      ).bind(user.id, timestamps[0], timestamps[1], 1, 12, timestamps[2]).run(),
      /constraint/iu,
    );
  }
  assert.equal((await DB.prepare("SELECT COUNT(*) AS count FROM login_attempt_fences").first()).count, 0);
  const failed = await login(
    { ...env, GRIHAGRID_CACHE: new MemoryKv({ nonAtomic: true }) },
    user.email,
    WRONG_PASSWORD,
  );
  assert.equal(failed.response.status, 401);
  const rows = (await DB.prepare("SELECT * FROM login_attempt_fences").all()).results;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user_id, user.id);
  assert.equal(rows[0].limit_count, 12);
  assert.equal(JSON.stringify(rows).includes(user.email), false);

  const unknown = await login(
    { ...env, GRIHAGRID_CACHE: new MemoryKv({ nonAtomic: true }) },
    "unknown-person@example.test",
    WRONG_PASSWORD,
  );
  assert.equal(unknown.response.status, 401);
  assert.equal((await DB.prepare("SELECT COUNT(*) AS count FROM login_attempt_fences").first()).count, 1);
});

test("register and login reject non-strict envelopes without mutating authentication state", { timeout: 45_000 }, async (context) => {
  const { DB, env } = await environment(context, "schemas");
  const invalidRegistrations = [
    { name: "Owner", password: PASSWORD },
    { name: "Owner", email: "schema-owner@example.test" },
    { name: "Owner", email: "schema-owner@example.test", password: PASSWORD, role: "admin" },
    { name: 42, email: "schema-owner@example.test", password: PASSWORD },
    { name: "Owner", email: ["schema-owner@example.test"], password: PASSWORD },
    { name: "Owner", email: "schema-owner@example.test", password: { value: PASSWORD } },
  ];
  for (const [index, body] of invalidRegistrations.entries()) {
    const result = await call(env, "/api/auth/register", {
      body,
      ip: `203.0.113.${20 + index}`,
    });
    assert.equal(result.response.status, 400, JSON.stringify(result.payload));
    assert.equal(result.payload.code, "invalid_registration");
    assertNoCookies(result.response);
  }
  assert.equal((await DB.prepare("SELECT COUNT(*) AS count FROM users").first()).count, 0);
  assert.equal((await DB.prepare("SELECT COUNT(*) AS count FROM sessions").first()).count, 0);

  const user = await register(env, "schema-owner@example.test");
  const baselineSessions = (await DB.prepare("SELECT COUNT(*) AS count FROM sessions").first()).count;
  const invalidLogins = [
    { email: user.email },
    { password: PASSWORD },
    { email: user.email, password: PASSWORD, name: "must not cross the wire" },
    { email: [user.email], password: PASSWORD },
    { email: user.email, password: { value: PASSWORD } },
  ];
  for (const [index, body] of invalidLogins.entries()) {
    const result = await call(env, "/api/auth/login", {
      body,
      ip: `198.51.100.${20 + index}`,
    });
    assert.equal(result.response.status, 400, JSON.stringify(result.payload));
    assert.equal(result.payload.code, "invalid_login");
    assertNoCookies(result.response);
  }

  for (const password of ["short", "x".repeat(129)]) {
    const result = await login(env, user.email, password, { ip: `192.0.2.${password.length}` });
    assert.equal(result.response.status, 401);
    assert.deepEqual(result.payload, {
      error: "email or password is incorrect",
      code: "invalid_credentials",
    });
    assertNoCookies(result.response);
  }
  assert.equal((await DB.prepare("SELECT COUNT(*) AS count FROM sessions").first()).count, baselineSessions);
});

test("login fails closed when either perimeter or D1 admission control is unavailable", { timeout: 45_000 }, async (context) => {
  const { DB, env } = await environment(context, "fail-closed");
  const user = await register(env, "fail-closed-owner@example.test");
  const baselineSessions = (await DB.prepare("SELECT COUNT(*) AS count FROM sessions").first()).count;

  const unavailableEnvironments = [
    { ...env, GRIHAGRID_CACHE: undefined },
    { ...env, GRIHAGRID_CACHE: new MemoryKv({ fail: true }) },
    {
      ...env,
      DB: interceptLoginFence(DB, new Error("synthetic D1 login admission failure")),
      GRIHAGRID_CACHE: new MemoryKv(),
    },
    {
      ...env,
      DB: interceptLoginFence(DB, {
        request_count: "one",
        limit_count: 12,
        window_started_at: "not-a-timestamp",
        expires_at: null,
      }),
      GRIHAGRID_CACHE: new MemoryKv(),
    },
  ];
  for (const [index, unavailableEnv] of unavailableEnvironments.entries()) {
    const result = await login(unavailableEnv, user.email, PASSWORD, { ip: `192.0.2.${40 + index}` });
    assert.equal(result.response.status, 503, JSON.stringify(result.payload));
    assert.equal(result.payload.code, "abuse_control_unavailable");
    assertNoCookies(result.response);
  }
  assert.equal((await DB.prepare("SELECT COUNT(*) AS count FROM sessions").first()).count, baselineSessions);
  assert.equal((await DB.prepare("SELECT COUNT(*) AS count FROM login_attempt_fences").first()).count, 0);
});

test("wrong, unknown, and fenced accounts have one outward credential-failure response", { timeout: 60_000 }, async (context) => {
  const { DB, env } = await environment(context, "indistinguishable");
  const user = await register(env, "indistinguishable-owner@example.test");
  const loginEnv = { ...env, GRIHAGRID_CACHE: new MemoryKv({ nonAtomic: true }) };
  const baselineSessions = (await DB.prepare("SELECT COUNT(*) AS count FROM sessions").first()).count;

  const wrong = await login(loginEnv, user.email, WRONG_PASSWORD);
  const unknown = await login(loginEnv, "nobody-here@example.test", WRONG_PASSWORD);
  for (let index = 1; index < 12; index += 1) {
    const attempt = await login(loginEnv, user.email, WRONG_PASSWORD);
    assert.equal(attempt.response.status, 401);
  }
  const fenced = await login(loginEnv, user.email, PASSWORD);

  assert.deepEqual(failureSignature(unknown), failureSignature(wrong));
  assert.deepEqual(failureSignature(fenced), failureSignature(wrong));
  assert.deepEqual(wrong.payload, {
    error: "email or password is incorrect",
    code: "invalid_credentials",
  });
  assertNoCookies(wrong.response);
  assertNoCookies(unknown.response);
  assertNoCookies(fenced.response);
  assert.equal((await DB.prepare(
    "SELECT request_count FROM login_attempt_fences WHERE user_id=?",
  ).bind(user.id).first()).request_count, 12);
  assert.equal((await DB.prepare("SELECT COUNT(*) AS count FROM login_attempt_fences").first()).count, 1);
  assert.equal((await DB.prepare("SELECT COUNT(*) AS count FROM sessions").first()).count, baselineSessions);
});

test("a soft-delete race with an existing fence remains a generic credential failure", { timeout: 45_000 }, async (context) => {
  const { DB, env } = await environment(context, "deleted-race");
  const user = await register(env, "deleted-race-owner@example.test");
  const loginEnv = { ...env, GRIHAGRID_CACHE: new MemoryKv({ nonAtomic: true }) };
  const wrong = await login(loginEnv, user.email, WRONG_PASSWORD);
  assert.equal(wrong.response.status, 401);
  assert.equal((await DB.prepare(
    "SELECT request_count FROM login_attempt_fences WHERE user_id=?",
  ).bind(user.id).first()).request_count, 1);
  const sessionsBefore = (await DB.prepare("SELECT COUNT(*) AS count FROM sessions").first()).count;

  const raced = await login({
    ...loginEnv,
    DB: softDeleteAfterLoginLookup(DB, user.id),
  }, user.email, PASSWORD);

  assert.deepEqual(failureSignature(raced), failureSignature(wrong));
  assertNoCookies(raced.response);
  assert.equal((await DB.prepare(
    "SELECT request_count FROM login_attempt_fences WHERE user_id=?",
  ).bind(user.id).first()).request_count, 1, "the deleted subject must not consume or reveal its existing fence");
  assert.equal((await DB.prepare("SELECT COUNT(*) AS count FROM sessions").first()).count, sessionsBefore);
});

test("twenty parallel guesses admit at most twelve password checks without exposing the fence", { timeout: 90_000 }, async (context) => {
  const { DB, env } = await environment(context, "parallel");
  const user = await register(env, "parallel-owner@example.test");
  const loginEnv = { ...env, GRIHAGRID_CACHE: new MemoryKv({ nonAtomic: true }) };
  const results = await Promise.all(Array.from({ length: 20 }, () => (
    login(loginEnv, user.email, WRONG_PASSWORD)
  )));

  for (const result of results) {
    assert.equal(result.response.status, 401, JSON.stringify(result.payload));
    assert.deepEqual(result.payload, {
      error: "email or password is incorrect",
      code: "invalid_credentials",
    });
    assertNoCookies(result.response);
  }
  assert.deepEqual(await DB.prepare(
    `SELECT request_count,limit_count
       FROM login_attempt_fences
      WHERE user_id=?`,
  ).bind(user.id).first(), { request_count: 12, limit_count: 12 });
});

test("the exact expiry instant starts a fresh window and successful login erases prior failures", { timeout: 60_000 }, async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-08-16T12:00:00.000Z") });
  const { DB, env } = await environment(context, "expiry");
  const user = await register(env, "expiry-owner@example.test");
  const loginEnv = { ...env, GRIHAGRID_CACHE: new MemoryKv({ nonAtomic: true }) };

  const first = await login(loginEnv, user.email, WRONG_PASSWORD);
  assert.equal(first.response.status, 401);
  assert.deepEqual(await DB.prepare(
    `SELECT window_started_at,expires_at,request_count,limit_count
       FROM login_attempt_fences WHERE user_id=?`,
  ).bind(user.id).first(), {
    window_started_at: "2026-08-16 12:00:00",
    expires_at: "2026-08-16 12:15:00",
    request_count: 1,
    limit_count: 12,
  });

  context.mock.timers.setTime(Date.parse("2026-08-16T12:15:00.000Z"));
  const atExpiry = await login(loginEnv, user.email, WRONG_PASSWORD);
  assert.equal(atExpiry.response.status, 401);
  assert.deepEqual(await DB.prepare(
    `SELECT window_started_at,expires_at,request_count,limit_count
       FROM login_attempt_fences WHERE user_id=?`,
  ).bind(user.id).first(), {
    window_started_at: "2026-08-16 12:15:00",
    expires_at: "2026-08-16 12:30:00",
    request_count: 1,
    limit_count: 12,
  });

  context.mock.timers.setTime(Date.parse("2026-08-16T12:15:01.000Z"));
  const success = await login(loginEnv, user.email, PASSWORD);
  assert.equal(success.response.status, 200, JSON.stringify(success.payload));
  assert.ok(setCookies(success.response).some((cookie) => cookie.startsWith("__Host-grihagrid_session=")));
  assert.equal(await DB.prepare(
    "SELECT user_id FROM login_attempt_fences WHERE user_id=?",
  ).bind(user.id).first(), null);
});
