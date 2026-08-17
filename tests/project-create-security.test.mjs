import assert from "node:assert/strict";
import test from "node:test";
import worker, { __test } from "../worker/index.js";

const ORIGIN = "https://app.example.test";
const PROJECT_CREATION_HOURLY_LIMIT = 20;
const assets = { fetch: async () => new Response("missing", { status: 404 }) };

const validInput = Object.freeze({
  width: 30,
  length: 50,
  city: "Pune",
  facing: "East",
  floors: "G+1",
  bedrooms: 3,
  bathrooms: 3,
  parking: "1 car",
  style: "Warm modern",
  quality: "Signature",
  roadWidthFt: 24,
  plotShape: "regular",
  accessibility: "none",
  futureUse: "none",
  budgetLakh: 55,
});

class MemoryKv {
  constructor() {
    this.values = new Map();
    this.keys = [];
  }

  async get(key) {
    return this.values.get(key) ?? null;
  }

  async put(key, value) {
    this.keys.push(String(key));
    this.values.set(String(key), String(value));
  }
}

class ThrowingKv {
  async get() {
    throw new Error("synthetic KV read failure");
  }

  async put() {
    throw new Error("synthetic KV write failure");
  }
}

class MalformedKv {
  async get() {
    return "NaN";
  }

  async put() {
    throw new Error("malformed abuse-control state must never be overwritten");
  }
}

class OneShotBarrier {
  constructor(participants) {
    this.remaining = participants;
    this.released = false;
    this.promise = new Promise((resolve) => { this.release = resolve; });
  }

  async wait() {
    if (this.released) return;
    this.remaining -= 1;
    if (this.remaining === 0) {
      this.released = true;
      this.release();
    }
    await this.promise;
  }
}

class MemoryD1 {
  constructor() {
    this.users = [];
    this.sessions = [];
    this.projects = [];
    this.aggregates = [];
    this.failAggregates = false;
    this.projectReplayBarrier = null;
    this.projectLimitErrors = 0;
  }

  prepare(sql) {
    return new MemoryStatement(this, sql.replace(/\s+/gu, " ").trim());
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
    if (this.sql.includes("FROM sessions s JOIN users u")) {
      const session = this.db.sessions.find((candidate) => candidate.token_hash === this.values[0]);
      const user = session && this.db.users.find((candidate) => candidate.id === session.user_id);
      return session && user && !user.deleted_at ? {
        session_id: session.id,
        user_id: user.id,
        csrf_hash: session.csrf_hash,
        expires_at: session.expires_at,
        email: user.email,
        name: user.name,
        user_created_at: user.created_at,
      } : null;
    }
    if (this.sql.includes("COUNT(*)") && this.sql.includes("FROM projects") && this.sql.includes("user_id=?")) {
      const userId = this.values.find((value) => this.db.users.some((user) => user.id === value));
      return { count: this.db.projects.filter((project) => project.user_id === userId).length };
    }
    if (this.sql.includes("p.creation_key_hash=?")) {
      await this.db.projectReplayBarrier?.wait();
      const [userId, creationKeyHash] = this.values;
      const project = this.db.projects.find((candidate) => (
        candidate.user_id === userId && candidate.creation_key_hash === creationKeyHash
      ));
      return project ? { ...project, report_available: 0 } : null;
    }
    throw new Error(`Unhandled MemoryD1 first(): ${this.sql}`);
  }

  async run() {
    if (this.sql.startsWith("INSERT INTO projects")) {
      const [
        id,
        user_id,
        name,
        status,
        input_json,
        estimate_json,
        input_hash,
        input_schema_version,
        estimate_rule_version,
        brief_check_version,
        brief_check_json,
        creation_key_hash,
        creation_request_hash,
        created_at,
        updated_at,
      ] = this.values;
      if (this.db.projects.filter((project) => project.user_id === user_id).length >= 50) {
        this.db.projectLimitErrors += 1;
        throw new Error("project account limit reached");
      }
      if (creation_key_hash && this.db.projects.some((project) => (
        project.user_id === user_id && project.creation_key_hash === creation_key_hash
      ))) throw new Error("UNIQUE constraint failed: projects.user_id, projects.creation_key_hash");
      this.db.projects.push({
        id,
        user_id,
        name,
        status,
        input_json,
        estimate_json,
        input_hash,
        input_schema_version,
        estimate_rule_version,
        brief_check_version,
        brief_check_json,
        creation_key_hash,
        creation_request_hash,
        created_at,
        updated_at,
      });
      return { success: true, meta: { changes: 1 } };
    }
    if (this.sql.startsWith("INSERT INTO product_event_aggregates")) {
      if (this.db.failAggregates) throw new Error("synthetic aggregate failure");
      const existing = this.db.aggregates.find((row) => row.event_name === "public_estimator_brief_started");
      if (existing) existing.event_count += 1;
      else this.db.aggregates.push({
        event_name: "public_estimator_brief_started",
        surface: "public_estimator",
        outcome: "success",
        event_count: 1,
      });
      return { success: true, meta: { changes: 1 } };
    }
    throw new Error(`Unhandled MemoryD1 run(): ${this.sql}`);
  }
}

async function seedAuth(db, suffix = "000000000001") {
  const tail = String(suffix).replace(/[^0-9]/gu, "").padStart(12, "0").slice(-12);
  const userId = `00000000-0000-4000-8000-${tail}`;
  const sessionToken = `session-token-${tail}`;
  const csrfToken = `csrf-token-${tail}`;
  db.users.push({
    id: userId,
    email: `owner-${tail}@example.test`,
    name: "Project owner",
    created_at: "2026-08-15 00:00:00",
    deleted_at: null,
  });
  db.sessions.push({
    id: `10000000-0000-4000-8000-${tail}`,
    user_id: userId,
    token_hash: await __test.digestBase64(sessionToken),
    csrf_hash: await __test.digestBase64(csrfToken),
    expires_at: "2099-01-01 00:00:00",
  });
  return {
    userId,
    cookie: `__Host-grihagrid_session=${sessionToken}; grihagrid_csrf=${csrfToken}`,
    csrf: csrfToken,
  };
}

async function postProject(env, auth, body, ip = "203.0.113.10", entryPoint = null, idempotencyKey = null) {
  const headers = {
    origin: ORIGIN,
    "content-type": "application/json",
    cookie: auth.cookie,
    "x-csrf-token": auth.csrf,
    "cf-connecting-ip": ip,
  };
  if (entryPoint) headers["x-grihagrid-entry-point"] = entryPoint;
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
  const response = await worker.fetch(new Request(`${ORIGIN}/api/projects`, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  }), env);
  return { response, payload: await response.json() };
}

function projectBody(input = validInput, extra = {}) {
  return { name: "Security regression project", input: { ...input }, ...extra };
}

test("POST /api/projects rejects unsupported root and nested fields without persisting them", async (t) => {
  const cases = [
    ["null request", null, "invalid_json"],
    ["array request", [], "invalid_json"],
    ["nested soilReport claim", projectBody({ ...validInput, soilReport: true })],
    ["nested metadata object", projectBody({ ...validInput, metadata: { source: "client" } })],
    ["unsupported request wrapper field", projectBody(validInput, { internalMode: "trusted" })],
    ["legacy root soilReport claim", { name: "Legacy request", ...validInput, soilReport: true }],
  ];

  for (let index = 0; index < cases.length; index += 1) {
    const [label, body, expectedCode = "invalid_project_input"] = cases[index];
    await t.test(label, async () => {
      const db = new MemoryD1();
      const auth = await seedAuth(db, index + 1);
      const result = await postProject({ ASSETS: assets, DB: db, GRIHAGRID_CACHE: new MemoryKv() }, auth, body);
      assert.equal(result.response.status, 400, JSON.stringify(result.payload));
      assert.equal(result.payload.code, expectedCode);
      assert.equal(db.projects.length, 0, "an invalid shape must never create a project");
    });
  }
});

test("POST /api/projects rejects categorical and numeric typos instead of silently defaulting", async (t) => {
  const cases = [
    ["floors", "G+9"],
    ["quality", "signature"],
    ["city", "Puna"],
    ["facing", "N"],
    ["bedrooms", "three"],
    ["plotShape", "rectangle"],
    ["accessibility", "maybe"],
    ["futureUse", "unsure"],
  ];

  for (let index = 0; index < cases.length; index += 1) {
    const [field, value] = cases[index];
    await t.test(`${field}=${value}`, async () => {
      const db = new MemoryD1();
      const auth = await seedAuth(db, 100 + index);
      const result = await postProject(
        { ASSETS: assets, DB: db, GRIHAGRID_CACHE: new MemoryKv() },
        auth,
        projectBody({ ...validInput, [field]: value }),
      );
      assert.equal(result.response.status, 400, JSON.stringify(result.payload));
      assert.equal(result.payload.code, "invalid_project_input");
      assert.equal(db.projects.length, 0, "a typo must not be replaced with a different planning assumption");
    });
  }
});

test("POST /api/projects rejects scalar type confusion instead of coercing request values", async (t) => {
  const cases = [
    ["name array", projectBody(validInput, { name: ["Security regression project"] }), "invalid_project_name"],
    ["width array", projectBody({ ...validInput, width: [30] }), "invalid_project_input"],
    ["width text", projectBody({ ...validInput, width: "30" }), "invalid_project_input"],
    ["width boolean", projectBody({ ...validInput, width: true }), "invalid_project_input"],
    ["city array", projectBody({ ...validInput, city: ["Pune"] }), "invalid_project_input"],
    ["city boolean", projectBody({ ...validInput, city: true }), "invalid_project_input"],
    ["bedrooms array", projectBody({ ...validInput, bedrooms: [3] }), "invalid_project_input"],
    ["bedrooms text", projectBody({ ...validInput, bedrooms: "3" }), "invalid_project_input"],
    ["bedrooms boolean", projectBody({ ...validInput, bedrooms: true }), "invalid_project_input"],
    ["bathrooms text", projectBody({ ...validInput, bathrooms: "3" }), "invalid_project_input"],
    ["road width array", projectBody({ ...validInput, roadWidthFt: [24] }), "invalid_project_input"],
    ["budget text", projectBody({ ...validInput, budgetLakh: "55" }), "invalid_project_input"],
    ["parking array", projectBody({ ...validInput, parking: ["1 car"] }), "invalid_project_input"],
    ["style array", projectBody({ ...validInput, style: ["Warm modern"] }), "invalid_project_input"],
  ];

  for (let index = 0; index < cases.length; index += 1) {
    const [label, body, expectedCode] = cases[index];
    await t.test(label, async () => {
      const db = new MemoryD1();
      const auth = await seedAuth(db, 150 + index);
      const result = await postProject(
        { ASSETS: assets, DB: db, GRIHAGRID_CACHE: new MemoryKv() },
        auth,
        body,
      );
      assert.equal(result.response.status, 400, JSON.stringify(result.payload));
      assert.equal(result.payload.code, expectedCode);
      assert.equal(db.projects.length, 0, "coercible JSON shapes must never create a project");
    });
  }
});

test("POST /api/projects rejects oversized root, nested, and byte shapes before persistence", async (t) => {
  const tooManyRootFields = Object.fromEntries(
    Array.from({ length: 101 }, (_, index) => [`unsupportedRoot${index}`, index]),
  );
  const tooManyNestedFields = Object.fromEntries(
    Array.from({ length: 101 }, (_, index) => [`unsupportedNested${index}`, index]),
  );
  const deeplyNested = { value: true };
  let cursor = deeplyNested;
  for (let depth = 0; depth < 10; depth += 1) {
    cursor.next = {};
    cursor = cursor.next;
  }

  const cases = [
    ["root field count", projectBody(validInput, tooManyRootFields), 400, "invalid_project_input"],
    ["nested field count", projectBody({ ...validInput, extra: tooManyNestedFields }), 400, "invalid_project_input"],
    ["nested depth", projectBody({ ...validInput, extra: deeplyNested }), 400, "invalid_project_input"],
    ["JSON byte limit", JSON.stringify(projectBody({ ...validInput, style: "x".repeat(70_000) })), 413, "payload_too_large"],
  ];

  for (let index = 0; index < cases.length; index += 1) {
    const [label, body, expectedStatus, expectedCode] = cases[index];
    await t.test(label, async () => {
      const db = new MemoryD1();
      const auth = await seedAuth(db, 200 + index);
      const result = await postProject({ ASSETS: assets, DB: db, GRIHAGRID_CACHE: new MemoryKv() }, auth, body);
      assert.equal(result.response.status, expectedStatus, JSON.stringify(result.payload));
      assert.equal(result.payload.code, expectedCode);
      assert.equal(db.projects.length, 0);
    });
  }
});

test("project names normalize Unicode and reject control or bidi characters", async () => {
  const db = new MemoryD1();
  const auth = await seedAuth(db, 250);
  const env = { ASSETS: assets, DB: db, GRIHAGRID_CACHE: new MemoryKv() };
  const normalized = await postProject(env, auth, projectBody(validInput, { name: "  ＱＡ　Home  " }));
  assert.equal(normalized.response.status, 201, JSON.stringify(normalized.payload));
  assert.equal(normalized.payload.project.name, "QA Home");

  for (const name of ["Unsafe\u0000name", "Unsafe\u202ename"]) {
    const rejected = await postProject(env, auth, projectBody(validInput, { name }));
    assert.equal(rejected.response.status, 400, JSON.stringify(rejected.payload));
    assert.equal(rejected.payload.code, "invalid_project_name");
  }
  assert.equal(db.projects.length, 1);
});

test("legacy soilReport input can never suppress foundation and geotechnical verification", () => {
  const legacyInput = { ...validInput, soilReport: true };
  const estimate = __test.computeEstimate(legacyInput);
  const report = __test.buildReport({
    id: "legacy-soil-claim-project",
    name: "Legacy soil claim",
    input_json: JSON.stringify(legacyInput),
    estimate_json: JSON.stringify(estimate),
  }, "input-hash", "report-id", "2026-08-15 00:00:00");

  assert.ok(
    report.risks.some((risk) => /foundation assumptions.*geotechnical investigation/iu.test(risk)),
    `mandatory geotechnical warning missing from risks: ${JSON.stringify(report.risks)}`,
  );
});

test("project creation fails closed without KV abuse control", async () => {
  const db = new MemoryD1();
  const auth = await seedAuth(db, 300);
  const result = await postProject({ ASSETS: assets, DB: db }, auth, projectBody());

  assert.equal(result.response.status, 503, JSON.stringify(result.payload));
  assert.deepEqual(result.payload, {
    error: "abuse controls are temporarily unavailable",
    code: "abuse_control_unavailable",
  });
  assert.equal(db.projects.length, 0);
});

test("project creation maps KV failures to a fail-closed operational response", async () => {
  const db = new MemoryD1();
  const auth = await seedAuth(db, 301);
  const logs = [];
  const originalLog = console.log;
  console.log = (line) => { logs.push(String(line)); };
  let result;
  try {
    result = await postProject({ ASSETS: assets, DB: db, GRIHAGRID_CACHE: new ThrowingKv(), APP_ENV: "test" }, auth, projectBody());
  } finally {
    console.log = originalLog;
  }

  assert.equal(result.response.status, 503, JSON.stringify(result.payload));
  assert.equal(result.response.headers.has("x-grihagrid-internal-outcome"), false, "internal outcome header must be stripped");
  assert.deepEqual(result.payload, {
    error: "abuse controls are temporarily unavailable",
    code: "abuse_control_unavailable",
  });
  assert.ok(logs.some((line) => line.includes('"outcome":"control_closed"')), "operations log must classify the fail-closed control");
  assert.equal(db.projects.length, 0);
});

test("project creation rejects malformed account abuse-control state", async () => {
  const db = new MemoryD1();
  const auth = await seedAuth(db, 302);
  const result = await postProject({ ASSETS: assets, DB: db, GRIHAGRID_CACHE: new MalformedKv() }, auth, projectBody());
  assert.equal(result.response.status, 503, JSON.stringify(result.payload));
  assert.deepEqual(result.payload, {
    error: "abuse controls are temporarily unavailable",
    code: "abuse_control_unavailable",
  });
  assert.equal(db.projects.length, 0);
});

test("public estimator attribution is server-tied to successful project creation", async () => {
  const db = new MemoryD1();
  const auth = await seedAuth(db, 350);
  const env = { ASSETS: assets, DB: db, GRIHAGRID_CACHE: new MemoryKv(), APP_ORIGIN: ORIGIN };

  const rejected = await postProject(
    env,
    auth,
    projectBody({ ...validInput, width: 2 }),
    "203.0.113.10",
    "public_estimator",
  );
  assert.equal(rejected.response.status, 400);
  assert.equal(db.projects.length, 0);
  assert.equal(db.aggregates.length, 0);

  const attributed = await postProject(env, auth, projectBody(), "203.0.113.10", "public_estimator");
  assert.equal(attributed.response.status, 201, JSON.stringify(attributed.payload));
  assert.equal(db.projects.length, 1);
  assert.deepEqual(db.aggregates, [{
    event_name: "public_estimator_brief_started",
    surface: "public_estimator",
    outcome: "success",
    event_count: 1,
  }]);

  const directEvent = await worker.fetch(new Request(`${ORIGIN}/api/events`, {
    method: "POST",
    headers: {
      origin: ORIGIN,
      "content-type": "application/json",
      cookie: auth.cookie,
      "x-csrf-token": auth.csrf,
      "cf-connecting-ip": "203.0.113.10",
    },
    body: JSON.stringify({
      event: "public_estimator_brief_started",
      properties: { surface: "public_estimator", outcome: "success" },
    }),
  }), env);
  assert.equal(directEvent.status, 400);
  assert.equal((await directEvent.json()).code, "invalid_event");
  assert.equal(db.aggregates[0].event_count, 1);

  const directStart = await postProject(env, auth, projectBody(validInput, { name: "Direct start" }));
  assert.equal(directStart.response.status, 201, JSON.stringify(directStart.payload));
  assert.equal(db.projects.length, 2);
  assert.equal(db.aggregates[0].event_count, 1);

  db.failAggregates = true;
  const ancillaryFailure = await postProject(
    env,
    auth,
    projectBody(validInput, { name: "Attribution unavailable" }),
    "203.0.113.10",
    "public_estimator",
  );
  assert.equal(ancillaryFailure.response.status, 201, JSON.stringify(ancillaryFailure.payload));
  assert.equal(db.projects.length, 3, "measurement failure must not roll back a valid project");
  assert.equal(db.aggregates[0].event_count, 1);
});

test("project creation safely replays an ambiguous successful response", async () => {
  const db = new MemoryD1();
  const auth = await seedAuth(db, 360);
  const env = { ASSETS: assets, DB: db, GRIHAGRID_CACHE: new MemoryKv(), APP_ORIGIN: ORIGIN };
  const key = "public-estimator-draft-0001";

  const invalidKey = await postProject(env, auth, projectBody(), "203.0.113.10", null, "bad key!");
  assert.equal(invalidKey.response.status, 400);
  assert.equal(invalidKey.payload.code, "invalid_idempotency_key");
  assert.equal(db.projects.length, 0);

  const created = await postProject(env, auth, projectBody(), "203.0.113.10", "public_estimator", key);
  assert.equal(created.response.status, 201, JSON.stringify(created.payload));
  assert.equal(db.projects.length, 1);
  assert.equal(db.aggregates[0].event_count, 1);

  const replayed = await postProject(env, auth, projectBody(), "203.0.113.10", "public_estimator", key);
  assert.equal(replayed.response.status, 200, JSON.stringify(replayed.payload));
  assert.equal(replayed.payload.project.id, created.payload.project.id);
  assert.deepEqual(replayed.payload.project.input, created.payload.project.input);
  assert.deepEqual(replayed.payload.project.estimate, created.payload.project.estimate);
  assert.equal(db.projects.length, 1, "a lost 201 retry must not create a second project");
  assert.equal(db.aggregates[0].event_count, 1, "a replay must not increment attribution twice");

  const conflict = await postProject(
    env,
    auth,
    projectBody(validInput, { name: "Different project" }),
    "203.0.113.10",
    "public_estimator",
    key,
  );
  assert.equal(conflict.response.status, 409);
  assert.equal(conflict.payload.code, "idempotency_conflict");
  assert.equal(db.projects.length, 1);
  assert.equal(db.aggregates[0].event_count, 1);
});

test("concurrent project creation reconciles the canonical idempotency row", async (t) => {
  async function fixture(existingProjectCount = 0) {
    const db = new MemoryD1();
    const auth = await seedAuth(db, 370);
    db.projects.push(...Array.from({ length: existingProjectCount }, (_, index) => ({
      id: `preexisting-project-${index + 1}`,
      user_id: auth.userId,
      creation_key_hash: null,
    })));
    db.projectReplayBarrier = new OneShotBarrier(2);
    return {
      auth,
      db,
      env: { ASSETS: assets, DB: db, GRIHAGRID_CACHE: new MemoryKv(), APP_ORIGIN: ORIGIN },
    };
  }

  await t.test("same key and body replay the winner after a unique-index race", async () => {
    const { auth, db, env } = await fixture();
    const key = "concurrent-project-create-0001";
    const results = await Promise.all([
      postProject(env, auth, projectBody(), "203.0.113.10", "public_estimator", key),
      postProject(env, auth, projectBody(), "203.0.113.10", "public_estimator", key),
    ]);

    assert.deepEqual(results.map(({ response }) => response.status).sort(), [200, 201]);
    assert.equal(results[0].payload.project.id, results[1].payload.project.id);
    assert.equal(db.projects.length, 1, "the concurrent retry must not create a duplicate project");
    assert.equal(db.projectLimitErrors, 0, "the under-cap test must exercise the unique-index path");
    assert.deepEqual(db.aggregates, [{
      event_name: "public_estimator_brief_started",
      surface: "public_estimator",
      outcome: "success",
      event_count: 1,
    }], "only the winning insert may increment attribution");
  });

  await t.test("same key with a different body conflicts after a unique-index race", async () => {
    const { auth, db, env } = await fixture();
    const key = "concurrent-project-create-0002";
    const results = await Promise.all([
      postProject(env, auth, projectBody(), "203.0.113.10", null, key),
      postProject(env, auth, projectBody(validInput, { name: "Different project" }), "203.0.113.10", null, key),
    ]);
    const created = results.find(({ response }) => response.status === 201);
    const conflict = results.find(({ response }) => response.status === 409);

    assert.ok(created, "exactly one concurrent request must create the canonical project");
    assert.equal(conflict?.payload.code, "idempotency_conflict");
    assert.equal(db.projects.length, 1, "conflicting key reuse must not create a duplicate project");
    assert.equal(db.projectLimitErrors, 0, "the under-cap conflict must exercise the unique-index path");
  });

  await t.test("same key and body replay the winner at the 49-to-50 account boundary", async () => {
    const { auth, db, env } = await fixture(49);
    const key = "concurrent-project-create-0003";
    const results = await Promise.all([
      postProject(env, auth, projectBody(), "203.0.113.10", "public_estimator", key),
      postProject(env, auth, projectBody(), "203.0.113.10", "public_estimator", key),
    ]);

    assert.deepEqual(results.map(({ response }) => response.status).sort(), [200, 201]);
    assert.equal(results[0].payload.project.id, results[1].payload.project.id);
    assert.equal(db.projects.length, 50, "the concurrent retry must not create project 51");
    assert.equal(db.projectLimitErrors, 1, "the test must exercise the database account-limit race");
    assert.deepEqual(db.aggregates, [{
      event_name: "public_estimator_brief_started",
      surface: "public_estimator",
      outcome: "success",
      event_count: 1,
    }], "only the winning boundary insert may increment attribution");
  });

  await t.test("same key with a different body conflicts at the 49-to-50 account boundary", async () => {
    const { auth, db, env } = await fixture(49);
    const key = "concurrent-project-create-0004";
    const results = await Promise.all([
      postProject(env, auth, projectBody(), "203.0.113.10", null, key),
      postProject(env, auth, projectBody(validInput, { name: "Different project" }), "203.0.113.10", null, key),
    ]);
    const created = results.find(({ response }) => response.status === 201);
    const conflict = results.find(({ response }) => response.status === 409);

    assert.ok(created, "exactly one boundary request must create the canonical project");
    assert.equal(conflict?.payload.code, "idempotency_conflict");
    assert.equal(db.projects.length, 50, "conflicting key reuse must not create project 51");
    assert.equal(db.projectLimitErrors, 1, "the conflict must reconcile after the account-limit trigger");
  });
});

test("project creation enforces an isolated 20-per-user hourly limit without exposing identifiers", async () => {
  const db = new MemoryD1();
  const kv = new MemoryKv();
  const owner = await seedAuth(db, 400);
  const otherOwner = await seedAuth(db, 401);
  const ownerScopeDigest = await __test.digestBase64(`project-create:${owner.userId}`);
  const otherOwnerScopeDigest = await __test.digestBase64(`project-create:${otherOwner.userId}`);
  const env = { ASSETS: assets, DB: db, GRIHAGRID_CACHE: kv };
  const createdIds = [];

  for (let index = 0; index < PROJECT_CREATION_HOURLY_LIMIT; index += 1) {
    const result = await postProject(env, owner, projectBody(validInput, { name: `Project ${index + 1}` }));
    assert.equal(result.response.status, 201, `create ${index + 1}: ${JSON.stringify(result.payload)}`);
    createdIds.push(result.payload.project.id);
  }

  const limited = await postProject(env, owner, projectBody(validInput, { name: "Over the limit" }));
  assert.equal(limited.response.status, 429, JSON.stringify(limited.payload));
  assert.deepEqual(limited.payload, {
    error: "too many attempts; please try again later",
    code: "rate_limited",
  });
  const limitedJson = JSON.stringify(limited.payload);
  assert.equal(limitedJson.includes(owner.userId), false);
  for (const projectId of createdIds) assert.equal(limitedJson.includes(projectId), false);
  const rotatedIp = await postProject(
    env,
    owner,
    projectBody(validInput, { name: "IP rotation must not reset the account bucket" }),
    "198.51.100.77",
  );
  assert.equal(rotatedIp.response.status, 429, `IP rotation bypassed the account limit: ${JSON.stringify(rotatedIp.payload)}`);
  assert.ok(kv.keys.length > 0, "project creation must write an abuse-control bucket");
  assert.ok(
    kv.keys.every((key) => key.includes(`project-create-user:${ownerScopeDigest}:`)),
    "the per-user KV scope must use the expected account digest",
  );
  for (const key of kv.keys) {
    assert.equal(key.includes(owner.userId), false, "rate-limit storage must not contain a raw account identifier");
    assert.equal(key.includes(otherOwner.userId), false, "rate-limit storage must not contain a raw account identifier");
    for (const projectId of createdIds) {
      assert.equal(key.includes(projectId), false, "rate-limit storage must not contain a raw project identifier");
    }
  }

  const isolated = await postProject(env, otherOwner, projectBody(validInput, { name: "Other owner's project" }));
  assert.equal(isolated.response.status, 201, `another user at the same IP was incorrectly limited: ${JSON.stringify(isolated.payload)}`);
  assert.ok(
    kv.keys.some((key) => key.includes(`project-create-user:${otherOwnerScopeDigest}:`)),
    "the second account must receive an independent digested KV scope",
  );
  assert.equal(db.projects.filter((project) => project.user_id === owner.userId).length, PROJECT_CREATION_HOURLY_LIMIT);
  assert.equal(db.projects.filter((project) => project.user_id === otherOwner.userId).length, 1);
});
