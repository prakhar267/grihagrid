import assert from "node:assert/strict";
import test from "node:test";
import worker, { __test } from "../worker/index.js";

const ORIGIN = "https://app.example.test";
const USER_ID = "feedback-security-owner";
const PROJECT_ID = "feedback-security-project";
const SESSION_TOKEN = "feedback-security-session-token";
const CSRF_TOKEN = "feedback-security-csrf-token";
const FEEDBACK_PATH = `/api/projects/${PROJECT_ID}/revisions/1/reports/2/feedback`;
const assets = { fetch: async () => new Response("missing", { status: 404 }) };

class MemoryKv {
  constructor() {
    this.values = new Map();
    this.keys = [];
  }

  async get(key) {
    return this.values.get(String(key)) ?? null;
  }

  async put(key, value) {
    this.keys.push(String(key));
    this.values.set(String(key), String(value));
  }
}

class ThrowingKv {
  async get() {
    throw new Error("synthetic report-feedback KV failure");
  }

  async put() {
    throw new Error("synthetic report-feedback KV failure");
  }
}

class FeedbackMemoryD1 {
  constructor({ sessionHash, csrfHash, constraintRace = null }) {
    this.sessionHash = sessionHash;
    this.csrfHash = csrfHash;
    this.constraintRace = constraintRace;
    this.racedProjectStatus = "report_ready";
    this.feedback = null;
    this.feedbackWrites = 0;
  }

  prepare(sql) {
    return new FeedbackMemoryStatement(this, sql.replace(/\s+/gu, " ").trim());
  }
}

class FeedbackMemoryStatement {
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
    if (this.sql.includes("FROM sessions s JOIN users u")) {
      if (this.values[0] !== this.db.sessionHash) return null;
      return {
        session_id: "feedback-security-session",
        user_id: USER_ID,
        csrf_hash: this.db.csrfHash,
        expires_at: "2099-01-01 00:00:00",
        email: "feedback-security@example.test",
        name: "Feedback security owner",
        user_created_at: "2026-08-15 00:00:00",
      };
    }
    if (this.sql.includes("FROM projects p WHERE p.id=? AND p.user_id=?")) {
      const [projectId, userId] = this.values;
      return projectId === PROJECT_ID && userId === USER_ID
        ? { id: PROJECT_ID, user_id: USER_ID, status: "report_ready", input_revision: 1, report_available: 1 }
        : null;
    }
    if (this.sql.includes("FROM project_revision_reports") && this.sql.includes("report_schema_version=?")) {
      const [projectId, revision, schemaVersion] = this.values;
      return projectId === PROJECT_ID && revision === 1 && schemaVersion === 2
        ? { project_id: PROJECT_ID, project_revision: 1, report_schema_version: 2 }
        : null;
    }
    if (this.sql === "SELECT status FROM projects WHERE id=? AND user_id=?") {
      return this.db.racedProjectStatus == null ? null : { status: this.db.racedProjectStatus };
    }
    if (this.sql.startsWith("INSERT INTO report_feedback") && this.sql.includes("RETURNING")) {
      if (this.db.constraintRace) {
        this.db.racedProjectStatus = this.db.constraintRace === "archive" ? "archived" : null;
        throw new Error("D1_ERROR: invalid report feedback: SQLITE_CONSTRAINT_TRIGGER");
      }
      const [projectId, revision, schemaVersion, userId, outcome, sectionsJson, createdAt, updatedAt] = this.values;
      const unchanged = this.db.feedback?.outcome === outcome && this.db.feedback?.sections_json === sectionsJson;
      this.db.feedback = {
        project_id: projectId,
        project_revision: revision,
        report_schema_version: schemaVersion,
        user_id: userId,
        outcome,
        sections_json: sectionsJson,
        created_at: this.db.feedback?.created_at || createdAt,
        updated_at: unchanged ? this.db.feedback.updated_at : updatedAt,
      };
      this.db.feedbackWrites += 1;
      return { ...this.db.feedback };
    }
    throw new Error(`Unhandled FeedbackMemoryD1 first(): ${this.sql}`);
  }
}

async function fixture(options = {}) {
  return new FeedbackMemoryD1({
    sessionHash: await __test.digestBase64(SESSION_TOKEN),
    csrfHash: await __test.digestBase64(CSRF_TOKEN),
    ...options,
  });
}

async function putFeedback(env, body = { outcome: "helpful", sections: ["overall"] }) {
  const response = await worker.fetch(new Request(`${ORIGIN}${FEEDBACK_PATH}`, {
    method: "PUT",
    headers: {
      origin: ORIGIN,
      "content-type": "application/json",
      cookie: `__Host-grihagrid_session=${SESSION_TOKEN}; grihagrid_csrf=${CSRF_TOKEN}`,
      "x-csrf-token": CSRF_TOKEN,
    },
    body: JSON.stringify(body),
  }), env);
  return { response, payload: await response.json() };
}

test("report feedback fails closed without KV and never reaches its D1 write", async () => {
  const db = await fixture();
  const result = await putFeedback({ ASSETS: assets, DB: db });

  assert.equal(result.response.status, 503, JSON.stringify(result.payload));
  assert.deepEqual(result.payload, {
    error: "abuse controls are temporarily unavailable",
    code: "abuse_control_unavailable",
  });
  assert.equal(db.feedbackWrites, 0);
  assert.equal(db.feedback, null);
});

test("report feedback maps KV failure to a bounded fail-closed response without mutation", async () => {
  const db = await fixture();
  const result = await putFeedback({ ASSETS: assets, DB: db, GRIHAGRID_CACHE: new ThrowingKv() });

  assert.equal(result.response.status, 503, JSON.stringify(result.payload));
  assert.deepEqual(result.payload, {
    error: "abuse controls are temporarily unavailable",
    code: "abuse_control_unavailable",
  });
  assert.equal(db.feedbackWrites, 0);
  assert.equal(db.feedback, null);
});

test("report feedback enforces the 60-per-account hourly limit before D1 mutation", async () => {
  const db = await fixture();
  const kv = new MemoryKv();
  const env = { ASSETS: assets, DB: db, GRIHAGRID_CACHE: kv };

  for (let attempt = 1; attempt <= 60; attempt += 1) {
    const result = await putFeedback(env);
    assert.equal(result.response.status, 200, `attempt ${attempt}: ${JSON.stringify(result.payload)}`);
  }
  const limited = await putFeedback(env, { outcome: "needs_review", sections: ["assumptions"] });

  assert.equal(limited.response.status, 429, JSON.stringify(limited.payload));
  assert.deepEqual(limited.payload, {
    error: "too many attempts; please try again later",
    code: "rate_limited",
  });
  assert.equal(db.feedbackWrites, 60, "the rejected 61st request must not reach the feedback upsert");
  assert.equal(db.feedback.outcome, "helpful");
  assert.equal(db.feedback.sections_json, JSON.stringify(["overall"]));
  assert.ok(kv.keys.length >= 61);
  assert.ok(kv.keys.every((key) => key.includes("report-feedback-user:")));
  assert.equal(JSON.stringify({ keys: kv.keys, response: limited.payload }).includes(USER_ID), false);
  assert.equal(JSON.stringify(limited.payload).includes(PROJECT_ID), false);
});

test("report feedback distinguishes archive and delete races without false acknowledgement", async (t) => {
  await t.test("archive during upsert", async () => {
    const db = await fixture({ constraintRace: "archive" });
    const result = await putFeedback({ ASSETS: assets, DB: db, GRIHAGRID_CACHE: new MemoryKv() });

    assert.equal(result.response.status, 409, JSON.stringify(result.payload));
    assert.deepEqual(result.payload, {
      error: "restore the project before changing its report feedback",
      code: "project_archived",
    });
    assert.equal(db.feedbackWrites, 0);
  });

  await t.test("delete during upsert", async () => {
    const db = await fixture({ constraintRace: "delete" });
    const result = await putFeedback({ ASSETS: assets, DB: db, GRIHAGRID_CACHE: new MemoryKv() });

    assert.equal(result.response.status, 409, JSON.stringify(result.payload));
    assert.deepEqual(result.payload, {
      error: "the report changed while feedback was saving",
      code: "report_feedback_conflict",
    });
    assert.notEqual(result.payload.code, "project_archived");
    assert.equal(db.feedbackWrites, 0);
  });
});
