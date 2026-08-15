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
  bedrooms: "3",
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

class MemoryD1 {
  constructor() {
    this.users = [];
    this.sessions = [];
    this.projects = [];
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
        created_at,
        updated_at,
      ] = this.values;
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
        created_at,
        updated_at,
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

async function postProject(env, auth, body, ip = "203.0.113.10") {
  const response = await worker.fetch(new Request(`${ORIGIN}/api/projects`, {
    method: "POST",
    headers: {
      origin: ORIGIN,
      "content-type": "application/json",
      cookie: auth.cookie,
      "x-csrf-token": auth.csrf,
      "cf-connecting-ip": ip,
    },
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
