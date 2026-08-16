import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runAuthenticatedSmoke } from "../scripts/authenticated-smoke.mjs";
import {
  buildCanaryResidueSql,
  buildPreMigrationEvidence,
  verifyCanaryResidueEvidence,
  verifyPostMigrationEvidence,
} from "../scripts/release-db-evidence.mjs";
import { monitorRelease, ReleaseTailCoverageError, summarizeSamples } from "../scripts/monitor-release.mjs";
import { changedFiles, classifyReleaseFiles, isDocumentationOnly } from "../scripts/release-scope.mjs";

test("release scope skips only documentation and treats deletions as deployable file paths", () => {
  assert.equal(isDocumentationOnly("docs/operations-runbook.md"), true);
  assert.equal(isDocumentationOnly("AGENTS.md"), true);
  assert.equal(isDocumentationOnly("src/runtime-contract.md"), false);
  assert.equal(isDocumentationOnly("worker/index.js"), false);
  assert.deepEqual(classifyReleaseFiles(["AGENTS.md", "docs/test-plan.md"]), {
    files: ["AGENTS.md", "docs/test-plan.md"],
    deploy: false,
    migrations: false,
  });
  assert.equal(classifyReleaseFiles(["docs/test-plan.md", "worker/removed-module.js"]).deploy, true);
  assert.equal(classifyReleaseFiles(["migrations/0013_release_guard.sql"]).migrations, true);
  assert.throws(() => classifyReleaseFiles([]), /at least one file/u);
});

test("release database evidence hard-gates legacy safety and proves migration data invariance", () => {
  const d1 = (results) => [{ success: true, results }];
  const countsRows = [
    ["users", 1], ["sessions", 1], ["projects", 1], ["reports", 1], ["orders", 0], ["payment_webhook_events", 0],
  ].map(([entity, row_count]) => ({ entity, row_count }));
  const audit = {
    invalid_input_rows: 0,
    unknown_input_rows: 0,
    soil_report_keys: 0,
    unsafe_revision_reports: 0,
    unsafe_current_reports: 0,
  };
  const users = [{
    id: "user-1",
    email: "owner@example.test",
    name: "Owner",
    password_hash: "password-hash",
    password_salt: "password-salt",
    password_iterations: 100000,
    password_algorithm: "PBKDF2-SHA256",
    created_at: "2026-08-16 00:00:00",
    deleted_at: null,
  }];
  const sessions = [{
    id: "session-1",
    user_id: "user-1",
    token_hash: "token-hash",
    csrf_hash: "csrf-hash",
    expires_at: "2026-09-16 00:00:00",
    created_at: "2026-08-16 00:00:00",
    last_seen_at: "2026-08-16 00:00:00",
  }];
  const projects = [{ id: "project-1", input_json: "{\"width\":30}", status: "report_ready" }];
  const reports = [{ id: "report-1", project_id: "project-1", content_json: "{\"version\":2}" }];
  const pre = buildPreMigrationEvidence({
    environment: "staging",
    countsPayload: d1(countsRows),
    auditPayload: d1([audit]),
    usersPayload: d1(users),
    sessionsPayload: d1(sessions),
    projectsPayload: d1(projects),
    reportsPayload: d1(reports),
  });
  assert.equal(pre.legacySafety.unknown_input_rows, 0);
  assert.match(pre.canonical.projects.sha256, /^[a-f0-9]{64}$/u);
  assert.throws(
    () => buildPreMigrationEvidence({
      environment: "staging",
      countsPayload: d1(countsRows),
      auditPayload: d1([{ ...audit, soil_report_keys: 1 }]),
      usersPayload: d1(users),
      sessionsPayload: d1(sessions),
      projectsPayload: d1(projects),
      reportsPayload: d1(reports),
    }),
    /soil_report_keys must be zero/u,
  );

  const schemaNames = [
    "table:users", "table:projects", "table:orders", "table:project_revisions",
    "index:idx_project_revisions_owner_created", "trigger:project_revisions_immutable_update",
    "trigger:archived_project_revision_insert_guard", "trigger:purchased_report_snapshots_immutable_update",
    "table:report_feedback", "index:idx_report_feedback_updated", "index:idx_report_feedback_outcome",
    "trigger:report_feedback_insert_guard", "trigger:report_feedback_update_guard",
    "trigger:project_input_allowlist_insert_guard", "trigger:project_input_allowlist_update_guard",
    "trigger:project_account_limit_insert_guard",
    "index:idx_projects_user_creation_key",
    "table:password_change_attempt_counters", "index:idx_password_change_attempts_updated",
    "trigger:users_auth_state_update_guard", "trigger:session_auth_state_immutable",
  ].map((entry) => {
    const separator = entry.indexOf(":");
    return { type: entry.slice(0, separator), name: entry.slice(separator + 1) };
  });
  const columns = [
    "users:id", "users:email", "users:password_hash", "users:password_salt", "users:password_iterations", "users:password_algorithm",
    "users:auth_generation", "users:auth_revision_id", "users:password_changed_at",
    "sessions:id", "sessions:user_id", "sessions:token_hash", "sessions:csrf_hash", "sessions:auth_generation", "sessions:auth_revision_id",
    "password_change_attempt_counters:user_id", "password_change_attempt_counters:window_start",
    "password_change_attempt_counters:request_count", "password_change_attempt_counters:limit_count",
    "password_change_attempt_counters:updated_at",
    "projects:id", "projects:user_id", "projects:status", "projects:input_json", "projects:input_revision", "projects:input_hash", "projects:brief_check_json",
    "projects:creation_key_hash", "projects:creation_request_hash",
    "orders:id", "orders:project_id", "orders:plan", "orders:status", "orders:product_code", "orders:request_hash",
    "project_revisions:project_id", "project_revisions:revision", "project_revisions:content_hash", "project_revisions:input_json", "project_revisions:brief_check_json",
    "report_feedback:project_id", "report_feedback:project_revision", "report_feedback:report_schema_version", "report_feedback:user_id",
    "report_feedback:outcome", "report_feedback:sections_json", "report_feedback:created_at", "report_feedback:updated_at",
  ].map((entry) => {
    const separator = entry.indexOf(":");
    return { table_name: entry.slice(0, separator), name: entry.slice(separator + 1) };
  });
  const post = verifyPostMigrationEvidence({
    environment: "staging",
    pre,
    foreignKeysPayload: d1([]),
    schemaPayload: d1(schemaNames),
    columnsPayload: d1(columns),
    countsPayload: d1(countsRows),
    usersPayload: d1(users.map((user) => ({ ...user, auth_generation: 1, auth_revision_id: null, password_changed_at: null }))),
    sessionsPayload: d1(sessions.map((session) => ({ ...session, auth_generation: 1, auth_revision_id: null }))),
    projectsPayload: d1(projects.map((project) => ({
      ...project,
      creation_key_hash: null,
      creation_request_hash: null,
    }))),
    reportsPayload: d1(reports),
    feedbackCountPayload: d1([{ row_count: 0 }]),
    feedbackMigrationPending: true,
  });
  assert.equal(post.coreDataUnchanged, true);
  assert.equal(post.credentialsAndSessionsUnchanged, true);
  assert.equal(post.reportFeedbackRows, 0);
  const residue = verifyCanaryResidueEvidence({
    environment: "staging",
    canaryProjectIds: ["11111111-1111-4111-8111-111111111111"],
    residuePayload: d1([{ projects: 0, project_revisions: 0, reports: 0, revision_reports: 0, feedback: 0 }]),
  });
  assert.equal(residue.canaryResidue, 0);
  assert.equal(residue.canaryProjectCount, 1);
  assert.match(residue.projectIdsSha256, /^[a-f0-9]{64}$/u);
  assert.match(
    buildCanaryResidueSql(["11111111-1111-4111-8111-111111111111"]),
    /FROM project_revision_reports WHERE project_id IN \('11111111-1111-4111-8111-111111111111'\)/u,
  );
  assert.match(
    buildCanaryResidueSql(["11111111-1111-4111-8111-111111111111"]),
    /FROM project_revisions WHERE project_id IN \('11111111-1111-4111-8111-111111111111'\)/u,
  );
  assert.throws(() => buildCanaryResidueSql(["not-a-project"]), /invalid canary project identifier/u);
  assert.throws(
    () => verifyCanaryResidueEvidence({
      environment: "staging",
      canaryProjectIds: ["11111111-1111-4111-8111-111111111111"],
      residuePayload: d1([{ projects: 0, project_revisions: 0, reports: 0, revision_reports: 0, feedback: 1 }]),
    }),
    /left feedback residue/u,
  );
  assert.throws(
    () => verifyCanaryResidueEvidence({
      environment: "staging",
      canaryProjectIds: [],
      residuePayload: d1([{ projects: 0, project_revisions: 0, reports: 0, revision_reports: 0, feedback: 0 }]),
    }),
    /at least one project identifier/u,
  );
  assert.throws(
    () => verifyPostMigrationEvidence({
      environment: "staging",
      pre,
      foreignKeysPayload: d1([]),
      schemaPayload: d1(schemaNames),
      columnsPayload: d1(columns),
      countsPayload: d1(countsRows),
      usersPayload: d1(users.map((user) => ({ ...user, auth_generation: 1, auth_revision_id: null, password_changed_at: null }))),
      sessionsPayload: d1(sessions.map((session) => ({ ...session, auth_generation: 1, auth_revision_id: null }))),
      projectsPayload: d1([{
        ...projects[0],
        status: "changed",
        creation_key_hash: null,
        creation_request_hash: null,
      }]),
      reportsPayload: d1(reports),
      feedbackCountPayload: d1([{ row_count: 0 }]),
      feedbackMigrationPending: true,
    }),
    /canonical users, sessions, projects, or reports bytes/u,
  );

  assert.throws(
    () => verifyPostMigrationEvidence({
      environment: "staging",
      pre,
      foreignKeysPayload: d1([]),
      schemaPayload: d1(schemaNames),
      columnsPayload: d1(columns),
      countsPayload: d1(countsRows),
      usersPayload: d1(users.map((user) => ({ ...user, auth_generation: 2, auth_revision_id: "revision-2-value", password_changed_at: null }))),
      sessionsPayload: d1(sessions.map((session) => ({ ...session, auth_generation: 1, auth_revision_id: null }))),
      projectsPayload: d1(projects.map((project) => ({
        ...project,
        creation_key_hash: null,
        creation_request_hash: null,
      }))),
      reportsPayload: d1(reports),
      feedbackCountPayload: d1([{ row_count: 0 }]),
      feedbackMigrationPending: true,
    }),
    /canonical users, sessions, projects, or reports bytes/u,
  );
});

test("release scope cannot hide a runtime deletion inside a documentation rename", async () => {
  const repository = await mkdtemp(join(tmpdir(), "grihagrid-release-scope-"));
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: repository, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };

  try {
    git("init", "--quiet");
    git("config", "user.name", "Release Scope Test");
    git("config", "user.email", "release-scope@example.test");
    await mkdir(join(repository, "worker"));
    await writeFile(join(repository, "worker", "index.js"), "export default {};\n", "utf8");
    git("add", "worker/index.js");
    git("commit", "--quiet", "-m", "Add runtime");
    const base = git("rev-parse", "HEAD");

    await mkdir(join(repository, "docs"));
    await rename(join(repository, "worker", "index.js"), join(repository, "docs", "retired-runtime.md"));
    git("add", "--all");
    git("commit", "--quiet", "-m", "Move runtime into docs");
    const head = git("rev-parse", "HEAD");

    const files = changedFiles(base, head, repository);
    assert.deepEqual(files.sort(), ["docs/retired-runtime.md", "worker/index.js"]);
    assert.equal(classifyReleaseFiles(files).deploy, true);
  } finally {
    await rm(repository, { recursive: true, force: true });
  }
});

test("release monitor summary counts actual requests including bounded retries", () => {
  const sample = {
    checks: [
      { latencyMs: 10, attempts: 1 },
      { latencyMs: 30, attempts: 2 },
      { latencyMs: 20, attempts: 1 },
    ],
  };
  assert.deepEqual(
    summarizeSamples("https://example.test", "11111111-1111-4111-8111-111111111111", "start", "finish", [sample]),
    {
      origin: "https://example.test",
      releaseId: "11111111-1111-4111-8111-111111111111",
      startedAt: "start",
      finishedAt: "finish",
      samples: 1,
      successfulChecks: 3,
      requests: 4,
      latencyMs: { minimum: 10, maximum: 30, average: 20 },
    },
  );
});

test("release monitor distinguishes lost tail coverage from an application regression", async () => {
  await assert.rejects(
    () => monitorRelease(
      "https://worker.example.test",
      "11111111-1111-4111-8111-111111111111",
      { durationMs: 1, intervalMs: 1, watchPids: [99_999_999] },
    ),
    ReleaseTailCoverageError,
  );
});

test("authenticated smoke proves current and rollback-compatible Worker paths fail closed", async () => {
  const originalFetch = globalThis.fetch;
  const projectId = "11111111-1111-4111-8111-111111111111";
  const releaseId = "22222222-2222-4222-8222-222222222222";
  let marker = "";
  let deleted = false;
  let loggedOut = false;
  let legacyResponse = false;
  let createCalls = 0;
  const denied = [];
  const estimatorInput = { width: 30, length: 50, floors: "G+1", quality: "Signature", city: "Pune" };
  const estimatorEstimate = {
    plotSqft: 1500,
    builtUpSqft: 1830,
    lowInr: 3703920,
    highInr: 4428600,
    floors: "G+1",
    quality: "Signature",
    city: "Pune",
  };

  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input);
    const method = init.method || "GET";
    if (url.pathname === "/api/auth/login") {
      const headers = new Headers({ "content-type": "application/json" });
      headers.append("set-cookie", "__Host-grihagrid_session=session-value; Path=/; Secure; HttpOnly; SameSite=Lax");
      headers.append("set-cookie", "grihagrid_csrf=csrf-value; Path=/; Secure; SameSite=Strict");
      headers.append("set-cookie", "edge-routing=keep-me; Path=/; Secure; SameSite=Lax");
      return new Response(JSON.stringify({ csrfToken: "csrf-value" }), { headers });
    }
    if (url.pathname === "/api/readiness") {
      return Response.json({
        releaseId,
        checks: legacyResponse ? {} : { authSchema: "current" },
        capabilities: {
          paidCheckout: false,
          paidFulfillment: false,
          privateUploads: false,
          ...(legacyResponse ? {} : { reportFeedback: true, accountSecurity: true }),
        },
      });
    }
    if (url.pathname === "/api/auth/me") {
      if (loggedOut) {
        assert.equal(new Headers(init.headers).get("cookie"), "__Host-grihagrid_session=session-value");
      }
      return loggedOut
        ? Response.json({ code: "unauthenticated" }, { status: 401 })
        : Response.json({ user: { email: "release@example.test" } });
    }
    if (url.pathname === "/api/estimate" && method === "POST") {
      assert.deepEqual(JSON.parse(init.body), estimatorInput);
      return Response.json({ input: estimatorInput, estimate: estimatorEstimate, basis: { ruleVersion: 1 } });
    }
    if (url.pathname === "/api/projects" && method === "POST") {
      createCalls += 1;
      marker = JSON.parse(init.body).name;
      if (!legacyResponse) assert.match(new Headers(init.headers).get("idempotency-key") || "", /^release-canary-/u);
      return Response.json({ project: {
        id: projectId,
        inputRevision: 1,
        input: { ...estimatorInput, bedrooms: 3, bathrooms: 3, parking: true },
        estimate: estimatorEstimate,
        estimateRuleVersion: 1,
      } }, { status: !legacyResponse && createCalls > 1 ? 200 : 201 });
    }
    if (url.pathname === "/api/projects" && method === "GET") {
      return Response.json({ projects: deleted ? [] : [{ id: projectId, name: marker }] });
    }
    if (url.pathname === `/api/projects/${projectId}` && method === "GET") {
      return deleted
        ? Response.json({ code: "project_not_found" }, { status: 404 })
        : Response.json({ project: { id: projectId } });
    }
    if (url.pathname === `/api/projects/${projectId}/report`) {
      const response = {
        report: { id: "report-canary", projectId, status: "ready", version: 2 },
        cached: method !== "POST",
      };
      if (!legacyResponse) Object.assign(response, {
        project: { id: projectId, inputRevision: 1 },
        revision: { revision: 1, current: true, report: { available: true, schemaVersion: 2 } },
      });
      return Response.json(response, { status: method === "POST" ? 201 : 200 });
    }
    if (url.pathname === `/api/projects/${projectId}/revisions/1/reports/2/feedback`) {
      if (method === "GET") {
        return Response.json({ feedback: marker.endsWith(" saved") ? {
          projectRevision: 1,
          reportSchemaVersion: 2,
          outcome: "helpful",
          sections: ["brief_check", "next_actions"],
          createdAt: "2026-08-15T00:00:00.000Z",
          updatedAt: "2026-08-15T00:00:00.000Z",
        } : null });
      }
      marker = `${marker} saved`;
      return Response.json({ feedback: {
        projectRevision: 1,
        reportSchemaVersion: 2,
        outcome: "helpful",
        sections: ["brief_check", "next_actions"],
        createdAt: "2026-08-15T00:00:00.000Z",
        updatedAt: "2026-08-15T00:00:00.000Z",
      } });
    }
    if (url.pathname === `/api/projects/${projectId}/orders` && method === "POST") {
      assert.match(new Headers(init.headers).get("idempotency-key") || "", /^closed-/u);
      denied.push("checkout");
      return Response.json({ code: "payments_disabled" }, { status: 503 });
    }
    if (url.pathname === `/api/projects/${projectId}/files` && method === "POST") {
      assert.equal(new Headers(init.headers).get("content-type"), "application/pdf");
      denied.push("upload");
      return Response.json({ code: "storage_unavailable" }, { status: 503 });
    }
    if (url.pathname === `/api/projects/${projectId}` && method === "DELETE") {
      deleted = true;
      return new Response(null, { status: 204 });
    }
    if (url.pathname === "/api/auth/logout") {
      const headersSent = new Headers(init.headers);
      assert.equal(headersSent.get("origin"), "https://worker.example.test");
      assert.equal(headersSent.get("x-csrf-token"), "csrf-value");
      assert.match(headersSent.get("cookie") || "", /__Host-grihagrid_session=session-value/u);
      assert.match(headersSent.get("cookie") || "", /grihagrid_csrf=csrf-value/u);
      loggedOut = true;
      const headers = new Headers();
      headers.append("set-cookie", "__Host-grihagrid_session=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax");
      headers.append("set-cookie", "grihagrid_csrf=; Path=/; Max-Age=0; Secure; SameSite=Strict");
      return new Response(null, { status: 204, headers });
    }
    throw new Error(`unexpected request ${method} ${url.pathname}`);
  };

  try {
    const result = await runAuthenticatedSmoke(
      "https://worker.example.test",
      { email: "release@example.test", password: "a-secure-canary-password" },
      { expectedReleaseId: releaseId },
    );
    assert.deepEqual(denied, ["checkout", "upload"]);
    assert.equal(result.projectDeleted, true);
    assert.equal(result.sessionRevocationVerified, true);
    assert.equal(result.publicEstimateVerified, true);
    assert.equal(result.projectCreateReplayVerified, true);
    assert.deepEqual(result.canaryProjectIds, [projectId]);
    assert.equal(deleted, true);

    marker = "";
    deleted = false;
    loggedOut = false;
    legacyResponse = true;
    createCalls = 0;
    denied.length = 0;
    const rollbackResult = await runAuthenticatedSmoke(
      "https://worker.example.test",
      { email: "release@example.test", password: "a-secure-canary-password" },
      { expectedReleaseId: releaseId, legacyWorker: true },
    );
    assert.equal(rollbackResult.legacyWorker, true);
    assert.deepEqual(rollbackResult.canaryProjectIds, [projectId]);
    assert.deepEqual(denied, ["checkout", "upload"]);
    assert.equal(rollbackResult.projectDeleted, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("authenticated smoke deletes only its exact marker after an ambiguous create timeout", async () => {
  const originalFetch = globalThis.fetch;
  let marker = "";
  let deletedId = "";
  let logoutCalled = false;
  let loggedOut = false;
  const projectId = "11111111-1111-4111-8111-111111111111";
  const estimatorInput = { width: 30, length: 50, floors: "G+1", quality: "Signature", city: "Pune" };
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input);
    if (url.pathname === "/api/auth/login") {
      const headers = new Headers({ "content-type": "application/json" });
      headers.append("set-cookie", "__Host-grihagrid_session=session-value; Path=/; Secure; HttpOnly; SameSite=Lax");
      headers.append("set-cookie", "grihagrid_csrf=csrf-value; Path=/; Secure; SameSite=Strict");
      headers.append("set-cookie", "edge-routing=keep-me; Path=/; Secure; SameSite=Lax");
      return new Response(JSON.stringify({ csrfToken: "csrf-value" }), { headers });
    }
    if (url.pathname === "/api/readiness") {
      return Response.json({
        releaseId: "22222222-2222-4222-8222-222222222222",
        checks: { authSchema: "current" },
        capabilities: { paidCheckout: false, paidFulfillment: false, privateUploads: false, reportFeedback: true, accountSecurity: true },
      });
    }
    if (url.pathname === "/api/auth/me") {
      if (loggedOut) {
        assert.equal(new Headers(init.headers).get("cookie"), "__Host-grihagrid_session=session-value");
      }
      return loggedOut
        ? Response.json({ code: "unauthenticated" }, { status: 401 })
        : Response.json({ user: { email: "release@example.test" } });
    }
    if (url.pathname === "/api/estimate" && init.method === "POST") {
      return Response.json({
        input: estimatorInput,
        estimate: { plotSqft: 1500, builtUpSqft: 1830, lowInr: 3703920, highInr: 4428600, floors: "G+1", quality: "Signature", city: "Pune" },
        basis: { ruleVersion: 1 },
      });
    }
    if (url.pathname === "/api/projects" && init.method === "POST") {
      marker = JSON.parse(init.body).name;
      throw new DOMException("ambiguous timeout", "TimeoutError");
    }
    if (url.pathname === "/api/projects" && (!init.method || init.method === "GET")) {
      assert.equal(url.searchParams.get("offset"), "0");
      return Response.json({ projects: [
        { id: "33333333-3333-4333-8333-333333333333", name: "Customer project" },
        { id: projectId, name: marker },
      ] });
    }
    if (url.pathname === `/api/projects/${projectId}` && init.method === "DELETE") {
      deletedId = projectId;
      return new Response(null, { status: 204 });
    }
    if (url.pathname === `/api/projects/${projectId}` && (!init.method || init.method === "GET")) {
      return Response.json({ code: "project_not_found" }, { status: 404 });
    }
    if (url.pathname === "/api/auth/logout") {
      const headersSent = new Headers(init.headers);
      assert.equal(headersSent.get("origin"), "https://worker.example.test");
      assert.equal(headersSent.get("x-csrf-token"), "csrf-value");
      logoutCalled = true;
      loggedOut = true;
      const headers = new Headers();
      headers.append("set-cookie", "__Host-grihagrid_session=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax");
      headers.append("set-cookie", "grihagrid_csrf=; Path=/; Max-Age=0; Secure; SameSite=Strict");
      return new Response(null, { status: 204, headers });
    }
    throw new Error(`unexpected request ${init.method || "GET"} ${url.pathname}`);
  };

  try {
    await assert.rejects(
      () => runAuthenticatedSmoke(
        "https://worker.example.test",
        { email: "release@example.test", password: "a-secure-canary-password" },
        { expectedReleaseId: "22222222-2222-4222-8222-222222222222" },
      ),
      /ambiguous timeout/u,
    );
    assert.match(marker, /^Release canary [0-9a-f-]{36}$/u);
    assert.equal(deletedId, projectId);
    assert.equal(logoutCalled, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
