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
