import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import worker from "../worker/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDirectory = path.join(root, "migrations");
const ORIGIN = "https://app.example.test";
const PASSWORD = "correct horse battery staple";
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
        name: "professional-review-worker",
        type: "worker",
        compatibilityDate: "2026-08-01",
        manifest: {
          mainModule: "index.mjs",
          modulesRoot: process.cwd(),
          modules: { "index.mjs": { type: "esm", contents: "export default {}" } },
        },
        env: { DB: { type: "d1", name: "professional-review-db" } },
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

async function call(env, pathname, { method = "GET", body, auth, idempotencyKey } = {}) {
  const headers = new Headers({ "cf-connecting-ip": "203.0.113.60" });
  if (!["GET", "HEAD"].includes(method)) headers.set("origin", ORIGIN);
  if (body !== undefined) headers.set("content-type", "application/json");
  if (idempotencyKey) headers.set("idempotency-key", idempotencyKey);
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
  return {
    csrf: result.payload.csrfToken,
    cookie: `__Host-grihagrid_session=${session}; grihagrid_csrf=${result.payload.csrfToken}`,
  };
}

async function register(env, email, name) {
  const result = await call(env, "/api/auth/register", {
    method: "POST", body: { email, name, password: PASSWORD },
  });
  assert.equal(result.response.status, 201, JSON.stringify(result.payload));
  return { ...authFrom(result), user: result.payload.user };
}

const projectInput = {
  width: 30, length: 50, city: "Pune", facing: "East", floors: "G+1",
  bedrooms: 3, bathrooms: 3, parking: true, style: "Warm modern", quality: "Signature",
  roadWidthFt: 24, plotShape: "regular", accessibility: "none", futureUse: "none", budgetLakh: 50,
};

test("owners and verified reviewers complete a traced clarification and review journey", { timeout: 60_000 }, async (context) => {
  const DB = await database(context);
  const env = {
    APP_ENV: "test",
    APP_ORIGIN: ORIGIN,
    ASSETS: assets,
    DB,
    GRIHAGRID_CACHE: new MemoryKv(),
    PAID_CHECKOUT_ENABLED: "false",
    DECISION_COMPARE_FULFILLMENT_ENABLED: "false",
    ENABLED_PAYMENT_PLANS: "",
  };
  const owner = await register(env, "review-owner@example.test", "Review Owner");
  const reviewer = await register(env, "reviewer@example.test", "Pilot Architect");
  const unverified = await register(env, "unverified-reviewer@example.test", "Unverified Reviewer");

  const now = "2026-09-02 09:00:00";
  await DB.prepare("UPDATE users SET account_role='reviewer' WHERE id IN (?,?)")
    .bind(reviewer.user.id, unverified.user.id).run();
  await DB.prepare(
    `INSERT INTO professional_profiles
       (user_id,display_name,discipline,license_jurisdiction,license_reference,verification_status,verified_at,created_at,updated_at)
     VALUES (?,?,?,?,?,'verified',?,?,?)`,
  ).bind(reviewer.user.id, "Ar. Pilot Reviewer", "architect", "Council of Architecture, India", "PILOT-COA-001", now, now, now).run();
  await DB.prepare(
    `INSERT INTO professional_profiles
       (user_id,display_name,discipline,license_jurisdiction,license_reference,verification_status,verified_at,created_at,updated_at)
     VALUES (?,?,?,?,?,'pending',NULL,?,?)`,
  ).bind(unverified.user.id, "Pending Reviewer", "architect", "Council of Architecture, India", "PENDING-001", now, now).run();

  assert.equal((await call(env, "/api/professional-reviews", { auth: unverified })).response.status, 403);

  const projectResult = await call(env, "/api/projects", {
    method: "POST",
    auth: owner,
    idempotencyKey: "professional-review-project-0001",
    body: { name: "Private professional review project", input: projectInput },
  });
  assert.equal(projectResult.response.status, 201, JSON.stringify(projectResult.payload));
  const projectId = projectResult.payload.project.id;
  const report = await call(env, `/api/projects/${projectId}/report`, { method: "POST", auth: owner, body: {} });
  assert.ok([200, 201].includes(report.response.status), JSON.stringify(report.payload));

  const requested = await call(env, `/api/projects/${projectId}/professional-reviews`, {
    method: "POST",
    auth: owner,
    idempotencyKey: "professional-review-request-0001",
    body: { note: "Please challenge access, stair pressure, and the assumptions behind the planning range." },
  });
  assert.equal(requested.response.status, 201, JSON.stringify(requested.payload));
  assert.equal(requested.payload.review.status, "requested");
  assert.equal(JSON.stringify(requested.payload).includes("report_content_hash"), false);
  const reviewId = requested.payload.review.id;

  const replay = await call(env, `/api/projects/${projectId}/professional-reviews`, {
    method: "POST",
    auth: owner,
    idempotencyKey: "professional-review-request-0001",
    body: { note: "Please challenge access, stair pressure, and the assumptions behind the planning range." },
  });
  assert.equal(replay.response.status, 200);
  assert.equal(replay.payload.review.id, reviewId);
  assert.equal(replay.payload.replayed, true);
  const conflictingReplay = await call(env, `/api/projects/${projectId}/professional-reviews`, {
    method: "POST",
    auth: owner,
    idempotencyKey: "professional-review-request-0001",
    body: { note: "A conflicting request must never replay the earlier review." },
  });
  assert.equal(conflictingReplay.response.status, 409);
  assert.equal(conflictingReplay.payload.code, "idempotency_conflict");

  const queue = await call(env, "/api/professional-reviews", { auth: reviewer });
  assert.equal(queue.response.status, 200, JSON.stringify(queue.payload));
  assert.deepEqual(queue.payload.reviews.map((item) => item.id), [reviewId]);
  assert.equal(queue.payload.reviews[0].ownerNote, "", "unassigned queue entries must withhold owner free text");
  assert.equal(JSON.stringify(queue.payload).includes("review-owner@example.test"), false);

  const claimed = await call(env, `/api/professional-reviews/${reviewId}/claim`, {
    method: "POST", auth: reviewer, body: {},
  });
  assert.equal(claimed.response.status, 200, JSON.stringify(claimed.payload));
  assert.equal(claimed.payload.review.status, "assigned");
  assert.equal(claimed.payload.review.reviewer.licenseReference, "PILOT-COA-001");

  const detail = await call(env, `/api/professional-reviews/${reviewId}`, { auth: reviewer });
  assert.equal(detail.response.status, 200, JSON.stringify(detail.payload));
  assert.equal(detail.payload.report.projectId, projectId);
  assert.equal(detail.payload.project.name, "Private professional review project");
  assert.equal(JSON.stringify(detail.payload).includes("review-owner@example.test"), false);

  const competingQuestions = await Promise.all([
    "Please confirm whether the 24 ft road width is measured or an owner estimate.",
    "Please confirm the same road evidence in this competing request.",
  ].map((message) => call(env, `/api/professional-reviews/${reviewId}/messages`, {
    method: "POST", auth: reviewer, body: { message },
  })));
  assert.deepEqual(competingQuestions.map((item) => item.response.status).sort(), [201, 409]);
  const question = competingQuestions.find((item) => item.response.status === 201);
  assert.equal(question.response.status, 201, JSON.stringify(question.payload));
  assert.equal(question.payload.status, "needs_owner_input");
  const premature = await call(env, `/api/professional-reviews/${reviewId}`, {
    method: "PUT", auth: reviewer, body: { summary: "This summary is long enough but must wait for the open clarification." },
  });
  assert.equal(premature.response.status, 409);

  const response = await call(env, `/api/projects/${projectId}/professional-reviews/${reviewId}/messages`, {
    method: "POST",
    auth: owner,
    body: { message: "It is an owner estimate from the sale document; a measured survey is still required." },
  });
  assert.equal(response.response.status, 201, JSON.stringify(response.payload));
  assert.equal(response.payload.status, "assigned");

  const completed = await call(env, `/api/professional-reviews/${reviewId}`, {
    method: "PUT",
    auth: reviewer,
    body: { summary: "Concept review completed: verify the road and boundary by measured survey, test turning and setbacks locally, and have the stair and structure sized by the appointed project professionals before drawings are relied upon." },
  });
  assert.equal(completed.response.status, 200, JSON.stringify(completed.payload));
  assert.equal(completed.payload.review.status, "reviewed");
  assert.equal(completed.payload.review.completedAt !== null, true);

  const ownerDetail = await call(env, `/api/projects/${projectId}/professional-reviews/${reviewId}`, { auth: owner });
  assert.equal(ownerDetail.response.status, 200, JSON.stringify(ownerDetail.payload));
  assert.equal(ownerDetail.payload.review.status, "reviewed");
  assert.deepEqual(ownerDetail.payload.messages.map((item) => item.authorRole), ["reviewer", "owner"]);
  assert.equal(ownerDetail.payload.review.reviewerSummary.includes("measured survey"), true);

  const actions = (await DB.prepare(
    "SELECT action FROM professional_review_events WHERE review_id=? ORDER BY created_at,id",
  ).bind(reviewId).all()).results.map((row) => row.action);
  assert.deepEqual(actions.sort(), ["claimed", "message_added", "owner_response", "requested", "reviewed"].sort());
  await assert.rejects(
    DB.prepare("UPDATE professional_review_messages SET body='rewritten' WHERE review_id=?").bind(reviewId).run(),
    /immutable/iu,
  );

  const second = await call(env, `/api/projects/${projectId}/professional-reviews`, {
    method: "POST",
    auth: owner,
    idempotencyKey: "professional-review-request-0002",
    body: { note: "A second pilot review request for cancellation evidence." },
  });
  assert.equal(second.response.status, 201, JSON.stringify(second.payload));
  const cancelled = await call(env, `/api/projects/${projectId}/professional-reviews/${second.payload.review.id}`, {
    method: "DELETE", auth: owner, body: {},
  });
  assert.equal(cancelled.response.status, 204);
});
