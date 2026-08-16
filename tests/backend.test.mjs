import assert from "node:assert/strict";
import test from "node:test";
import worker, { __test } from "../worker/index.js";

const ORIGIN = "https://app.example.test";
const assets = { fetch: async () => new Response("missing", { status: 404 }) };

function request(path, init = {}) {
  return new Request(`${ORIGIN}${path}`, init);
}

class MemoryD1 {
  constructor() {
    this.users = [];
    this.sessions = [];
    this.projects = [];
    this.failSessionDelete = false;
  }

  prepare(sql) {
    return new MemoryStatement(this, sql.replace(/\s+/gu, " ").trim());
  }
}

class MemoryKv {
  constructor() {
    this.values = new Map();
  }

  async get(key) {
    return this.values.get(key) || null;
  }

  async put(key, value) {
    this.values.set(key, value);
  }
}

class MemoryStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async first() {
    if (this.sql.startsWith("SELECT id,email,name,created_at,password_hash,password_salt,password_iterations,password_algorithm,")) {
      const user = this.db.users.find((candidate) => candidate.email === this.values[0] && !candidate.deleted_at);
      return user ? { ...user } : null;
    }
    if (this.sql.startsWith("SELECT id FROM users WHERE email=")) {
      const user = this.db.users.find((candidate) => candidate.email === this.values[0]);
      return user ? { id: user.id } : null;
    }
    if (this.sql.includes("FROM sessions s JOIN users u")) {
      const now = new Date().toISOString().slice(0, 19).replace("T", " ");
      const session = this.db.sessions.find((candidate) => (
        candidate.token_hash === this.values[0] && candidate.expires_at > now
      ));
      const user = session && this.db.users.find((candidate) => candidate.id === session.user_id);
      return user && !user.deleted_at ? {
        session_id: session.id,
        user_id: user.id,
        csrf_hash: session.csrf_hash,
        expires_at: session.expires_at,
        auth_generation: session.auth_generation,
        auth_revision_id: session.auth_revision_id,
        email: user.email,
        name: user.name,
        user_created_at: user.created_at,
        password_hash: user.password_hash,
        password_salt: user.password_salt,
        password_iterations: user.password_iterations,
        password_algorithm: user.password_algorithm,
        password_changed_at: user.password_changed_at,
      } : null;
    }
    if (this.sql.startsWith("INSERT INTO sessions")) {
      const [id, user_id, token_hash, csrf_hash, expires_at, created_at, last_seen_at, auth_generation, auth_revision_id] = this.values;
      const user = this.db.users.find((candidate) => candidate.id === user_id && !candidate.deleted_at
        && candidate.auth_generation === auth_generation && candidate.auth_revision_id === auth_revision_id);
      if (!user) return null;
      this.db.sessions.push({ id, user_id, token_hash, csrf_hash, expires_at, created_at, last_seen_at, auth_generation, auth_revision_id });
      return { id };
    }
    if (this.sql.includes("FROM projects p WHERE p.id=? AND p.user_id=?")) {
      const project = this.db.projects.find((candidate) => candidate.id === this.values[0] && candidate.user_id === this.values[1]);
      return project ? { ...project, report_available: 0 } : null;
    }
    throw new Error(`Unhandled MemoryD1 first(): ${this.sql}`);
  }

  async run() {
    if (this.sql.startsWith("INSERT INTO users")) {
      const [id, email, name, created_at, password_hash, password_salt, password_iterations, password_algorithm, password_changed_at] = this.values;
      this.db.users.push({
        id,
        email,
        name,
        created_at,
        password_hash,
        password_salt,
        password_iterations,
        password_algorithm,
        password_changed_at,
        auth_generation: 1,
        auth_revision_id: null,
      });
      return { success: true };
    }
    if (this.sql.startsWith("INSERT INTO sessions")) {
      const [id, user_id, token_hash, csrf_hash, expires_at, created_at, last_seen_at, auth_generation, auth_revision_id] = this.values;
      this.db.sessions.push({ id, user_id, token_hash, csrf_hash, expires_at, created_at, last_seen_at, auth_generation, auth_revision_id });
      return { success: true };
    }
    if (this.sql.startsWith("DELETE FROM sessions WHERE id=? AND user_id=?")) {
      if (this.db.failSessionDelete) throw new Error("simulated session deletion failure");
      const [id, userId] = this.values;
      const before = this.db.sessions.length;
      this.db.sessions = this.db.sessions.filter((session) => session.id !== id || session.user_id !== userId);
      return { success: true, meta: { changes: before - this.db.sessions.length } };
    }
    if (this.sql.startsWith("INSERT INTO projects")) {
      const [id, user_id, name, status, input_json, estimate_json, created_at, updated_at] = this.values;
      this.db.projects.push({ id, user_id, name, status, input_json, estimate_json, created_at, updated_at });
      return { success: true };
    }
    throw new Error(`Unhandled MemoryD1 run(): ${this.sql}`);
  }
}

function cookieHeader(response) {
  return response.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
}

function assertClearsSessionCookies(response) {
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(response.headers.getSetCookie(), [
    "__Host-grihagrid_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax",
    "grihagrid_csrf=; Path=/; Max-Age=0; Secure; SameSite=Strict",
  ]);
}

async function registerAuth(DB, email = "logout-owner@example.test") {
  const response = await worker.fetch(request("/api/auth/register", {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ email, password: "correct horse battery staple" }),
  }), { ASSETS: assets, DB });
  assert.equal(response.status, 201);
  return { body: await response.json(), cookies: cookieHeader(response) };
}

async function loginAuth(DB, email = "logout-owner@example.test") {
  const response = await worker.fetch(request("/api/auth/login", {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ email, password: "correct horse battery staple" }),
  }), { ASSETS: assets, DB });
  assert.equal(response.status, 200);
  return { body: await response.json(), cookies: cookieHeader(response) };
}

test("password records use salted PBKDF2 and verify without storing plaintext", async () => {
  const first = await __test.makePasswordRecord("correct horse battery staple");
  const second = await __test.makePasswordRecord("correct horse battery staple");
  assert.equal(first.algorithm, "PBKDF2-SHA256");
  assert.equal(first.iterations, 100_000);
  assert.notEqual(first.salt, second.salt);
  assert.notEqual(first.hash, second.hash);
  assert.equal(await __test.verifyPassword("correct horse battery staple", {
    password_hash: first.hash,
    password_salt: first.salt,
    password_iterations: first.iterations,
    password_algorithm: first.algorithm,
  }), true);
  assert.equal(await __test.verifyPassword("wrong password", {
    password_hash: first.hash,
    password_salt: first.salt,
    password_iterations: first.iterations,
    password_algorithm: first.algorithm,
  }), false);
});

test("stable report inputs hash independently of object insertion order", () => {
  const left = { width: 30, details: { road: "east", trees: ["neem", "mango"] }, length: 50 };
  const right = { length: 50, details: { trees: ["neem", "mango"], road: "east" }, width: 30 };
  assert.equal(__test.stableStringify(left), __test.stableStringify(right));
});

test("project validation rejects unsafe dimensions and oversized nested values", () => {
  assert.throws(() => __test.normalizeProjectInput({ width: 2, length: 50 }), /between 10 and 500/u);
  assert.throws(() => __test.normalizeProjectInput({ width: 30, length: 50, notes: "x".repeat(5001) }), /oversized/u);
});

test("report generation preserves 5+ bedrooms and treats None as no parking", () => {
  const input = {
    width: 30,
    length: 50,
    floors: "G+1",
    bedrooms: "5+",
    parking: "None",
    city: "Pune",
    quality: "Signature",
  };
  const estimate = __test.computeEstimate(input);
  const report = __test.buildReport({
    id: "project-5-bedroom",
    name: "Large family home",
    input_json: JSON.stringify(input),
    estimate_json: JSON.stringify(estimate),
  }, "input-hash", "report-id", "2026-08-13 00:00:00");

  assert.equal(report.summary.bedrooms, 5);
  assert.equal(report.areaProgram.suggestedSpaces.includes("5 bedrooms"), true);
  assert.equal(report.areaProgram.suggestedSpaces.some((space) => space.startsWith("Arrival court")), true);
  assert.equal(report.areaProgram.suggestedSpaces.some((space) => space.includes("parking bay")), false);
  assert.equal(report.version, 2);
  assert.equal(report.summary.verdict.includes("feasible"), false);
  assert.equal(report.areaProgram.suggestedSpaces.some((space) => /code-compliant|at least one on-plot/iu.test(space)), false);
});

test("file validation strips path components and enforces declared signatures", () => {
  assert.equal(__test.normalizeFileName("../../site-plan.pdf"), "site-plan.pdf");
  assert.throws(() => __test.normalizeFileName("../"), /file name/u);
  assert.equal(__test.verifyFileSignature(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]), "application/pdf"), true);
  assert.equal(__test.verifyFileSignature(new Uint8Array([0x4d, 0x5a, 0x90]), "application/pdf"), false);
});

test("authenticated routes fail closed when D1 is unavailable", async () => {
  const response = await worker.fetch(request("/api/auth/me"), { ASSETS: assets });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "database is not configured", code: "database_unavailable" });
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("access-control-allow-origin"), null);
});

test("auth writes reject cross-origin requests before touching D1", async () => {
  const response = await worker.fetch(request("/api/auth/register", {
    method: "POST",
    headers: { origin: "https://evil.example", "content-type": "application/json" },
    body: JSON.stringify({ email: "owner@example.test", password: "long-enough-password" }),
  }), { ASSETS: assets });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "origin_rejected");
});

test("project writes require a session before accepting project input", async () => {
  const response = await worker.fetch(request("/api/projects", {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ width: 30, length: 50 }),
  }), { ASSETS: assets });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "database_unavailable");
});

test("CSRF protection requires matching cookie, header, and server-side hash", async () => {
  const token = "csrf-token-created-at-login";
  const session = { csrf_hash: await __test.digestBase64(token) };
  await assert.doesNotReject(() => __test.requireCsrf(request("/api/projects", {
    method: "POST",
    headers: { cookie: `grihagrid_csrf=${token}`, "x-csrf-token": token },
  }), session));
  await assert.rejects(() => __test.requireCsrf(request("/api/projects", {
    method: "POST",
    headers: { cookie: `grihagrid_csrf=${token}`, "x-csrf-token": "attacker-token" },
  }), session), /valid CSRF token/u);
});

test("logout revokes the active D1 session, clears both cookies, and is safe to replay", async () => {
  const DB = new MemoryD1();
  const env = { ASSETS: assets, DB };
  const auth = await registerAuth(DB);
  const otherDevice = await loginAuth(DB);
  assert.equal(DB.sessions.length, 2);

  const response = await worker.fetch(request("/api/auth/logout", {
    method: "POST",
    headers: { origin: ORIGIN, cookie: auth.cookies, "x-csrf-token": auth.body.csrfToken },
  }), env);
  assert.equal(response.status, 204);
  assert.equal(await response.text(), "");
  assertClearsSessionCookies(response);
  assert.equal(DB.sessions.length, 1);

  const revoked = await worker.fetch(request("/api/auth/me", {
    headers: { cookie: auth.cookies },
  }), env);
  assert.equal(revoked.status, 401);
  assert.equal((await revoked.json()).code, "unauthenticated");

  const otherDeviceStillActive = await worker.fetch(request("/api/auth/me", {
    headers: { cookie: otherDevice.cookies },
  }), env);
  assert.equal(otherDeviceStillActive.status, 200);
  assert.equal((await otherDeviceStillActive.json()).user.email, "logout-owner@example.test");

  const replay = await worker.fetch(request("/api/auth/logout", {
    method: "POST",
    headers: { origin: ORIGIN, cookie: auth.cookies, "x-csrf-token": auth.body.csrfToken },
  }), env);
  assert.equal(replay.status, 204);
  assertClearsSessionCookies(replay);
  assert.equal(DB.sessions.length, 1, "logout replay must not revoke another device session");
});

test("logout clears stale cookies when no active session exists", async () => {
  const DB = new MemoryD1();
  const env = { ASSETS: assets, DB };

  const noSession = await worker.fetch(request("/api/auth/logout", {
    method: "POST",
    headers: { origin: ORIGIN },
  }), env);
  assert.equal(noSession.status, 204);
  assertClearsSessionCookies(noSession);

  const auth = await registerAuth(DB, "expired-logout@example.test");
  DB.sessions[0].expires_at = "2000-01-01 00:00:00";
  const expired = await worker.fetch(request("/api/auth/logout", {
    method: "POST",
    headers: { origin: ORIGIN, cookie: auth.cookies, "x-csrf-token": auth.body.csrfToken },
  }), env);
  assert.equal(expired.status, 204);
  assertClearsSessionCookies(expired);
  assert.equal(DB.sessions.length, 1, "expired rows remain for scheduled retention cleanup");
});

test("logout still requires the database before clearing unauthenticated cookies", async () => {
  const response = await worker.fetch(request("/api/auth/logout", {
    method: "POST",
    headers: { origin: ORIGIN, cookie: "__Host-grihagrid_session=stale-session" },
  }), { ASSETS: assets });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "database_unavailable");
  assert.deepEqual(response.headers.getSetCookie(), []);
});

test("logout rejects CSRF and untrusted origins without revoking or clearing an active session", async () => {
  const DB = new MemoryD1();
  const env = { ASSETS: assets, DB };
  const auth = await registerAuth(DB, "protected-logout@example.test");

  const badCsrf = await worker.fetch(request("/api/auth/logout", {
    method: "POST",
    headers: { origin: ORIGIN, cookie: auth.cookies, "x-csrf-token": "attacker-token" },
  }), env);
  assert.equal(badCsrf.status, 403);
  assert.equal((await badCsrf.json()).code, "csrf_rejected");
  assert.deepEqual(badCsrf.headers.getSetCookie(), []);
  assert.equal(DB.sessions.length, 1);

  const badOrigin = await worker.fetch(request("/api/auth/logout", {
    method: "POST",
    headers: { origin: "https://evil.example", cookie: auth.cookies, "x-csrf-token": auth.body.csrfToken },
  }), env);
  assert.equal(badOrigin.status, 403);
  assert.equal((await badOrigin.json()).code, "origin_rejected");
  assert.deepEqual(badOrigin.headers.getSetCookie(), []);
  assert.equal(DB.sessions.length, 1);

  const stillActive = await worker.fetch(request("/api/auth/me", {
    headers: { cookie: auth.cookies },
  }), env);
  assert.equal(stillActive.status, 200);
});

test("logout deletion failure returns 500 without clearing or pretending to revoke the session", async () => {
  const DB = new MemoryD1();
  const env = { ASSETS: assets, DB };
  const auth = await registerAuth(DB, "failed-logout@example.test");
  DB.failSessionDelete = true;

  const failed = await worker.fetch(request("/api/auth/logout", {
    method: "POST",
    headers: { origin: ORIGIN, cookie: auth.cookies, "x-csrf-token": auth.body.csrfToken },
  }), env);
  assert.equal(failed.status, 500);
  assert.equal((await failed.json()).code, "internal_error");
  assert.deepEqual(failed.headers.getSetCookie(), []);
  assert.equal(DB.sessions.length, 1);

  const stillActive = await worker.fetch(request("/api/auth/me", {
    headers: { cookie: auth.cookies },
  }), env);
  assert.equal(stillActive.status, 200);

  DB.failSessionDelete = false;
  const retry = await worker.fetch(request("/api/auth/logout", {
    method: "POST",
    headers: { origin: ORIGIN, cookie: auth.cookies, "x-csrf-token": auth.body.csrfToken },
  }), env);
  assert.equal(retry.status, 204);
  assertClearsSessionCookies(retry);
  assert.equal(DB.sessions.length, 0);
});

test("project ownership lookup is always scoped to both project and user", async () => {
  const calls = [];
  const db = {
    prepare(sql) {
      assert.match(sql, /p\.id=\? AND p\.user_id=\?/u);
      return {
        bind(...values) {
          calls.push(values);
          return { first: async () => null };
        },
      };
    },
  };
  await assert.rejects(() => __test.ownedProject(db, "project-a", "user-b"), /project not found/u);
  assert.deepEqual(calls, [["project-a", "user-b"]]);
});

test("end-to-end sessions isolate projects between registered users", async () => {
  const DB = new MemoryD1();
  const env = { ASSETS: assets, DB, GRIHAGRID_CACHE: new MemoryKv() };
  const register = async (email) => {
    const response = await worker.fetch(request("/api/auth/register", {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ email, password: "correct horse battery staple" }),
    }), env);
    assert.equal(response.status, 201);
    const body = await response.json();
    return { body, cookies: cookieHeader(response) };
  };

  const owner = await register("owner@example.test");
  const other = await register("other@example.test");
  assert.equal(DB.users.some((user) => user.password_hash === "correct horse battery staple"), false);
  const createdResponse = await worker.fetch(request("/api/projects", {
    method: "POST",
    headers: {
      origin: ORIGIN,
      cookie: owner.cookies,
      "x-csrf-token": owner.body.csrfToken,
      "content-type": "application/json",
    },
    body: JSON.stringify({ name: "Owner home", input: { width: 30, length: 50, city: "Pune" } }),
  }), env);
  assert.equal(createdResponse.status, 201);
  const project = (await createdResponse.json()).project;

  const otherResponse = await worker.fetch(request(`/api/projects/${project.id}`, {
    headers: { cookie: other.cookies },
  }), env);
  assert.equal(otherResponse.status, 404);
  assert.equal((await otherResponse.json()).code, "project_not_found");
});

test("same-origin auth preflights never emit wildcard CORS", async () => {
  const response = await worker.fetch(request("/api/projects", {
    method: "OPTIONS",
    headers: { origin: ORIGIN, "access-control-request-method": "POST" },
  }), { ASSETS: assets });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), ORIGIN);
  assert.notEqual(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(response.headers.get("access-control-allow-credentials"), "true");
});

test("unknown nested API routes bypass assets and return bounded JSON", async () => {
  let assetCalls = 0;
  const response = await worker.fetch(request("/api/projects/not-a-project/unknown"), {
    ASSETS: { fetch: async () => { assetCalls += 1; return new Response("missing", { status: 404 }); } },
  });
  assert.equal(response.status, 404);
  assert.equal(assetCalls, 0);
  assert.match(response.headers.get("content-type") || "", /^application\/json\b/u);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { error: "not found", code: "not_found" });
});

test("balanced Decision Compare recommendation stays consistent with its rationale", async () => {
  const project = {
    name: "Pune family home",
    updated_at: "2026-08-14 00:00:00",
    input_json: JSON.stringify({
      width: 30,
      length: 50,
      city: "Pune",
      floors: "G+1",
      bedrooms: 3,
      parking: true,
      quality: "Signature",
    }),
  };
  const content = __test.buildDecisionContent(project, "balanced", [
    { label: "Balanced brief", floors: "G+1", bedrooms: 3, parking: true, quality: "Signature", notes: "" },
    { label: "Space-forward brief", floors: "G+2", bedrooms: 4, parking: true, quality: "Signature", notes: "" },
  ], "comparison-id", "a".repeat(64));
  assert.equal(content.recommendation.scenarioId, "comparison-id_a");
  assert.match(content.recommendation.rationale, /closer to the current brief/u);
});
