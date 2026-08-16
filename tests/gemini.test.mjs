import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Miniflare } from "miniflare";
import worker, { __test } from "../worker/index.js";

const ORIGIN = "https://app.example.test";
const API_KEY = "server-only-gemini-key";
const REPORT_SHARE_ABUSE_HMAC_KEY = "ab".repeat(32);
const assets = { fetch: async () => new Response("missing", { status: 404 }) };

function request(path, init = {}) {
  return new Request(`${ORIGIN}${path}`, init);
}

function cookieHeader(response) {
  return response.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
}

function migrationSqlStatements(source) {
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
  if (lines.length) throw new Error("migration contains an incomplete SQL statement");
  return statements;
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

class MemoryD1 {
  constructor() {
    this.users = [];
    this.sessions = [];
    this.projects = [];
    this.reports = [];
    this.revisions = [];
    this.revisionReports = [];
    this.briefs = [];
    this.counters = [];
    this.leases = [];
    this.batchTail = Promise.resolve();
  }

  prepare(sql) {
    return new MemoryStatement(this, sql.replace(/\s+/gu, " ").trim());
  }

  async batch(statements) {
    const previous = this.batchTail;
    let unlock;
    this.batchTail = new Promise((resolve) => { unlock = resolve; });
    await previous;
    const snapshot = structuredClone({
      users: this.users,
      sessions: this.sessions,
      projects: this.projects,
      reports: this.reports,
      revisions: this.revisions,
      revisionReports: this.revisionReports,
      briefs: this.briefs,
      counters: this.counters,
      leases: this.leases,
    });
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    } catch (error) {
      Object.assign(this, snapshot);
      throw error;
    } finally {
      unlock();
    }
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
    if (this.sql.startsWith("SELECT id FROM users WHERE email=")) {
      const user = this.db.users.find((candidate) => candidate.email === this.values[0]);
      return user ? { id: user.id } : null;
    }
    if (this.sql.includes("FROM sessions s JOIN users u")) {
      const session = this.db.sessions.find((candidate) => candidate.token_hash === this.values[0]);
      const user = session && this.db.users.find((candidate) => candidate.id === session.user_id);
      return user ? {
        session_id: session.id,
        user_id: user.id,
        csrf_hash: session.csrf_hash,
        expires_at: session.expires_at,
        auth_generation: session.auth_generation,
        auth_revision_id: session.auth_revision_id,
        email: user.email,
        name: user.name,
        user_created_at: user.created_at,
      } : null;
    }
    if (this.sql.startsWith("INSERT INTO sessions")) {
      const [id, user_id, token_hash, csrf_hash, expires_at, created_at, last_seen_at, auth_generation, auth_revision_id] = this.values;
      const user = this.db.users.find((candidate) => candidate.id === user_id
        && candidate.auth_generation === auth_generation && candidate.auth_revision_id === auth_revision_id);
      if (!user) return null;
      this.db.sessions.push({ id, user_id, token_hash, csrf_hash, expires_at, created_at, last_seen_at, auth_generation, auth_revision_id });
      return { id };
    }
    if (this.sql.startsWith("SELECT p.*,EXISTS(") && this.sql.includes("FROM projects p WHERE p.id=? AND p.user_id=?")) {
      const project = this.db.projects.find((candidate) => candidate.id === this.values[0] && candidate.user_id === this.values[1]);
      return project ? { ...project, report_available: Number(this.db.revisionReports.some((report) => report.project_id === project.id
        && report.project_revision === project.input_revision && report.report_schema_version === 2)) } : null;
    }
    if (this.sql.startsWith("SELECT p.id AS project_id,p.name AS project_name,p.status AS project_status")
      && this.sql.includes("FROM project_revisions r JOIN projects p")) {
      const project = this.db.projects.find((candidate) => candidate.id === this.values[0] && candidate.user_id === this.values[1]);
      const revision = project && this.db.revisions.find((candidate) => candidate.project_id === project.id
        && candidate.revision === project.input_revision);
      const report = revision && this.db.revisionReports.find((candidate) => candidate.project_id === project.id
        && candidate.project_revision === revision.revision && candidate.report_schema_version === this.values[2]);
      return project && revision && report ? {
        project_id: project.id,
        project_name: project.name,
        project_status: project.status,
        current_input_revision: project.input_revision,
        project_created_at: project.created_at,
        project_updated_at: project.updated_at,
        ...revision,
        report_available: 1,
        source_report_id: report.source_report_id,
        report_input_hash: report.input_hash,
        content_json: report.content_json,
        report_schema_version: report.report_schema_version,
        report_generated_at: report.generated_at,
      } : null;
    }
    if (this.sql.startsWith("SELECT source_report_id,content_json FROM project_revision_reports")) {
      return this.db.revisionReports.find((candidate) => candidate.project_id === this.values[0]
        && candidate.project_revision === this.values[1] && candidate.report_schema_version === this.values[2]) || null;
    }
    if (this.sql.startsWith("SELECT content_hash FROM project_revisions")) {
      return this.db.revisions.find((candidate) => candidate.project_id === this.values[0] && candidate.revision === this.values[1]) || null;
    }
    if (this.sql.startsWith("SELECT content_json FROM project_revision_reports")) {
      return this.db.revisionReports.find((candidate) => candidate.project_id === this.values[0]
        && candidate.project_revision === this.values[1] && candidate.report_schema_version === this.values[2]) || null;
    }
    if (this.sql.startsWith("SELECT * FROM reports WHERE project_id=? AND user_id=?")) {
      return this.db.reports.find((candidate) => candidate.project_id === this.values[0] && candidate.user_id === this.values[1]) || null;
    }
    if (this.sql.startsWith("SELECT * FROM ai_planning_briefs WHERE project_id=? AND user_id=?")) {
      return this.db.briefs.find((candidate) => candidate.project_id === this.values[0] && candidate.user_id === this.values[1]) || null;
    }
    if (this.sql.startsWith("INSERT INTO ai_planning_briefs")) {
      const [
        id, project_id, user_id, schema_version, prompt_version, prompt_sha256, model,
        source_report_id, source_report_version, source_input_hash, content_json, usage_json,
        provider_interaction_id, generated_at, updated_at,
        lease_project_id, lease_user_id, lease_token, lease_source_input_hash, lease_now,
        fence_project_id, fence_user_id, fence_revision, fence_input_json, fence_estimate_json,
        current_report_id, current_project_id, current_revision, current_report_version, current_input_hash, current_content_json,
      ] = this.values;
      const lease = this.db.leases.find((candidate) => candidate.project_id === lease_project_id
        && candidate.user_id === lease_user_id
        && candidate.lease_token === lease_token
        && candidate.source_input_hash === lease_source_input_hash
        && candidate.expires_at > lease_now);
      const currentProject = this.db.projects.find((candidate) => candidate.id === fence_project_id
        && candidate.user_id === fence_user_id
        && candidate.status !== "archived"
        && candidate.input_revision === fence_revision
        && candidate.input_json === fence_input_json
        && candidate.estimate_json === fence_estimate_json);
      const report = this.db.revisionReports.find((candidate) => candidate.source_report_id === current_report_id
        && candidate.project_id === current_project_id
        && candidate.project_revision === current_revision
        && candidate.report_schema_version === current_report_version
        && candidate.input_hash === current_input_hash
        && candidate.content_json === current_content_json);
      if (!lease || !currentProject || !report) return null;
      const row = {
        id, project_id, user_id, schema_version, prompt_version, prompt_sha256, model,
        source_report_id, source_report_version, source_input_hash, content_json, usage_json,
        provider_interaction_id, generated_at, updated_at,
      };
      const index = this.db.briefs.findIndex((candidate) => candidate.project_id === project_id);
      if (index < 0) this.db.briefs.push(row);
      else this.db.briefs[index] = row;
      return { id };
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
    if (this.sql.startsWith("INSERT INTO projects")) {
      const [id, user_id, name, status, input_json, estimate_json, input_hash, input_schema_version,
        estimate_rule_version, brief_check_version, brief_check_json, creation_key_hash,
        creation_request_hash, created_at, updated_at] = this.values;
      this.db.projects.push({
        id, user_id, name, status, input_json, estimate_json, input_hash, input_schema_version,
        estimate_rule_version, brief_check_version, brief_check_json, creation_key_hash,
        creation_request_hash, input_revision: 1, created_at, updated_at,
      });
      this.db.revisions.push({
        project_id: id,
        revision: 1,
        provenance: "created",
        input_schema_version,
        estimate_rule_version,
        brief_check_version,
        content_hash: input_hash,
        input_json,
        estimate_json,
        brief_check_json,
        created_at,
      });
      return { success: true };
    }
    if (this.sql.startsWith("INSERT INTO reports")) {
      const [id, project_id, user_id, version, input_hash, content_json, generated_at, updated_at, project_input_revision,
        fence_project_id, fence_user_id, fence_revision] = this.values;
      const project = this.db.projects.find((candidate) => candidate.id === fence_project_id
        && candidate.user_id === fence_user_id && candidate.status !== "archived" && candidate.input_revision === fence_revision);
      if (!project) return { success: true, results: [] };
      const row = { id, project_id, user_id, version, input_hash, content_json, generated_at, updated_at, project_input_revision };
      const index = this.db.reports.findIndex((candidate) => candidate.project_id === project_id);
      if (index < 0) this.db.reports.push(row);
      else this.db.reports[index] = row;
      return { success: true };
    }
    if (this.sql.startsWith("INSERT INTO project_revision_reports")) {
      const [project_id, project_revision, report_schema_version, source_report_id,
        source_content_hash, input_hash, content_json, generated_at] = this.values;
      this.db.revisionReports.push({
        project_id, project_revision, report_schema_version, source_report_id,
        source_content_hash, input_hash, content_json, generated_at,
      });
      return { success: true };
    }
    if (this.sql.startsWith("UPDATE projects SET name=?,status=?,input_json=?,estimate_json=?,input_hash=?")) {
      const [name, status, input_json, estimate_json, input_hash, input_schema_version,
        estimate_rule_version, brief_check_version, brief_check_json, revisionIncrement,
        updated_at, projectId, userId, expectedRevision] = this.values;
      const project = this.db.projects.find((candidate) => candidate.id === projectId
        && candidate.user_id === userId
        && candidate.status !== "archived"
        && (expectedRevision == null || candidate.input_revision === expectedRevision));
      if (!project) return { success: true, results: [] };
      Object.assign(project, {
        name,
        status,
        input_json,
        estimate_json,
        input_hash,
        input_schema_version,
        estimate_rule_version,
        brief_check_version,
        brief_check_json,
        input_revision: project.input_revision + revisionIncrement,
        updated_at,
      });
      if (revisionIncrement) {
        this.db.revisions.push({
          project_id: projectId,
          revision: project.input_revision,
          provenance: "updated",
          input_schema_version,
          estimate_rule_version,
          brief_check_version,
          content_hash: input_hash,
          input_json,
          estimate_json,
          brief_check_json,
          created_at: updated_at,
        });
        this.db.reports = this.db.reports.filter((candidate) => candidate.project_id !== projectId);
      }
      return { success: true, results: [{ id: projectId }] };
    }
    if (this.sql.startsWith("UPDATE projects SET status='report_ready'")) {
      const [updatedAt, projectId, userId, revision] = this.values;
      const project = this.db.projects.find((candidate) => candidate.id === projectId && candidate.user_id === userId
        && candidate.status !== "archived" && candidate.input_revision === revision);
      if (project) Object.assign(project, { status: "report_ready", updated_at: updatedAt });
      return { success: true };
    }
    if (this.sql.startsWith("INSERT INTO ai_generation_leases")) {
      const [project_id, user_id, lease_token, source_input_hash, expires_at, created_at, updated_at] = this.values;
      const index = this.db.leases.findIndex((candidate) => candidate.project_id === project_id);
      if (index >= 0 && this.db.leases[index].expires_at > created_at) return { success: true, results: [] };
      const row = { project_id, user_id, lease_token, source_input_hash, expires_at, created_at, updated_at };
      if (index < 0) this.db.leases.push(row);
      else this.db.leases[index] = row;
      return { success: true, results: [{ lease_token }] };
    }
    if (this.sql.startsWith("INSERT INTO ai_generation_counters")) {
      const [scope, subject_id, window_start, increment, limit_count, updated_at,
        project_id, lease_token, source_input_hash, now] = this.values;
      const lease = this.db.leases.find((candidate) => candidate.project_id === project_id
        && candidate.lease_token === lease_token
        && candidate.source_input_hash === source_input_hash
        && candidate.expires_at > now);
      if (!lease) return { success: true, results: [] };
      const index = this.db.counters.findIndex((candidate) => candidate.scope === scope
        && candidate.subject_id === subject_id && candidate.window_start === window_start);
      const request_count = (index < 0 ? 0 : this.db.counters[index].request_count) + increment;
      if (request_count > limit_count) throw new Error("CHECK constraint failed: request_count <= limit_count");
      const row = { scope, subject_id, window_start, request_count, limit_count, updated_at };
      if (index < 0) this.db.counters.push(row);
      else this.db.counters[index] = row;
      return { success: true, results: [{ request_count }] };
    }
    if (this.sql.startsWith("DELETE FROM ai_generation_leases WHERE project_id=?")) {
      const [project_id, user_id, lease_token] = this.values;
      this.db.leases = this.db.leases.filter((candidate) => !(candidate.project_id === project_id
        && candidate.user_id === user_id && candidate.lease_token === lease_token));
      return { success: true };
    }
    if (this.sql.startsWith("DELETE FROM ai_generation_leases WHERE expires_at<=")) {
      return { success: true };
    }
    if (this.sql.startsWith("DELETE FROM ai_generation_counters WHERE updated_at<")) {
      return { success: true };
    }
    if (this.sql.startsWith("DELETE FROM password_change_attempt_counters WHERE updated_at<")) {
      return { success: true };
    }
    throw new Error(`Unhandled MemoryD1 run(): ${this.sql}`);
  }
}

const validContent = {
  headline: "A practical two-level family home",
  overview: "The feasibility report supports a two-level concept with a disciplined floor plate, staged professional verification, and careful control of the stated budget range.",
  planningPriorities: [
    "Confirm the measured boundary before fixing the footprint.",
    "Keep circulation compact across both levels.",
    "Validate the family brief before concept freeze.",
  ],
  layoutSuggestions: [
    "Group living and dining into one efficient social zone.",
    "Place the utility beside the kitchen for short service runs.",
    "Reserve a code-compliant stair core between levels.",
  ],
  costAndDeliveryNotes: [
    "Use the report's INR range only as concept-stage guidance.",
    "Obtain itemized contractor bids from coordinated drawings.",
  ],
  riskFlags: [
    "Local setbacks and FAR or FSI remain unverified.",
    "Foundation assumptions require a geotechnical investigation.",
  ],
  questionsForArchitect: [
    "Which local setbacks apply to this plot?",
    "How should daylight and cross-ventilation shape the plan?",
    "What structural grid best supports the proposed floor plate?",
  ],
};

function geminiResponse(content = validContent) {
  return new Response(JSON.stringify({
    id: "interaction-test-1",
    status: "completed",
    steps: [{ type: "model_output", content: [{ type: "text", text: JSON.stringify(content) }] }],
    usage: {
      total_input_tokens: 500,
      total_output_tokens: 240,
      total_thought_tokens: 30,
      total_tokens: 770,
    },
  }), { status: 200, headers: { "content-type": "application/json" } });
}

async function registerAndCreateProject(env, email = "owner@example.test") {
  const registered = await worker.fetch(request("/api/auth/register", {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ email, password: "correct horse battery staple" }),
  }), env);
  assert.equal(registered.status, 201);
  const registration = await registered.json();
  const cookies = cookieHeader(registered);
  const created = await worker.fetch(request("/api/projects", {
    method: "POST",
    headers: {
      origin: ORIGIN,
      cookie: cookies,
      "x-csrf-token": registration.csrfToken,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      name: "Private Gupta residence",
      input: {
        width: 30,
        length: 50,
        floors: "G+1",
        city: "Pune",
        quality: "Signature",
        style: "42 Private Street · SECRET-CUSTOMER-NOTE",
      },
    }),
  }), env);
  assert.equal(created.status, 201);
  const owner = { cookies, csrfToken: registration.csrfToken, project: (await created.json()).project };
  const report = await worker.fetch(authenticatedPost(`/api/projects/${owner.project.id}/report`, owner, {}), env);
  assert.equal(report.status, 201);
  return owner;
}

function authenticatedPost(path, owner, body) {
  return request(path, {
    method: "POST",
    headers: {
      origin: ORIGIN,
      cookie: owner.cookies,
      "x-csrf-token": owner.csrfToken,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function authenticatedPatch(path, owner, body) {
  return request(path, {
    method: "PATCH",
    headers: {
      origin: ORIGIN,
      cookie: owner.cookies,
      "x-csrf-token": owner.csrfToken,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

test("AI prompt is allowlisted to the deterministic report and excludes project or account PII", () => {
  const prompt = __test.aiPrompt({
    id: "private-report-id",
    projectId: "private-project-id",
    title: "Private Gupta residence — feasibility report",
    version: 1,
    inputHash: "known-input-hash",
    generatedAt: "2026-08-13 12:00:00",
    summary: { city: "Pune", plotSqft: 1500 },
    areaProgram: { targetBuiltUpSqft: 1830 },
    costPlan: { currency: "INR", lowInr: 3_700_000 },
    deliveryPlan: { estimatedMonths: 11 },
    risks: ["Approvals require verification."],
    nextActions: ["Appoint a licensed architect."],
    address: "42 Private Street",
    accountEmail: "owner@example.test",
    uploads: ["title-deed.pdf"],
  });
  assert.equal(prompt.includes("known-input-hash"), false);
  assert.match(prompt, /Appoint a licensed architect/u);
  for (const secret of ["Private Gupta", "private-report-id", "private-project-id", "42 Private Street", "owner@example.test", "title-deed.pdf"]) {
    assert.equal(prompt.includes(secret), false);
  }
});

test("semantic validator rejects extra fields and malformed or oversized content", () => {
  assert.throws(() => __test.validateAiBriefContent({ ...validContent, inventedApproval: true }), /unsupported fields/u);
  assert.throws(() => __test.validateAiBriefContent({ ...validContent, riskFlags: ["one"] }), /between 2 and 6/u);
  assert.throws(() => __test.validateAiBriefContent({ ...validContent, overview: "x".repeat(1201) }), /between 40 and 1200/u);
  const validated = __test.validateAiBriefContent(validContent);
  assert.match(validated.disclaimer, /licensed professionals/u);
});

test("advisory boundary rejects unsafe claims and permits only claim-adjacent cautions", () => {
  const rejected = [
    "The plan is fully code-compliant.",
    "Guaranteed permit approval.",
    "This design is structurally safe.",
    "Begin excavation immediately.",
    "No licensed professional is needed.",
    "The budget is not fixed, but this plan is fully code-compliant.",
    "The plan is not only fully code-compliant; it is structurally safe.",
    "The soil test is unnecessary.",
    "The plan is likely compliant.",
    "Not only is it approved, it is structurally safe.",
    "Do not verify permits; they are unnecessary.",
    "This concept is construction-ready and replaces professional review.",
    "The plan is not reviewed, but it is fully code-compliant.",
    "The permit is approved.",
    "Structural adequacy is guaranteed.",
    "You may go ahead with construction.",
    "There is no need for a licensed engineer.",
  ];
  for (const phrase of rejected) {
    assert.throws(() => __test.validateAiAdvisoryBoundary({ overview: phrase }), /advisory boundary violation/u, phrase);
  }

  const allowed = [
    "The plan is not fully code-compliant.",
    "No guaranteed approval is offered.",
    "Guaranteed approval is not offered.",
    "Do not begin excavation until permits are issued.",
    "This cannot establish structural safety.",
    "The plan isn't fully code-compliant.",
    "The plan cannot be treated as structurally safe.",
    "No guarantee of municipal approval is provided.",
    "Ask the authority whether a permit is required.",
    "Ask the local architect whether the plan complies with all applicable bylaws.",
    "Verify whether the proposal meets all applicable codes.",
    "Confirm whether the plan is structurally safe after engineering review.",
    "The soil test is not unnecessary.",
  ];
  for (const phrase of allowed) {
    assert.doesNotThrow(() => __test.validateAiAdvisoryBoundary({ overview: phrase }), phrase);
  }

  assert.throws(() => __test.validateAiAdvisoryBoundary({
    headline: "The plan is fully co\u200Fde",
    overview: "-compliant.",
  }), /advisory boundary violation/u);
  assert.throws(() => __test.validateAiAdvisoryBoundary({
    headline: "The plan is structurally\u2066",
    overview: "safe.",
  }), /advisory boundary violation/u);
});

test("POST generates, audits, caches, and GET returns an owner-scoped Gemini brief", async () => {
  const DB = new MemoryD1();
  const calls = [];
  const env = {
    ASSETS: assets,
    DB,
    GRIHAGRID_CACHE: new MemoryKv(),
    GEMINI_API_KEY: API_KEY,
    GEMINI_FETCH: async (url, init) => {
      calls.push({ url, init });
      return geminiResponse();
    },
  };
  const owner = await registerAndCreateProject(env);
  const path = `/api/projects/${owner.project.id}/ai-brief`;

  const created = await worker.fetch(authenticatedPost(path, owner, { acceptedAiTerms: true }), env);
  assert.equal(created.status, 201);
  const createdBody = await created.json();
  assert.equal(createdBody.cached, false);
  assert.equal(createdBody.aiBrief.model, "gemini-3.6-flash");
  assert.equal(createdBody.aiBrief.promptVersion, "grihagrid-planning-brief-v1");
  assert.equal(createdBody.aiBrief.source.inputHash, owner.project.input ? DB.reports[0].input_hash : null);
  assert.equal(createdBody.aiBrief.content.disclaimer.includes("AI-generated concept guidance"), true);
  assert.deepEqual(createdBody.aiBrief.usage, { inputTokens: 500, outputTokens: 240, thoughtTokens: 30, totalTokens: 770 });
  assert.equal(JSON.stringify(createdBody).includes(API_KEY), false);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://generativelanguage.googleapis.com/v1/interactions");
  assert.equal(calls[0].init.headers["x-goog-api-key"], API_KEY);
  const providerBody = JSON.parse(calls[0].init.body);
  assert.equal(providerBody.store, false);
  assert.equal(providerBody.model, "gemini-3.6-flash");
  assert.deepEqual(providerBody.generation_config, { max_output_tokens: 2400, thinking_level: "low" });
  // The public Gemini Interactions API rejects safety_settings (those are
  // currently limited to the Enterprise Agent Platform). Keep the request on
  // the supported API surface and enforce the product boundary in the
  // allowlisted prompt plus strict output validation.
  assert.equal(Object.hasOwn(providerBody, "safety_settings"), false);
  assert.equal(providerBody.response_format.mime_type, "application/json");
  for (const secret of ["Private Gupta residence", "42 Private Street", "SECRET-CUSTOMER-NOTE", "owner@example.test", owner.project.id]) {
    assert.equal(providerBody.input.includes(secret), false);
  }
  assert.equal(DB.briefs[0].prompt_sha256.length, 64);
  assert.equal(DB.briefs[0].provider_interaction_id, "interaction-test-1");
  assert.equal(DB.leases.length, 0);
  assert.deepEqual(DB.counters.map(({ scope, request_count }) => ({ scope, request_count })), [
    { scope: "user_hour", request_count: 1 },
    { scope: "platform_day", request_count: 2 },
  ]);

  const countersBeforeCacheHit = structuredClone(DB.counters);
  const cached = await worker.fetch(authenticatedPost(path, owner, { acceptedAiTerms: true }), env);
  assert.equal(cached.status, 200);
  assert.equal((await cached.json()).cached, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(DB.counters, countersBeforeCacheHit);

  const fetched = await worker.fetch(request(path, { headers: { cookie: owner.cookies } }), env);
  assert.equal(fetched.status, 200);
  assert.equal((await fetched.json()).cached, true);

  const other = await registerAndCreateProject(env, "other@example.test");
  const isolated = await worker.fetch(request(path, { headers: { cookie: other.cookies } }), env);
  assert.equal(isolated.status, 404);
  assert.equal((await isolated.json()).code, "project_not_found");
});

test("single-flight lease prevents concurrent provider calls for one project", async () => {
  const DB = new MemoryD1();
  let providerCalls = 0;
  let resolveProviderStarted;
  let releaseProvider;
  const providerStarted = new Promise((resolve) => { resolveProviderStarted = resolve; });
  const providerGate = new Promise((resolve) => { releaseProvider = resolve; });
  const env = {
    ASSETS: assets,
    DB,
    GRIHAGRID_CACHE: new MemoryKv(),
    GEMINI_API_KEY: API_KEY,
    GEMINI_FETCH: async () => {
      providerCalls += 1;
      resolveProviderStarted();
      await providerGate;
      return geminiResponse();
    },
  };
  const owner = await registerAndCreateProject(env);
  const path = `/api/projects/${owner.project.id}/ai-brief`;
  const firstPromise = worker.fetch(authenticatedPost(path, owner, { acceptedAiTerms: true }), env);
  await providerStarted;
  const concurrent = await worker.fetch(authenticatedPost(path, owner, { acceptedAiTerms: true }), env);
  assert.equal(concurrent.status, 409);
  assert.equal((await concurrent.json()).code, "ai_generation_in_progress");
  assert.equal(providerCalls, 1);
  releaseProvider();
  assert.equal((await firstPromise).status, 201);
  assert.equal(DB.leases.length, 0);
  assert.equal(DB.counters.find((row) => row.scope === "user_hour").request_count, 1);
  assert.equal(DB.counters.find((row) => row.scope === "platform_day").request_count, 2);
});

test("provider failures release the lease and stale generations cannot overwrite changed reports", async () => {
  const failureDb = new MemoryD1();
  const failureEnv = {
    ASSETS: assets,
    DB: failureDb,
    GRIHAGRID_CACHE: new MemoryKv(),
    GEMINI_API_KEY: API_KEY,
    GEMINI_FETCH: async () => new Response("provider detail", { status: 400 }),
  };
  const failureOwner = await registerAndCreateProject(failureEnv);
  const failurePath = `/api/projects/${failureOwner.project.id}/ai-brief`;
  const failed = await worker.fetch(authenticatedPost(failurePath, failureOwner, { acceptedAiTerms: true }), failureEnv);
  assert.equal(failed.status, 502);
  assert.equal(failureDb.leases.length, 0);
  assert.equal(failureDb.briefs.length, 0);
  failureEnv.GEMINI_FETCH = async () => geminiResponse();
  assert.equal((await worker.fetch(authenticatedPost(failurePath, failureOwner, { acceptedAiTerms: true }), failureEnv)).status, 201);

  const staleDb = new MemoryD1();
  let resolveProviderStarted;
  let releaseProvider;
  const providerStarted = new Promise((resolve) => { resolveProviderStarted = resolve; });
  const providerGate = new Promise((resolve) => { releaseProvider = resolve; });
  const staleEnv = {
    ASSETS: assets,
    DB: staleDb,
    GRIHAGRID_CACHE: new MemoryKv(),
    GEMINI_API_KEY: API_KEY,
    GEMINI_FETCH: async () => {
      resolveProviderStarted();
      await providerGate;
      return geminiResponse();
    },
  };
  const staleOwner = await registerAndCreateProject(staleEnv, "stale@example.test");
  const stalePath = `/api/projects/${staleOwner.project.id}/ai-brief`;
  const stalePromise = worker.fetch(authenticatedPost(stalePath, staleOwner, { acceptedAiTerms: true }), staleEnv);
  await providerStarted;
  const revised = await worker.fetch(authenticatedPatch(`/api/projects/${staleOwner.project.id}`, staleOwner, {
    expectedInputRevision: 1,
    input: { bathrooms: 4 },
  }), staleEnv);
  assert.equal(revised.status, 200, JSON.stringify(await revised.clone().json()));
  assert.equal((await revised.json()).project.inputRevision, 2);
  releaseProvider();
  const stale = await stalePromise;
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).code, "ai_generation_superseded");
  assert.equal(staleDb.briefs.length, 0);
  assert.equal(staleDb.leases.length, 0);
});

test("real D1 rejects a Gemini result when a legitimate brief revision wins during provider work", async (context) => {
  const mf = new Miniflare({
    workers: [{
      config: {
        name: "gemini-currentness-race-test",
        type: "worker",
        compatibilityDate: "2026-08-01",
        manifest: {
          mainModule: "index.mjs",
          modulesRoot: process.cwd(),
          modules: { "index.mjs": { type: "esm", contents: "export default {}" } },
        },
        env: { DB: { type: "d1", name: "gemini-currentness-race" } },
      },
    }],
  });
  context.after(() => mf.dispose());
  const db = await mf.getD1Database("DB");
  const migrations = [
    "0001_initial.sql",
    "0002_backend.sql",
    "0003_payments.sql",
    "0004_commercial_fulfillment.sql",
    "0005_gemini_ai.sql",
    "0006_ai_abuse_controls.sql",
    "0007_decision_compare.sql",
    "0008_payment_state_hardening.sql",
    "0009_decision_selection_lock.sql",
    "0010_family_alignment.sql",
    "0011_archived_project_write_fence.sql",
    "0012_brief_check_revision_history.sql",
    "0013_report_feedback_and_intake_hardening.sql",
    "0014_project_creation_idempotency.sql",
    "0015_account_security.sql",
  ];
  for (const migration of migrations) {
    const source = await readFile(new URL(`../migrations/${migration}`, import.meta.url), "utf8");
    for (const statement of migrationSqlStatements(source)) await db.prepare(statement).run();
  }

  let providerStartedResolve;
  let releaseProvider;
  const providerStarted = new Promise((resolve) => { providerStartedResolve = resolve; });
  const providerGate = new Promise((resolve) => { releaseProvider = resolve; });
  const env = {
    ASSETS: assets,
    DB: db,
    GRIHAGRID_CACHE: new MemoryKv(),
    GEMINI_API_KEY: API_KEY,
    GEMINI_FETCH: async () => {
      providerStartedResolve();
      await providerGate;
      return geminiResponse();
    },
  };
  const owner = await registerAndCreateProject(env, "gemini-race@example.test");
  const aiPromise = worker.fetch(authenticatedPost(
    `/api/projects/${owner.project.id}/ai-brief`,
    owner,
    { acceptedAiTerms: true },
  ), env);
  await providerStarted;

  const revised = await worker.fetch(authenticatedPatch(`/api/projects/${owner.project.id}`, owner, {
    expectedInputRevision: 1,
    input: { bathrooms: 4 },
  }), env);
  assert.equal(revised.status, 200, JSON.stringify(await revised.clone().json()));
  assert.equal((await revised.json()).project.inputRevision, 2);
  releaseProvider();

  const stale = await aiPromise;
  assert.equal(stale.status, 409, JSON.stringify(await stale.clone().json()));
  assert.equal((await stale.json()).code, "ai_generation_superseded");
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM ai_planning_briefs").first()).count, 0);
  assert.equal((await db.prepare("SELECT input_revision FROM projects WHERE id=?").bind(owner.project.id).first()).input_revision, 2);
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM ai_generation_leases").first()).count, 0);
});

test("atomic admission enforces exact user and platform ceilings without partial charges", async () => {
  const at = new Date("2026-08-13T12:15:00Z");
  const hash = "a".repeat(64);
  const userDb = new MemoryD1();
  await __test.acquireAiGenerationAdmission(userDb, "project-1", "user-1", hash, at, { userHourly: 1, platformDaily: 100 });
  await assert.rejects(
    () => __test.acquireAiGenerationAdmission(userDb, "project-2", "user-1", hash, at, { userHourly: 1, platformDaily: 100 }),
    (error) => error.status === 429 && error.code === "ai_rate_limited",
  );
  assert.equal(userDb.leases.length, 1);
  assert.deepEqual(userDb.counters.map(({ scope, request_count }) => [scope, request_count]), [
    ["user_hour", 1],
    ["platform_day", 2],
  ]);

  const platformDb = new MemoryD1();
  await __test.acquireAiGenerationAdmission(platformDb, "project-1", "user-1", hash, at, { userHourly: 10, platformDaily: 2 });
  await assert.rejects(
    () => __test.acquireAiGenerationAdmission(platformDb, "project-2", "user-2", hash, at, { userHourly: 10, platformDaily: 2 }),
    (error) => error.status === 429 && error.code === "ai_rate_limited",
  );
  assert.equal(platformDb.leases.length, 1);
  assert.equal(platformDb.counters.some((row) => row.subject_id === "user-2"), false);
  assert.equal(platformDb.counters.find((row) => row.scope === "platform_day").request_count, 2);

  const expiryDb = new MemoryD1();
  const firstToken = await __test.acquireAiGenerationAdmission(expiryDb, "project-1", "user-1", hash, at, { userHourly: 10, platformDaily: 10 });
  const replacementToken = await __test.acquireAiGenerationAdmission(
    expiryDb,
    "project-1",
    "user-1",
    hash,
    new Date(at.getTime() + 46_000),
    { userHourly: 10, platformDaily: 10 },
  );
  assert.notEqual(replacementToken, firstToken);
  assert.equal(expiryDb.leases.length, 1);
});

test("real D1 batch rolls back lease and user charge when the platform ceiling fails", async (context) => {
  const mf = new Miniflare({
    workers: [{
      config: {
        name: "gemini-d1-test",
        type: "worker",
        compatibilityDate: "2026-08-01",
        manifest: {
          mainModule: "index.mjs",
          modulesRoot: process.cwd(),
          modules: { "index.mjs": { type: "esm", contents: "export default {}" } },
        },
        env: { DB: { type: "d1", name: "gemini-test" } },
      },
    }],
  });
  context.after(() => mf.dispose());
  const db = await mf.getD1Database("DB");
  await db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE projects (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE);
  `);
  const migration = await readFile(new URL("../migrations/0006_ai_abuse_controls.sql", import.meta.url), "utf8");
  const migrationStatements = migration.replace(/^(?:PRAGMA|--)[^\n]*$/gmu, "")
    .split(";").map((sql) => sql.trim()).filter(Boolean);
  for (const sql of migrationStatements) await db.prepare(sql).run();
  await db.batch([
    db.prepare("INSERT INTO users(id) VALUES (?), (?)").bind("user-1", "user-2"),
    db.prepare("INSERT INTO projects(id,user_id) VALUES (?,?), (?,?)").bind("project-1", "user-1", "project-2", "user-2"),
  ]);
  const at = new Date("2026-08-13T12:15:00Z");
  const hash = "b".repeat(64);
  await __test.acquireAiGenerationAdmission(db, "project-1", "user-1", hash, at, { userHourly: 10, platformDaily: 2 });
  await assert.rejects(
    () => __test.acquireAiGenerationAdmission(db, "project-2", "user-2", hash, at, { userHourly: 10, platformDaily: 2 }),
    (error) => error.status === 429 && error.code === "ai_rate_limited",
  );
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM ai_generation_leases").first()).count, 1);
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM ai_generation_counters WHERE subject_id='user-2'").first()).count, 0);
  assert.equal((await db.prepare("SELECT request_count FROM ai_generation_counters WHERE scope='platform_day'").first()).request_count, 2);
});

test("AI writes enforce origin, CSRF, and explicit adult/processing acknowledgement", async () => {
  const env = {
    ASSETS: assets,
    DB: new MemoryD1(),
    GRIHAGRID_CACHE: new MemoryKv(),
    GEMINI_API_KEY: API_KEY,
    GEMINI_FETCH: async () => geminiResponse(),
  };
  const owner = await registerAndCreateProject(env);
  const path = `/api/projects/${owner.project.id}/ai-brief`;

  const terms = await worker.fetch(authenticatedPost(path, owner, {}), env);
  assert.equal(terms.status, 400);
  assert.equal((await terms.json()).code, "ai_terms_required");

  const csrf = await worker.fetch(request(path, {
    method: "POST",
    headers: { origin: ORIGIN, cookie: owner.cookies, "content-type": "application/json" },
    body: JSON.stringify({ acceptedAiTerms: true }),
  }), env);
  assert.equal(csrf.status, 403);
  assert.equal((await csrf.json()).code, "csrf_rejected");

  const origin = await worker.fetch(request(path, {
    method: "POST",
    headers: {
      origin: "https://evil.example",
      cookie: owner.cookies,
      "x-csrf-token": owner.csrfToken,
      "content-type": "application/json",
    },
    body: JSON.stringify({ acceptedAiTerms: true }),
  }), env);
  assert.equal(origin.status, 403);
  assert.equal((await origin.json()).code, "origin_rejected");
});

test("Gemini failures are safely mapped, retry only transient statuses, and never persist invalid output", async () => {
  let attempts = 0;
  const transient = await __test.callGemini({
    GEMINI_FETCH: async () => {
      attempts += 1;
      return attempts === 1 ? new Response("temporary internal detail", { status: 503 }) : geminiResponse();
    },
  }, "grounded prompt", { apiKey: API_KEY, model: "gemini-3.6-flash" });
  assert.equal(attempts, 2);
  assert.equal(transient.content.headline, validContent.headline);

  attempts = 0;
  await assert.rejects(() => __test.callGemini({
    GEMINI_FETCH: async () => {
      attempts += 1;
      return new Response("bad request detail must not escape", { status: 400 });
    },
  }, "grounded prompt", { apiKey: API_KEY, model: "gemini-3.6-flash" }), (error) => {
    assert.equal(error.status, 502);
    assert.equal(error.code, "ai_provider_error");
    assert.equal(error.message.includes("bad request detail"), false);
    return true;
  });
  assert.equal(attempts, 1);

  await assert.rejects(() => __test.callGemini({
    GEMINI_FETCH: async () => geminiResponse({ ...validContent, riskFlags: ["one"] }),
  }, "grounded prompt", { apiKey: API_KEY, model: "gemini-3.6-flash" }), (error) => {
    assert.equal(error.status, 502);
    assert.equal(error.code, "ai_provider_error");
    return true;
  });
});

test("AI provider configuration fails closed while model fallback is stable", async () => {
  assert.equal(__test.aiModel({}), "gemini-3.6-flash");
  assert.equal(__test.aiModel({ GEMINI_MODEL: "gemini-3.6-flash" }), "gemini-3.6-flash");
  assert.throws(() => __test.aiModel({ GEMINI_MODEL: "bad/model?key=leak" }), /configuration is invalid/u);

  const env = { ASSETS: assets, DB: new MemoryD1(), GRIHAGRID_CACHE: new MemoryKv() };
  const owner = await registerAndCreateProject(env);
  const response = await worker.fetch(authenticatedPost(`/api/projects/${owner.project.id}/ai-brief`, owner, { acceptedAiTerms: true }), env);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "ai_unavailable");
});

test("readiness reports AI capability without exposing the configured secret", async () => {
  const readinessDb = (counts = {
    count: 27,
    ai_brief_count: 1,
    ai_abuse_count: 2,
    decision_table_count: 6,
    payment_hardening_count: 2,
    family_alignment_count: 2,
    revision_table_count: 3,
    report_feedback_count: 1,
    report_share_count: 4,
  }, withBatch = true, staleDecisionColumns = false, stalePaymentColumns = false, staleFamilyColumns = false, staleFamilyObjects = false, staleArchiveSafety = false, staleRevisionObjects = false, staleProjectCreation = false) => ({
    ...(withBatch ? { batch: async () => [] } : {}),
    prepare(sql) {
      return {
        first: async () => {
          if (sql.includes("family_alignment_trigger_count")) {
            return staleFamilyObjects
              ? { family_alignment_trigger_count: 6, family_alignment_index_count: 3 }
              : { family_alignment_trigger_count: 7, family_alignment_index_count: 3 };
          }
          if (sql.includes("archived_decision_comparison_insert_guard")) {
            return { count: staleArchiveSafety ? 12 : 13 };
          }
          if (sql.includes("AS trigger_count") && sql.includes("project_revision_capture_insert")) {
            return staleRevisionObjects ? { trigger_count: 13, index_count: 2 } : { trigger_count: 14, index_count: 3 };
          }
          if (sql.includes("AS trigger_count") && sql.includes("report_feedback_insert_guard")) {
            return { trigger_count: 5, index_count: 2 };
          }
          if (sql.includes("AS trigger_count") && sql.includes("report_share_sections_insert_guard")) {
            return { trigger_count: 5, index_count: 5 };
          }
          if (sql.includes("idx_projects_user_creation_key")) {
            return { count: staleProjectCreation ? 0 : 1 };
          }
          if (sql.includes("FROM report_handoff_controls")) return { enabled: 1 };
          if (sql.includes("users_auth_state_update_guard")) {
            return { trigger_count: 2, index_count: 2 };
          }
          if (sql.includes("FROM sqlite_master")) return counts;
          if (staleFamilyColumns && sql.includes("FROM family_alignment_rooms")) throw new Error("no such column: request_hash");
          if (staleDecisionColumns && sql.includes("FROM decision_shares")) throw new Error("no such column: request_hash");
          if (stalePaymentColumns && sql.includes("FROM payment_terminal_records")) throw new Error("no such table: payment_terminal_records");
          return null;
        },
      };
    },
  });
  const response = await worker.fetch(request("/api/readiness"), {
    ASSETS: assets,
    DB: readinessDb(),
    GRIHAGRID_CACHE: new MemoryKv(),
    GEMINI_API_KEY: API_KEY,
    REPORT_SHARE_ABUSE_HMAC_KEY,
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.checks.ai, "configured");
  assert.equal(body.checks.aiSchema, "current");
  assert.equal(body.checks.aiAbuseControl, "configured");
  assert.equal(body.checks.paymentSchema, "current");
  assert.equal(body.checks.familyAlignmentSchema, "current");
  assert.equal(body.checks.archiveSafetySchema, "current");
  assert.equal(body.checks.revisionSchema, "current");
  assert.equal(body.checks.reportFeedbackSchema, "current");
  assert.equal(body.checks.reportShareSchema, "current");
  assert.equal(body.checks.projectCreationSchema, "current");
  assert.equal(body.capabilities.aiPlanningBrief, true);
  assert.equal(body.capabilities.familyAlignment, true);
  assert.equal(body.capabilities.briefCheck, true);
  assert.equal(body.capabilities.reportFeedback, true);
  assert.equal(body.capabilities.reportHandoff, true);
  assert.equal(JSON.stringify(body).includes(API_KEY), false);

  const staleDecision = await worker.fetch(request("/api/readiness"), {
    ASSETS: assets,
    DB: readinessDb(undefined, true, true),
    GRIHAGRID_CACHE: new MemoryKv(),
    GEMINI_API_KEY: API_KEY,
    REPORT_SHARE_ABUSE_HMAC_KEY,
  });
  assert.equal(staleDecision.status, 503);
  const staleDecisionBody = await staleDecision.json();
  assert.equal(staleDecisionBody.checks.decisionSchema, "outdated");
  assert.equal(staleDecisionBody.capabilities.decisionCompare, false);

  const stalePayment = await worker.fetch(request("/api/readiness"), {
    ASSETS: assets,
    DB: readinessDb(undefined, true, false, true),
    GRIHAGRID_CACHE: new MemoryKv(),
    GEMINI_API_KEY: API_KEY,
    REPORT_SHARE_ABUSE_HMAC_KEY,
  });
  assert.equal(stalePayment.status, 503);
  const stalePaymentBody = await stalePayment.json();
  assert.equal(stalePaymentBody.checks.paymentSchema, "outdated");
  assert.equal(stalePaymentBody.capabilities.paidCheckout, false);

  const staleFamily = await worker.fetch(request("/api/readiness"), {
    ASSETS: assets,
    DB: readinessDb(undefined, true, false, false, true),
    GRIHAGRID_CACHE: new MemoryKv(),
    GEMINI_API_KEY: API_KEY,
    REPORT_SHARE_ABUSE_HMAC_KEY,
  });
  assert.equal(staleFamily.status, 503);
  const staleFamilyBody = await staleFamily.json();
  assert.equal(staleFamilyBody.checks.familyAlignmentSchema, "outdated");
  assert.equal(staleFamilyBody.capabilities.familyAlignment, false);

  const staleFamilyObjects = await worker.fetch(request("/api/readiness"), {
    ASSETS: assets,
    DB: readinessDb(undefined, true, false, false, false, true),
    GRIHAGRID_CACHE: new MemoryKv(),
    GEMINI_API_KEY: API_KEY,
    REPORT_SHARE_ABUSE_HMAC_KEY,
  });
  assert.equal(staleFamilyObjects.status, 503);
  const staleFamilyObjectsBody = await staleFamilyObjects.json();
  assert.equal(staleFamilyObjectsBody.checks.familyAlignmentSchema, "outdated");
  assert.equal(staleFamilyObjectsBody.capabilities.familyAlignment, false);

  const staleArchiveSafety = await worker.fetch(request("/api/readiness"), {
    ASSETS: assets,
    DB: readinessDb(undefined, true, false, false, false, false, true),
    GRIHAGRID_CACHE: new MemoryKv(),
    GEMINI_API_KEY: API_KEY,
    REPORT_SHARE_ABUSE_HMAC_KEY,
  });
  assert.equal(staleArchiveSafety.status, 503);
  const staleArchiveSafetyBody = await staleArchiveSafety.json();
  assert.equal(staleArchiveSafetyBody.checks.archiveSafetySchema, "outdated");
  assert.equal(staleArchiveSafetyBody.capabilities.freePlanning, false);

  const staleRevisionObjectsResponse = await worker.fetch(request("/api/readiness"), {
    ASSETS: assets,
    DB: readinessDb(undefined, true, false, false, false, false, false, true),
    GRIHAGRID_CACHE: new MemoryKv(),
    GEMINI_API_KEY: API_KEY,
    REPORT_SHARE_ABUSE_HMAC_KEY,
  });
  assert.equal(staleRevisionObjectsResponse.status, 503);
  const staleRevisionObjectsBody = await staleRevisionObjectsResponse.json();
  assert.equal(staleRevisionObjectsBody.status, "not_ready");
  assert.equal(staleRevisionObjectsBody.checks.revisionSchema, "outdated");
  assert.equal(staleRevisionObjectsBody.capabilities.briefCheck, false);

  const staleProjectCreationResponse = await worker.fetch(request("/api/readiness"), {
    ASSETS: assets,
    DB: readinessDb(undefined, true, false, false, false, false, false, false, true),
    GRIHAGRID_CACHE: new MemoryKv(),
    GEMINI_API_KEY: API_KEY,
    REPORT_SHARE_ABUSE_HMAC_KEY,
  });
  assert.equal(staleProjectCreationResponse.status, 503);
  const staleProjectCreationBody = await staleProjectCreationResponse.json();
  assert.equal(staleProjectCreationBody.checks.projectCreationSchema, "outdated");
  assert.equal(staleProjectCreationBody.capabilities.freePlanning, false);

  for (const [label, overrides] of [
    ["invalid model", { DB: readinessDb(), GEMINI_API_KEY: API_KEY, GEMINI_MODEL: "bad/model" }],
    ["missing AI table", { DB: readinessDb({ count: 24, ai_brief_count: 0, ai_abuse_count: 2, decision_table_count: 6, payment_hardening_count: 2, family_alignment_count: 2, revision_table_count: 3, report_feedback_count: 1, report_share_count: 4 }), GEMINI_API_KEY: API_KEY }],
    ["missing atomic batch", { DB: readinessDb(undefined, false), GEMINI_API_KEY: API_KEY }],
    ["invalid key", { DB: readinessDb(), GEMINI_API_KEY: "short" }],
  ]) {
    const unavailable = await worker.fetch(request("/api/readiness"), {
      ASSETS: assets,
      GRIHAGRID_CACHE: new MemoryKv(),
      REPORT_SHARE_ABUSE_HMAC_KEY,
      ...overrides,
    });
    const unavailableBody = await unavailable.json();
    assert.equal(unavailableBody.checks.ai, "unavailable", label);
    assert.equal(unavailableBody.capabilities.aiPlanningBrief, false, label);
  }
});
