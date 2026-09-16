import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import worker from "../worker/index.js";
import { createDemoBuilding } from "../src/spatial/model.js";
import { generateTour } from "../src/spatial/tours.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDirectory = path.join(root, "migrations");
const ORIGIN = "https://app.example.test";
const EMAIL = "lifecycle-owner@example.test";
const INITIAL_PASSWORD = "correct horse battery staple";
const RESET_PASSWORD = "a reset password for September 2026";
const assets = { fetch: async () => new Response("missing", { status: 404 }) };

class MemoryKv {
  constructor() { this.values = new Map(); }
  async get(key) { return this.values.get(key) || null; }
  async put(key, value) { this.values.set(key, String(value)); }
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
  assert.equal(lines.length, 0);
  return statements;
}

async function database(context) {
  const miniflare = new Miniflare({
    workers: [{
      config: {
        name: "account-lifecycle-worker",
        type: "worker",
        compatibilityDate: "2026-08-01",
        manifest: {
          mainModule: "index.mjs",
          modulesRoot: process.cwd(),
          modules: { "index.mjs": { type: "esm", contents: "export default {}" } },
        },
        env: { DB: { type: "d1", name: "account-lifecycle-db" } },
      },
    }],
  });
  context.after(() => miniflare.dispose());
  const db = await miniflare.getD1Database("DB");
  const names = (await readdir(migrationsDirectory)).filter((name) => name.endsWith(".sql")).sort();
  for (const name of names) {
    const source = await readFile(path.join(migrationsDirectory, name), "utf8");
    for (const statement of migrationStatements(source)) await db.prepare(statement).run();
  }
  return db;
}

async function call(env, pathname, {
  method = "GET",
  body,
  auth,
  ip = "203.0.113.44",
} = {}) {
  const headers = new Headers({ "cf-connecting-ip": ip });
  if (!["GET", "HEAD"].includes(method)) headers.set("origin", ORIGIN);
  if (body !== undefined) headers.set("content-type", "application/json");
  if (auth) {
    headers.set("cookie", auth.cookie);
    headers.set("x-csrf-token", auth.csrf);
  }
  const response = await worker.fetch(new Request(`${ORIGIN}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
  const text = await response.text();
  return { response, payload: text ? JSON.parse(text) : null };
}

function authFrom(result) {
  const cookies = typeof result.response.headers.getSetCookie === "function"
    ? result.response.headers.getSetCookie()
    : [result.response.headers.get("set-cookie") || ""];
  const session = /__Host-grihagrid_session=([^;,]+)/u.exec(cookies.join(";"))?.[1];
  assert.ok(session);
  assert.equal(typeof result.payload.csrfToken, "string");
  return {
    csrf: result.payload.csrfToken,
    cookie: `__Host-grihagrid_session=${session}; grihagrid_csrf=${result.payload.csrfToken}`,
  };
}

function tokenFromMessage(message, route) {
  const body = JSON.parse(message.options.body);
  const match = new RegExp(`${route.replace("/", "\\/")}#token=([A-Za-z0-9_-]{43})`, "u").exec(body.text);
  assert.ok(match, `expected a fragment-only ${route} action`);
  return match[1];
}

test("account verification, recovery, export, and deletion are private and lifecycle-complete", { timeout: 60_000 }, async (context) => {
  const DB = await database(context);
  const messages = [];
  const env = {
    APP_ENV: "test",
    APP_ORIGIN: ORIGIN,
    ASSETS: assets,
    DB,
    GRIHAGRID_CACHE: new MemoryKv(),
    RESEND_API_KEY: "re_test_lifecycle",
    TRANSACTIONAL_EMAIL_FROM: "GrihaGrid <security@example.test>",
    RESEND_FETCH: async (url, options) => {
      assert.equal(url, "https://api.resend.com/emails");
      assert.match(options.headers.authorization, /^Bearer re_/u);
      assert.equal(options.headers["user-agent"], "grihagrid-worker/1.0");
      messages.push({ url, options });
      return new Response(JSON.stringify({ id: `email-${messages.length}` }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
    PAID_CHECKOUT_ENABLED: "false",
    DECISION_COMPARE_FULFILLMENT_ENABLED: "false",
    ENABLED_PAYMENT_PLANS: "",
  };

  const registration = await call(env, "/api/auth/register", {
    method: "POST",
    body: { email: EMAIL, name: "Lifecycle Owner", password: INITIAL_PASSWORD },
  });
  assert.equal(registration.response.status, 201, JSON.stringify(registration.payload));
  assert.equal(registration.payload.user.emailVerified, false);
  let auth = authFrom(registration);

  const verification = await call(env, "/api/auth/email-verification/request", {
    method: "POST",
    body: {},
    auth,
  });
  assert.equal(verification.response.status, 202, JSON.stringify(verification.payload));
  const verificationToken = tokenFromMessage(messages.at(-1), "/verify-email");
  assert.equal(JSON.stringify((await DB.prepare("SELECT * FROM email_verification_tokens").all()).results).includes(verificationToken), false);

  const verified = await call(env, "/api/auth/email-verification/confirm", {
    method: "POST",
    body: { token: verificationToken },
  });
  assert.equal(verified.response.status, 200, JSON.stringify(verified.payload));
  assert.equal(verified.payload.verified, true);
  assert.equal((await call(env, "/api/auth/me", { auth })).payload.user.emailVerified, true);
  const replay = await call(env, "/api/auth/email-verification/confirm", {
    method: "POST",
    body: { token: verificationToken },
  });
  assert.equal(replay.response.status, 400);

  const beforeUnknown = messages.length;
  const unknownReset = await call(env, "/api/auth/password-reset/request", {
    method: "POST",
    body: { email: "unknown-lifecycle@example.test" },
    ip: "203.0.113.45",
  });
  assert.deepEqual({ status: unknownReset.response.status, payload: unknownReset.payload }, {
    status: 202,
    payload: { accepted: true },
  });
  assert.equal(messages.length, beforeUnknown);

  const resetRequest = await call(env, "/api/auth/password-reset/request", {
    method: "POST",
    body: { email: EMAIL },
    ip: "203.0.113.46",
  });
  assert.deepEqual({ status: resetRequest.response.status, payload: resetRequest.payload }, {
    status: 202,
    payload: { accepted: true },
  });
  const resetToken = tokenFromMessage(messages.at(-1), "/reset-password");
  const reset = await call(env, "/api/auth/password-reset/confirm", {
    method: "POST",
    body: { token: resetToken, newPassword: RESET_PASSWORD },
    ip: "203.0.113.47",
  });
  assert.equal(reset.response.status, 204);
  assert.equal((await call(env, "/api/auth/me", { auth })).response.status, 401, "reset must revoke the earlier session");
  assert.equal((await call(env, "/api/auth/login", {
    method: "POST",
    body: { email: EMAIL, password: INITIAL_PASSWORD },
    ip: "203.0.113.48",
  })).response.status, 401);
  const newLogin = await call(env, "/api/auth/login", {
    method: "POST",
    body: { email: EMAIL, password: RESET_PASSWORD },
    ip: "203.0.113.49",
  });
  assert.equal(newLogin.response.status, 200, JSON.stringify(newLogin.payload));
  auth = authFrom(newLogin);

  // The export must include spatial history while keeping another account's
  // layout and internal persistence keys out of the artifact.
  const projectInput = { width: 30, length: 50, floors: "G+1", city: "Pune", quality: "Signature", style: "Courtyard" };
  const ownProject = await call(env, "/api/projects", { method: "POST", auth, body: { name: "Lifecycle spatial home", input: projectInput } });
  assert.equal(ownProject.response.status, 201, JSON.stringify(ownProject.payload));
  const otherRegistration = await call(env, "/api/auth/register", { method: "POST", ip: "203.0.113.51", body: { email: "other-spatial-owner@example.test", password: INITIAL_PASSWORD } });
  assert.equal(otherRegistration.response.status, 201);
  const otherAuth = authFrom(otherRegistration);
  const otherProject = await call(env, "/api/projects", { method: "POST", auth: otherAuth, body: { name: "FOREIGN-SPATIAL-HOME", input: projectInput } });
  assert.equal(otherProject.response.status, 201);
  const ownId = ownProject.payload.project.id, otherId = otherProject.payload.project.id;
  const model = createDemoBuilding(), tour = generateTour(model, { duration: 10 });
  const viewpoint = { id: "export-view", name: "Saved family room view", buildingId: model.id, sourceRevision: 1, position: [2500,3000,1650], target: [2500,2000,1000], fov: 60 };
  for (const [projectId, marker] of [[ownId, "OWN-SPATIAL"], [otherId, "FOREIGN-SPATIAL"]]) {
    await DB.prepare("INSERT INTO spatial_revisions (project_id,revision,input_revision,model_json,request_key,request_hash) VALUES (?,1,1,?,?,?)")
      .bind(projectId, JSON.stringify({ ...model, name: marker }), "PRIVATE-SPATIAL-REQUEST-KEY", "PRIVATE-SPATIAL-REQUEST-HASH").run();
    await DB.prepare("INSERT INTO spatial_tour_revisions (project_id,revision,spatial_revision,input_revision,tour_json,request_key,request_hash) VALUES (?,1,1,1,?,?,?)")
      .bind(projectId, JSON.stringify({ ...tour, name: marker + " tour" }), "PRIVATE-TOUR-REQUEST-KEY", "PRIVATE-TOUR-REQUEST-HASH").run();
    await DB.prepare("INSERT INTO spatial_camera_revisions (project_id,revision,spatial_revision,input_revision,viewpoints_json,request_key,request_hash) VALUES (?,1,1,1,?,?,?)")
      .bind(projectId, JSON.stringify([{ ...viewpoint, name: marker + " camera" }]), "PRIVATE-CAMERA-REQUEST-KEY", "PRIVATE-CAMERA-REQUEST-HASH").run();
  }
  await DB.prepare("INSERT INTO spatial_revisions (project_id,revision,input_revision,model_json,request_key,request_hash) VALUES (?,2,1,?,?,?)")
    .bind(ownId, JSON.stringify({ ...model, revision: 2, name: "OWN-SPATIAL revised" }), "PRIVATE-SECOND-REQUEST-KEY", "PRIVATE-SECOND-REQUEST-HASH").run();

  const exported = await call(env, "/api/account/export", { auth });
  assert.equal(exported.response.status, 200, JSON.stringify(exported.payload));
  assert.match(exported.response.headers.get("content-disposition"), /grihagrid-account-export\.json/u);
  assert.equal(exported.payload.profile.email, EMAIL);
  assert.equal(exported.payload.profile.emailVerifiedAt !== null, true);
  assert.equal(JSON.stringify(exported.payload).includes("password_hash"), false);
  assert.equal(JSON.stringify(exported.payload).includes("token_hash"), false);
  assert.equal(exported.payload.exportVersion, 1);
  assert.deepEqual(exported.payload.spatialLayouts.map(row => row.revision), [1, 2]);
  assert.equal(exported.payload.spatialLayouts[0].model.rooms.length, model.rooms.length);
  assert.equal(exported.payload.spatialTours[0].tour.shots.length, tour.shots.length);
  assert.equal(exported.payload.spatialCameras[0].viewpoints[0].name, "OWN-SPATIAL camera");
  assert.ok([exported.payload.spatialLayouts, exported.payload.spatialTours, exported.payload.spatialCameras].every(rows => rows.length && rows.every(row => row.projectId === ownId && row.inputRevision === 1)));
  for (const secret of ["FOREIGN-SPATIAL", otherId, "PRIVATE-SPATIAL", "PRIVATE-TOUR", "PRIVATE-CAMERA", "PRIVATE-SECOND", "request_hash", "request_key"])
    assert.equal(JSON.stringify(exported.payload).includes(secret), false, `Export contains ${secret}`);

  const deleted = await call(env, "/api/account", {
    method: "DELETE",
    body: { currentPassword: RESET_PASSWORD, confirmation: "DELETE" },
    auth,
    ip: "203.0.113.50",
  });
  assert.equal(deleted.response.status, 204, JSON.stringify(deleted.payload));
  assert.equal((await call(env, "/api/auth/me", { auth })).response.status, 401);
  assert.equal((await DB.prepare("SELECT COUNT(*) AS count FROM users WHERE email=?").bind(EMAIL).first()).count, 0);
  assert.equal((await DB.prepare("SELECT COUNT(*) AS count FROM users WHERE email=?").bind("other-spatial-owner@example.test").first()).count, 1);
  for (const table of ["spatial_revisions", "spatial_tour_revisions", "spatial_camera_revisions"]) {
    assert.equal((await DB.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE project_id=?`).bind(ownId).first()).count, 0);
    assert.equal((await DB.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE project_id=?`).bind(otherId).first()).count, 1);
  }
  assert.equal((await call(env, "/api/auth/me", { auth: otherAuth })).response.status, 200);
  assert.equal((await DB.prepare("SELECT COUNT(*) AS count FROM account_deletion_receipts").first()).count, 1);
  const deliveryEvidence = (await DB.prepare(
    "SELECT user_id,purpose,outcome FROM transactional_email_events ORDER BY created_at,id",
  ).all()).results;
  assert.equal(deliveryEvidence.every((row) => row.user_id === null), true);
  assert.equal(deliveryEvidence.some((row) => row.purpose === "account_deletion" && row.outcome === "sent"), true);
});

async function deletionFixture(context, label) {
  const DB = await database(context);
  const messages = [];
  const env = {
    APP_ORIGIN: ORIGIN, ASSETS: assets, DB, GRIHAGRID_CACHE: new MemoryKv(),
    RESEND_API_KEY: "re_test_deletion_fence",
    TRANSACTIONAL_EMAIL_FROM: "GrihaGrid <security@example.test>",
    RESEND_FETCH: async (url, options) => {
      messages.push({ url, options });
      return new Response("{}", { status: 200 });
    },
    PAID_CHECKOUT_ENABLED: "false", DECISION_COMPARE_FULFILLMENT_ENABLED: "false", ENABLED_PAYMENT_PLANS: "",
  };
  const email = `delete-${label}@example.test`;
  const registration = await call(env, "/api/auth/register", {
    method: "POST", body: { email, password: INITIAL_PASSWORD },
  });
  assert.equal(registration.response.status, 201);
  const auth = authFrom(registration);
  const project = await call(env, "/api/projects", {
    method: "POST", auth,
    body: { name: "Preserve this private project", input: { width: 30, length: 50, floors: "G+1", city: "Pune", quality: "Signature", style: "Courtyard" } },
  });
  assert.equal(project.response.status, 201);
  return { DB, env, messages, email, auth, userId: registration.payload.user.id, projectId: project.payload.project.id };
}

function pauseDeletionAfterPasswordVerification(DB, expected = 1) {
  let arrivals = 0, announce, release;
  const reached = new Promise(resolve => { announce = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const wrap = statement => new Proxy(statement, {
    get(target, property) {
      if (property === "bind") return (...values) => wrap(target.bind(...values));
      if (property === "first") return async (...args) => {
        const result = await target.first(...args);
        arrivals += 1;
        if (arrivals === expected) announce();
        await gate;
        return result;
      };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return {
    reached, release,
    DB: {
      prepare(sql) {
        const statement = DB.prepare(sql);
        return sql.includes("FROM professional_profiles p") && sql.includes("WHERE p.user_id=? LIMIT 1") ? wrap(statement) : statement;
      },
      batch: statements => DB.batch(statements),
    },
  };
}

async function deletionSnapshot(DB) {
  const statements = [
    "SELECT id,auth_generation,auth_revision_id FROM users ORDER BY id",
    "SELECT id,user_id,name,input_revision FROM projects ORDER BY id",
    "SELECT project_id,revision,input_json FROM project_revisions ORDER BY project_id,revision",
    "SELECT id,user_id,auth_generation,auth_revision_id FROM sessions ORDER BY id",
    "SELECT * FROM account_deletion_requests ORDER BY id",
    "SELECT * FROM account_deletion_receipts ORDER BY request_id",
    "SELECT id,project_id,user_id,object_key FROM project_files ORDER BY id",
  ];
  return Promise.all(statements.map(async sql => (await DB.prepare(sql).all()).results));
}

for (const winner of ["reset", "revoke", "logout"]) {
  test(`account deletion commits no side effects after ${winner} wins the verified-password race`, { timeout: 60_000 }, async context => {
    const fixture = await deletionFixture(context, winner);
    const { DB, env, auth, email, messages } = fixture;
    let resetToken, otherAuth;
    if (winner === "reset") {
      const requested = await call(env, "/api/auth/password-reset/request", { method: "POST", body: { email } });
      assert.equal(requested.response.status, 202);
      resetToken = tokenFromMessage(messages.at(-1), "/reset-password");
    }
    if (winner === "revoke") {
      const login = await call(env, "/api/auth/login", { method: "POST", body: { email, password: INITIAL_PASSWORD } });
      assert.equal(login.response.status, 200);
      otherAuth = authFrom(login);
    }
    if (winner === "logout") {
      await DB.prepare(`INSERT INTO account_deletion_requests (id,user_id,status,requested_at,updated_at)
        VALUES ('earlier-request',?,'requested',datetime('now'),datetime('now'))`).bind(fixture.userId).run();
    }
    const paused = pauseDeletionAfterPasswordVerification(DB);
    const deletion = call({ ...env, DB: paused.DB }, "/api/account", {
      method: "DELETE", auth, body: { currentPassword: INITIAL_PASSWORD, confirmation: "DELETE" },
    });
    let protectedState, messageCount;
    try {
      await paused.reached;
      const rotation = winner === "reset"
        ? await call(env, "/api/auth/password-reset/confirm", { method: "POST", body: { token: resetToken, newPassword: RESET_PASSWORD } })
        : winner === "revoke"
          ? await call(env, "/api/auth/sessions/revoke-others", { method: "POST", auth: otherAuth, body: { currentPassword: INITIAL_PASSWORD } })
          : await call(env, "/api/auth/logout", { method: "POST", auth });
      assert.equal(rotation.response.status, winner === "revoke" ? 200 : 204, JSON.stringify(rotation.payload));
      assert.equal((await call(env, "/api/auth/me", { auth })).response.status, 401);
      protectedState = await deletionSnapshot(DB);
      messageCount = messages.length;
    } finally {
      paused.release();
    }
    const result = await deletion;
    assert.equal(result.response.status, 409, JSON.stringify(result.payload));
    assert.equal(result.payload.code, "account_deletion_conflict");
    assert.deepEqual(await deletionSnapshot(DB), protectedState, "The losing deletion must not alter projects, sessions, requests, receipts or private files.");
    assert.equal(messages.length, messageCount, "A rejected deletion sends no deletion notification.");
  });
}

test("concurrent account deletions have one winner and repeated deletion is unauthenticated", { timeout: 60_000 }, async context => {
  const { DB, env, auth } = await deletionFixture(context, "two-deletes");
  const paused = pauseDeletionAfterPasswordVerification(DB, 2);
  const request = () => call({ ...env, DB: paused.DB }, "/api/account", {
    method: "DELETE", auth, body: { currentPassword: INITIAL_PASSWORD, confirmation: "DELETE" },
  });
  const first = request(), second = request();
  try { await paused.reached; } finally { paused.release(); }
  const results = await Promise.all([first, second]);
  assert.deepEqual(results.map(result => result.response.status).sort(), [204, 409]);
  assert.equal(results.find(result => result.response.status === 409).payload.code, "account_deletion_conflict");
  assert.equal((await DB.prepare("SELECT COUNT(*) AS count FROM users").first()).count, 0);
  assert.equal((await DB.prepare("SELECT COUNT(*) AS count FROM projects").first()).count, 0);
  assert.equal((await DB.prepare("SELECT COUNT(*) AS count FROM account_deletion_receipts").first()).count, 1);
  assert.equal((await request()).response.status, 401);
});

test("failed final account deletion rolls back project removal and deletion bookkeeping together", { timeout: 60_000 }, async context => {
  const { DB, env, auth, userId } = await deletionFixture(context, "rollback");
  await DB.prepare(`CREATE TRIGGER synthetic_deletion_abort BEFORE DELETE ON users
    WHEN OLD.id='${userId}' BEGIN SELECT RAISE(ABORT,'synthetic deletion rollback'); END`).run();
  const before = await deletionSnapshot(DB);
  const request = () => call(env, "/api/account", {
    method: "DELETE", auth, body: { currentPassword: INITIAL_PASSWORD, confirmation: "DELETE" },
  });
  const rejected = await request();
  assert.equal(rejected.response.status, 500);
  assert.equal(rejected.payload.code, "internal_error");
  assert.equal(JSON.stringify(rejected.payload).includes("synthetic"), false);
  assert.deepEqual(await deletionSnapshot(DB), before, "D1 must roll back the request, projects and receipt when the final user deletion fails.");
  await DB.prepare("DROP TRIGGER synthetic_deletion_abort").run();
  assert.equal((await request()).response.status, 204);
});

test("private-file accounts require operational offboarding without R2 calls or deletion mutations", { timeout: 60_000 }, async context => {
  const { DB, env, auth, userId, projectId } = await deletionFixture(context, "private-file");
  await DB.prepare(`INSERT INTO project_files
    (id,project_id,user_id,object_key,file_name,content_type,size_bytes,kind,checksum_sha256,created_at)
    VALUES ('retained-file',?,?,?,'private-plan.png','image/png',100,'plan',?,datetime('now'))`)
    .bind(projectId, userId, `${userId}/${projectId}/retained-file`, "a".repeat(64)).run();
  let r2Calls = 0;
  env.FILES = new Proxy({}, { get() { r2Calls += 1; throw new Error("R2 must not be touched"); } });
  const before = await deletionSnapshot(DB);
  const result = await call(env, "/api/account", {
    method: "DELETE", auth, body: { currentPassword: INITIAL_PASSWORD, confirmation: "DELETE" },
  });
  assert.equal(result.response.status, 409);
  assert.equal(result.payload.code, "account_file_offboarding_required");
  assert.equal(r2Calls, 0);
  assert.deepEqual(await deletionSnapshot(DB), before);
  assert.equal((await call(env, "/api/auth/me", { auth })).response.status, 200);
});

test("account deletion uses one fresh authorization claim across the atomic batch", { timeout: 60_000 }, async context => {
  const { DB, env, auth, userId } = await deletionFixture(context, "expiry-boundary");
  await DB.prepare(`INSERT INTO account_deletion_requests (id,user_id,status,requested_at,updated_at)
    VALUES ('earlier-request',?,'requested',datetime('now'),datetime('now'))`).bind(userId).run();
  // Deterministically simulate expiry after the initial authorization statement.
  await DB.prepare(`CREATE TRIGGER synthetic_expire_after_deletion_claim
    AFTER UPDATE ON account_deletion_requests
    BEGIN UPDATE sessions SET expires_at=datetime('now','-1 second') WHERE user_id=NEW.user_id; END`).run();
  const result = await call(env, "/api/account", {
    method: "DELETE", auth, body: { currentPassword: INITIAL_PASSWORD, confirmation: "DELETE" },
  });
  assert.equal(result.response.status, 204, JSON.stringify(result.payload));
  for (const table of ["users", "projects", "sessions", "account_deletion_requests"]) {
    assert.equal((await DB.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first()).count, 0);
  }
  const receipts = (await DB.prepare("SELECT request_id FROM account_deletion_receipts").all()).results;
  assert.equal(receipts.length, 1);
  assert.notEqual(receipts[0].request_id, "earlier-request", "A prior request cannot authorize the current deletion.");
});

function pauseNextBatch(DB) {
  let announce, release;
  const reached = new Promise(resolve => { announce = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  return {
    reached, release,
    DB: {
      prepare: sql => DB.prepare(sql),
      async batch(statements) {
        announce();
        await gate;
        return DB.batch(statements);
      },
    },
  };
}

for (const blocker of ["order", "professional", "private-file"]) {
  test(`account deletion cannot commit when a ${blocker} appears after preflight`, { timeout: 60_000 }, async context => {
    const { DB, env, auth, userId, projectId, messages } = await deletionFixture(context, `late-${blocker}`);
    const paused = pauseNextBatch(DB);
    let r2Calls = 0;
    env.FILES = new Proxy({}, { get() { r2Calls += 1; throw new Error("R2 must not be touched"); } });
    const pending = call({ ...env, DB: paused.DB }, "/api/account", {
      method: "DELETE", auth, body: { currentPassword: INITIAL_PASSWORD, confirmation: "DELETE" },
    });
    let protectedState, blockerState, messageCount;
    const blockerTable = blocker === "order" ? "orders" : blocker === "professional" ? "professional_profiles" : "project_files";
    try {
      await paused.reached;
      if (blocker === "order") {
        await DB.prepare(`INSERT INTO orders
          (id,project_id,user_id,plan,amount_paise,idempotency_key,status,created_at,updated_at)
          VALUES ('retained-order',?,?,'plan',100,'retained-order-key','created',datetime('now'),datetime('now'))`)
          .bind(projectId, userId).run();
      } else if (blocker === "professional") {
        await DB.prepare("UPDATE users SET account_role='reviewer' WHERE id=?").bind(userId).run();
        await DB.prepare(`INSERT INTO professional_profiles
          (user_id,display_name,discipline,license_jurisdiction,license_reference,verification_status,created_at,updated_at)
          VALUES (?,'Pending Reviewer','architect','Test jurisdiction','TEST-001','pending',datetime('now'),datetime('now'))`)
          .bind(userId).run();
      } else {
        await DB.prepare(`INSERT INTO project_files
          (id,project_id,user_id,object_key,file_name,content_type,size_bytes,kind,checksum_sha256,created_at)
          VALUES ('retained-file',?,?,?,'private-plan.png','image/png',100,'plan',?,datetime('now'))`)
          .bind(projectId, userId, `${userId}/${projectId}/retained-file`, "a".repeat(64)).run();
      }
      protectedState = await deletionSnapshot(DB);
      blockerState = (await DB.prepare(`SELECT * FROM ${blockerTable}`).all()).results;
      messageCount = messages.length;
    } finally {
      paused.release();
    }
    const result = await pending;
    assert.equal(result.response.status, 409, JSON.stringify(result.payload));
    assert.equal(result.payload.code, "account_deletion_conflict");
    assert.deepEqual(await deletionSnapshot(DB), protectedState);
    assert.deepEqual((await DB.prepare(`SELECT * FROM ${blockerTable}`).all()).results, blockerState);
    assert.equal(messages.length, messageCount);
    assert.equal(r2Calls, 0);
    assert.equal((await call(env, "/api/auth/me", { auth })).response.status, 200);
  });
}

async function requestReset(env, messages, email) {
  const requested = await call(env, "/api/auth/password-reset/request", { method: "POST", body: { email } });
  assert.equal(requested.response.status, 202);
  return tokenFromMessage(messages.at(-1), "/reset-password");
}

test("password change atomically retires earlier recovery links and preserves links issued after its commit", { timeout: 60_000 }, async context => {
  const { DB, env, auth, messages, email } = await deletionFixture(context, "password-links");
  const oldToken = await requestReset(env, messages, email);
  const changed = await call(env, "/api/auth/password", {
    method: "PUT", auth, body: { currentPassword: INITIAL_PASSWORD, newPassword: RESET_PASSWORD },
  });
  assert.equal(changed.response.status, 200, JSON.stringify(changed.payload));
  const replacement = authFrom(changed);
  assert.equal((await DB.prepare("SELECT COUNT(*) AS count FROM password_reset_tokens WHERE consumed_at IS NULL").first()).count, 0);
  const stale = await call(env, "/api/auth/password-reset/confirm", {
    method: "POST", body: { token: oldToken, newPassword: "an unwanted old-token password" },
  });
  assert.equal(stale.response.status, 400);
  assert.equal(stale.payload.code, "password_reset_invalid");
  assert.equal((await call(env, "/api/auth/me", { auth: replacement })).response.status, 200);
  const newToken = await requestReset(env, messages, email);
  const reset = await call(env, "/api/auth/password-reset/confirm", {
    method: "POST", body: { token: newToken, newPassword: "a newly requested recovery password" },
  });
  assert.equal(reset.response.status, 204);
  assert.equal((await call(env, "/api/auth/me", { auth: replacement })).response.status, 401);
});

for (const winner of ["change", "reset"]) {
  test(`a losing password change preserves recovery links issued after the ${winner} winner`, { timeout: 60_000 }, async context => {
    const { DB, env, auth, messages, email } = await deletionFixture(context, `password-${winner}-race`);
    const oldToken = await requestReset(env, messages, email);
    const paused = pauseNextBatch(DB);
    const losing = call({ ...env, DB: paused.DB }, "/api/auth/password", {
      method: "PUT", auth, body: { currentPassword: INITIAL_PASSWORD, newPassword: "the losing password must not win" },
    });
    let expectedTokens, newToken;
    try {
      await paused.reached;
      const result = winner === "change"
        ? await call(env, "/api/auth/password", {
          method: "PUT", auth, body: { currentPassword: INITIAL_PASSWORD, newPassword: RESET_PASSWORD },
        })
        : await call(env, "/api/auth/password-reset/confirm", {
          method: "POST", body: { token: oldToken, newPassword: RESET_PASSWORD },
        });
      assert.equal(result.response.status, winner === "change" ? 200 : 204, JSON.stringify(result.payload));
      newToken = await requestReset(env, messages, email);
      expectedTokens = (await DB.prepare("SELECT * FROM password_reset_tokens ORDER BY id").all()).results;
    } finally {
      paused.release();
    }
    const rejected = await losing;
    assert.equal(rejected.response.status, 409);
    assert.equal(rejected.payload.code, "auth_state_changed");
    assert.deepEqual((await DB.prepare("SELECT * FROM password_reset_tokens ORDER BY id").all()).results, expectedTokens);
    const recovered = await call(env, "/api/auth/password-reset/confirm", {
      method: "POST", body: { token: newToken, newPassword: "recovery after the losing rotation" },
    });
    assert.equal(recovered.response.status, 204, JSON.stringify(recovered.payload));
  });
}

test("a recovery-token invalidation failure rolls back the password and replacement session", { timeout: 60_000 }, async context => {
  const { DB, env, auth, messages, email } = await deletionFixture(context, "password-link-rollback");
  const oldToken = await requestReset(env, messages, email);
  const before = await deletionSnapshot(DB);
  const credentials = await DB.prepare("SELECT password_hash,password_salt FROM users").first();
  await DB.prepare(`CREATE TRIGGER synthetic_reset_token_abort BEFORE DELETE ON password_reset_tokens
    BEGIN SELECT RAISE(ABORT,'synthetic token invalidation rollback'); END`).run();
  const changed = await call(env, "/api/auth/password", {
    method: "PUT", auth, body: { currentPassword: INITIAL_PASSWORD, newPassword: RESET_PASSWORD },
  });
  assert.equal(changed.response.status, 500);
  assert.deepEqual(await deletionSnapshot(DB), before);
  assert.deepEqual(await DB.prepare("SELECT password_hash,password_salt FROM users").first(), credentials);
  assert.equal((await call(env, "/api/auth/me", { auth })).response.status, 200);
  await DB.prepare("DROP TRIGGER synthetic_reset_token_abort").run();
  const recovered = await call(env, "/api/auth/password-reset/confirm", {
    method: "POST", body: { token: oldToken, newPassword: RESET_PASSWORD },
  });
  assert.equal(recovered.response.status, 204);
});
