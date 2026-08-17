import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { reportShareCapabilityToken, runAuthenticatedSmoke } from "../scripts/authenticated-smoke.mjs";
import {
  buildCanaryResidueSql,
  buildPreMigrationEvidence,
  verifyCanaryResidueEvidence,
  verifyReportHandoffControlEvidence,
  verifyReportHandoffCountsEvidence,
  verifyPostMigrationEvidence,
} from "../scripts/release-db-evidence.mjs";
import { monitorRelease, ReleaseTailCoverageError, summarizeSamples } from "../scripts/monitor-release.mjs";
import {
  assertReleaseStillCurrent,
  changedFiles,
  changedFilesInCommits,
  classifyReleaseFiles,
  isDocumentationOnly,
} from "../scripts/release-scope.mjs";
import { waitForRelease } from "../scripts/wait-for-release.mjs";

function workflowStep(source, name) {
  const marker = `      - name: ${name}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing workflow step: ${name}`);
  const next = source.indexOf("\n      - name:", start + marker.length);
  return next === -1 ? source.slice(start) : source.slice(start, next);
}

test("deployment authorization requires bounded exact-main CodeQL evidence", async () => {
  const workflow = await readFile(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8");
  assert.match(workflow, /security-events:\s*read/u);
  const exactSuccess = workflow.indexOf('process.stdout.write("success")');
  const analysesQuery = workflow.indexOf("code-scanning/analyses");
  const alertsQuery = workflow.indexOf("code-scanning/alerts");
  assert.ok(exactSuccess >= 0 && analysesQuery > exactSuccess && alertsQuery > analysesQuery);
  assert.match(workflow, /analysis\.commit_sha === process\.env\.CODEQL_RELEASE_SHA/u);
  assert.match(workflow, /analysis\.ref === "refs\/heads\/main"/u);
  assert.match(workflow, /language:javascript-typescript/u);
  assert.match(workflow, /-f state=open -f ref=refs\/heads\/main -f tool_name=CodeQL/u);
  assert.match(workflow, /assert\.equal\(alerts\.length, 0/u);
  assert.match(workflow, /assert\.equal\(resultsCount, 0/u);
  assert.match(workflow, /openAlertCount: 0/u);
  assert.match(workflow, /path: release-evidence\/authorization\/codeql-gate\.json/u);
  assert.doesNotMatch(workflow, /path:\s*\$RUNNER_TEMP\/codeql-(?:analyses|open-alerts)\.json/u);
});

test("the current workflow blocks newer runtime work before remote inspection, mutation, or activation", async () => {
  const workflow = await readFile(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8");
  const runbook = await readFile(new URL("../docs/operations-runbook.md", import.meta.url), "utf8");
  const authorization = workflowStep(workflow, "Require a squash-merged PR and exact trusted workflow results");
  assert.match(authorization, /current_main_sha="\$\(git rev-parse origin\/main\)"/u);
  assert.match(authorization, /release-scope\.mjs assert-current "\$RELEASE_SHA" "\$current_main_sha"/u);
  const ancestry = authorization.indexOf('git merge-base --is-ancestor "$RELEASE_SHA" origin/main');
  const exactCodeql = authorization.indexOf("CODEQL_RELEASE_SHA=\"$RELEASE_SHA\"");
  const candidateNode = authorization.indexOf('node scripts/release-scope.mjs assert-current "$RELEASE_SHA" "$current_main_sha"');
  assert.ok(
    ancestry >= 0 && exactCodeql > ancestry && candidateNode > exactCodeql,
    "candidate code must run only after ancestry and exact trusted evidence",
  );
  assert.match(runbook, /Never rerun a historical `Deploy merged main` run/u);
  assert.match(runbook, /current `main` SHA/u);

  for (const environment of ["staging", "production"]) {
    const inspectionName = environment === "staging"
      ? "Reconfirm current main before staging inspection"
      : "Reconfirm current main after the production hold";
    const databaseFenceName = `Reconfirm current main before ${environment} database mutation`;
    const activationFenceName = `Reconfirm current main before ${environment} Worker activation`;
    const orderedNames = [
      inspectionName,
      `Record current ${environment} Worker`,
      databaseFenceName,
      `Apply and verify ${environment} migrations`,
      activationFenceName,
      `Deploy authorized SHA to ${environment}`,
    ];
    const positions = orderedNames.map((name) => workflow.indexOf(`      - name: ${name}`));
    assert.ok(
      positions.every((position, index) => position >= 0 && (index === 0 || position > positions[index - 1])),
      `${environment} current-main fences must precede every remote mutation`,
    );
    if (environment === "production") {
      assert.ok(
        workflow.indexOf("      - name: Reconfirm the exact staging version after the production hold")
          < workflow.indexOf(`      - name: ${inspectionName}`),
        "production currentness must be refreshed after the sustained staging reconfirmation",
      );
    }

    for (const stepName of [inspectionName, databaseFenceName, activationFenceName]) {
      const step = workflowStep(workflow, stepName);
      assert.match(step, /git fetch --no-tags origin \+refs\/heads\/main:refs\/remotes\/origin\/main/u);
      assert.match(step, /current_main_sha="\$\(git rev-parse origin\/main\)"/u);
      assert.match(step, /release-scope\.mjs assert-current "\$RELEASE_SHA" "\$current_main_sha"/u);
    }
    assert.match(workflowStep(workflow, databaseFenceName), /id: current_main_db/u);
    const failClosed = workflowStep(workflow, `Fail closed ${environment} report handoff before regression handling`);
    assert.match(failClosed, /steps\.current_main_db\.outcome == 'success'/u);
  }
});

test("no-migration releases stop on unexpected remote migration drift before mutation", async () => {
  const workflow = await readFile(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8");
  for (const environment of ["staging", "production"]) {
    const names = [
      `Inspect pending ${environment} migrations and aggregate data state`,
      `Reject unexpected ${environment} migration drift`,
      `Create protected ${environment} export and recovery point`,
      `Apply and verify ${environment} migrations`,
      `Deploy authorized SHA to ${environment}`,
    ];
    const positions = names.map((name) => workflow.indexOf(`      - name: ${name}`));
    assert.ok(
      positions.every((position, index) => position >= 0 && (index === 0 || position > positions[index - 1])),
      `${environment} drift guard must precede every release mutation`,
    );
    const guard = workflowStep(workflow, names[1]);
    assert.match(guard, /id: migration_drift_guard/u);
    assert.match(guard, /AUTHORIZED_MIGRATIONS: \$\{\{ needs\.authorize\.outputs\.migrations \}\}/u);
    assert.match(guard, /REMOTE_PENDING_MIGRATIONS: \$\{\{ steps\.migrations\.outputs\.pending \}\}/u);
    assert.match(guard, /\[\[ "\$AUTHORIZED_MIGRATIONS" == "false" && "\$REMOTE_PENDING_MIGRATIONS" == "true" \]\]/u);
    assert.doesNotMatch(guard, /continue-on-error/u);
    assert.match(guard, /exit 1/u);
    const failClosed = workflowStep(workflow, `Fail closed ${environment} report handoff before regression handling`);
    assert.match(failClosed, /steps\.migration_drift_guard\.outcome == 'success'/u);

    const mayMutateHandoff = ({ migrations, driftGuard, currentMainDb, version }) =>
      migrations === "success"
      && driftGuard === "success"
      && currentMainDb === "success"
      && version !== "success";
    assert.equal(
      mayMutateHandoff({ migrations: "success", driftGuard: "failure", currentMainDb: "skipped", version: "skipped" }),
      false,
      `${environment} drift rejection must not reach the later always() control mutation`,
    );
    assert.equal(
      mayMutateHandoff({ migrations: "success", driftGuard: "success", currentMainDb: "failure", version: "skipped" }),
      false,
      `${environment} stale pre-database guard must not reach the later always() control mutation`,
    );
  }
});

test("exact-version latency gates block canaries and enter every rollback path", async () => {
  const workflow = await readFile(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8");
  assert.equal((workflow.match(/^\s*id: readiness_latency$/gmu) || []).length, 2);
  assert.equal((workflow.match(/steps\.readiness_latency\.outcome/gu) || []).length, 8);
  for (const environment of ["staging", "production"]) {
    const latency = workflowStep(workflow, `Gate ${environment} readiness latency on the exact version`);
    assert.match(latency, /if: steps\.propagation\.outcome == 'success'/u);
    assert.match(latency, /continue-on-error:\s*true/u);
    assert.match(latency, /GRIHAGRID_RELEASE_ID:\s*\$\{\{ steps\.version\.outputs\.version_id \}\}/u);
    assert.match(latency, /GRIHAGRID_RELEASE_SHA:\s*\$\{\{ env\.RELEASE_SHA \}\}/u);
    assert.match(latency, /EXPECT_REPORT_HANDOFF:\s*"false"/u);
    assert.match(
      latency,
      new RegExp(`EXPECT_AI_PLANNING_BRIEF:\\s*"${environment === "production" ? "true" : "false"}"`, "u"),
    );
    assert.match(latency, new RegExp(`release-evidence/${environment}/readiness-latency\\.json`, "u"));
    assert.doesNotMatch(latency, /secrets\./u);

    const canary = workflowStep(workflow, `Run ${environment} authenticated canary under bounded handoff activation`);
    assert.match(canary, /steps\.propagation\.outcome == 'success' && steps\.readiness_latency\.outcome == 'success'/u);
    const failClosed = workflowStep(workflow, `Fail closed ${environment} report handoff before regression handling`);
    assert.match(failClosed, /steps\.readiness_latency\.outcome != 'success'/u);
    const rollback = workflowStep(workflow, `Roll back a confirmed compatible ${environment} regression`);
    assert.match(rollback, /steps\.readiness_latency\.outcome == 'failure'/u);
    const finalFailure = workflowStep(
      workflow,
      environment === "staging"
        ? "Fail closed after a staging release regression"
        : "Fail closed after a production release or monitoring failure",
    );
    assert.match(finalFailure, /steps\.readiness_latency\.outcome == 'failure'/u);
  }
});

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
  assert.equal(pre.canonical.users.algorithm, "PBKDF2-SHA256");
  assert.equal(pre.canonical.users.iterations, 100_000);
  assert.match(pre.canonical.users.saltBase64Url, /^[A-Za-z0-9_-]{22}$/u);
  assert.match(pre.canonical.users.digest, /^[a-f0-9]{64}$/u);
  assert.equal(JSON.stringify(pre).includes("password-hash"), false);
  assert.equal(JSON.stringify(pre).includes("password-salt"), false);
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
    "table:report_shares", "table:report_share_read_counters", "table:report_share_create_counters", "table:report_handoff_controls",
    "index:idx_report_shares_owner_created", "index:idx_report_shares_expiry", "index:idx_report_shares_revoked",
    "index:idx_report_share_read_counters_updated", "index:idx_report_share_create_counters_updated",
    "trigger:report_share_sections_insert_guard", "trigger:report_share_identity_immutable",
    "trigger:archived_report_share_insert_guard", "trigger:report_share_active_limit_insert",
    "trigger:report_handoff_enabled_insert_guard",
    "table:login_attempt_fences", "index:idx_login_attempt_fences_expires",
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
    "login_attempt_fences:user_id", "login_attempt_fences:window_started_at", "login_attempt_fences:expires_at",
    "login_attempt_fences:request_count", "login_attempt_fences:limit_count", "login_attempt_fences:updated_at",
    "projects:id", "projects:user_id", "projects:status", "projects:input_json", "projects:input_revision", "projects:input_hash", "projects:brief_check_json",
    "projects:creation_key_hash", "projects:creation_request_hash",
    "orders:id", "orders:project_id", "orders:plan", "orders:status", "orders:product_code", "orders:request_hash",
    "project_revisions:project_id", "project_revisions:revision", "project_revisions:content_hash", "project_revisions:input_json", "project_revisions:brief_check_json",
    "report_feedback:project_id", "report_feedback:project_revision", "report_feedback:report_schema_version", "report_feedback:user_id",
    "report_feedback:outcome", "report_feedback:sections_json", "report_feedback:created_at", "report_feedback:updated_at",
    "report_shares:id", "report_shares:project_id", "report_shares:user_id", "report_shares:project_revision",
    "report_shares:report_schema_version", "report_shares:sections_json", "report_shares:report_content_hash",
    "report_shares:token_hash", "report_shares:idempotency_key_hash", "report_shares:request_hash",
    "report_shares:expires_at", "report_shares:revoked_at", "report_shares:access_count",
    "report_shares:last_accessed_at", "report_shares:created_at",
    "report_share_read_counters:subject_hash", "report_share_read_counters:window_start",
    "report_share_read_counters:request_count", "report_share_read_counters:limit_count",
    "report_share_read_counters:updated_at",
    "report_share_create_counters:user_id", "report_share_create_counters:window_start",
    "report_share_create_counters:request_count", "report_share_create_counters:limit_count",
    "report_share_create_counters:updated_at",
    "report_handoff_controls:control_key", "report_handoff_controls:enabled", "report_handoff_controls:updated_at",
  ].map((entry) => {
    const separator = entry.indexOf(":");
    return { table_name: entry.slice(0, separator), name: entry.slice(separator + 1) };
  });
  const postInput = {
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
    reportShareCountPayload: d1([{ row_count: 0 }]),
    reportShareReadCounterCountPayload: d1([{ row_count: 0 }]),
    reportShareCreateCounterCountPayload: d1([{ row_count: 0 }]),
    loginAttemptFenceCountPayload: d1([{ row_count: 0 }]),
    reportHandoffControlPayload: d1([{ control_key: "report_handoff", enabled: 0 }]),
    feedbackMigrationPending: true,
    reportShareMigrationPending: true,
    loginAttemptFenceMigrationPending: true,
  };
  const post = verifyPostMigrationEvidence(postInput);
  assert.equal(post.coreDataUnchanged, true);
  assert.equal(post.credentialsAndSessionsUnchanged, true);
  assert.equal(post.reportFeedbackRows, 0);
  assert.equal(post.reportShareRows, 0);
  assert.equal(post.reportShareReadCounterRows, 0);
  assert.equal(post.reportShareCreateCounterRows, 0);
  assert.equal(post.loginAttemptFenceRows, 0);
  assert.equal(post.loginAttemptFenceMigrationPending, true);
  assert.ok(post.requiredSchemaObjects.includes("table:login_attempt_fences"));
  assert.ok(post.requiredSchemaObjects.includes("index:idx_login_attempt_fences_expires"));
  assert.ok(post.requiredColumns.includes("login_attempt_fences:expires_at"));
  assert.equal(post.reportHandoffControlRows, 1);
  assert.equal(post.reportHandoffControlEnabled, false);
  const residue = verifyCanaryResidueEvidence({
    environment: "staging",
    canaryProjectIds: ["11111111-1111-4111-8111-111111111111"],
    residuePayload: d1([{ projects: 0, project_revisions: 0, reports: 0, revision_reports: 0, feedback: 0, report_shares: 0 }]),
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
  assert.match(
    buildCanaryResidueSql(["11111111-1111-4111-8111-111111111111"]),
    /FROM report_shares WHERE project_id IN \('11111111-1111-4111-8111-111111111111'\)/u,
  );
  assert.throws(() => buildCanaryResidueSql(["not-a-project"]), /invalid canary project identifier/u);
  assert.throws(
    () => verifyCanaryResidueEvidence({
      environment: "staging",
      canaryProjectIds: ["11111111-1111-4111-8111-111111111111"],
      residuePayload: d1([{ projects: 0, project_revisions: 0, reports: 0, revision_reports: 0, feedback: 1, report_shares: 0 }]),
    }),
    /left feedback residue/u,
  );
  assert.throws(
    () => verifyCanaryResidueEvidence({
      environment: "staging",
      canaryProjectIds: ["11111111-1111-4111-8111-111111111111"],
      residuePayload: d1([{ projects: 0, project_revisions: 0, reports: 0, revision_reports: 0, feedback: 0, report_shares: 1 }]),
    }),
    /left report_shares residue/u,
  );
  assert.throws(
    () => verifyCanaryResidueEvidence({
      environment: "staging",
      canaryProjectIds: [],
      residuePayload: d1([{ projects: 0, project_revisions: 0, reports: 0, revision_reports: 0, feedback: 0, report_shares: 0 }]),
    }),
    /at least one project identifier/u,
  );
  assert.throws(
    () => verifyPostMigrationEvidence({
      ...postInput,
      projectsPayload: d1([{
        ...projects[0],
        status: "changed",
        creation_key_hash: null,
        creation_request_hash: null,
      }]),
    }),
    /canonical users, sessions, projects, or reports bytes/u,
  );

  assert.throws(
    () => verifyPostMigrationEvidence({
      ...postInput,
      usersPayload: d1(users.map((user) => ({ ...user, auth_generation: 2, auth_revision_id: "revision-2-value", password_changed_at: null }))),
    }),
    /canonical users, sessions, projects, or reports bytes/u,
  );

  assert.throws(
    () => verifyPostMigrationEvidence({
      ...postInput,
      reportShareReadCounterCountPayload: d1([{ row_count: 1 }]),
    }),
    /new report_share_read_counters table must start empty/u,
  );
  assert.throws(
    () => verifyPostMigrationEvidence({
      ...postInput,
      reportShareCreateCounterCountPayload: d1([{ row_count: 1 }]),
    }),
    /new report_share_create_counters table must start empty/u,
  );
  assert.throws(
    () => verifyPostMigrationEvidence({
      ...postInput,
      loginAttemptFenceCountPayload: d1([{ row_count: 1 }]),
    }),
    /new login_attempt_fences table must start empty/u,
  );
  const laterReleasePost = verifyPostMigrationEvidence({
    ...postInput,
    loginAttemptFenceCountPayload: d1([{ row_count: 3 }]),
    loginAttemptFenceMigrationPending: false,
  });
  assert.equal(laterReleasePost.loginAttemptFenceRows, 3);
  assert.equal(laterReleasePost.loginAttemptFenceMigrationPending, false);
  assert.throws(
    () => verifyPostMigrationEvidence({
      ...postInput,
      schemaPayload: d1(schemaNames.filter(({ name }) => name !== "idx_login_attempt_fences_expires")),
    }),
    /required schema object is missing: index:idx_login_attempt_fences_expires/u,
  );
  assert.throws(
    () => verifyPostMigrationEvidence({
      ...postInput,
      columnsPayload: d1(columns.filter(({ table_name, name }) => (
        table_name !== "login_attempt_fences" || name !== "expires_at"
      ))),
    }),
    /required schema column is missing: login_attempt_fences:expires_at/u,
  );
  assert.throws(
    () => verifyPostMigrationEvidence({
      ...postInput,
      reportHandoffControlPayload: d1([{ control_key: "report_handoff", enabled: 1 }]),
    }),
    /report handoff control is not in the expected state/u,
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

test("a documentation-only tip cannot strand its queued runtime ancestor", async () => {
  const repository = await mkdtemp(join(tmpdir(), "grihagrid-release-current-"));
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: repository, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };

  try {
    git("init", "--quiet");
    git("config", "user.name", "Release Currentness Test");
    git("config", "user.email", "release-current@example.test");
    await mkdir(join(repository, "worker"));
    await writeFile(join(repository, "worker", "index.js"), "export default { version: 1 };\n", "utf8");
    git("add", "worker/index.js");
    git("commit", "--quiet", "-m", "Runtime release A");
    const runtimeRelease = git("rev-parse", "HEAD");

    await mkdir(join(repository, "docs"));
    await writeFile(join(repository, "docs", "release.md"), "Release notes only.\n", "utf8");
    git("add", "docs/release.md");
    git("commit", "--quiet", "-m", "Documentation B");
    const documentationTip = git("rev-parse", "HEAD");

    assert.equal(classifyReleaseFiles(changedFiles(runtimeRelease, documentationTip, repository)).deploy, false);
    assert.deepEqual(assertReleaseStillCurrent(runtimeRelease, documentationTip, repository).trailingFiles, ["docs/release.md"]);

    await rm(join(repository, "docs", "release.md"));
    git("add", "--all");
    git("commit", "--quiet", "-m", "Revert documentation B");
    const documentationRevertedTip = git("rev-parse", "HEAD");
    assert.deepEqual(changedFiles(runtimeRelease, documentationRevertedTip, repository), []);
    assert.deepEqual(changedFilesInCommits(runtimeRelease, documentationRevertedTip, repository), ["docs/release.md"]);
    assert.deepEqual(
      assertReleaseStillCurrent(runtimeRelease, documentationRevertedTip, repository).trailingFiles,
      ["docs/release.md"],
    );

    await writeFile(join(repository, "worker", "index.js"), "export default { version: 2 };\n", "utf8");
    git("add", "worker/index.js");
    git("commit", "--quiet", "-m", "Runtime release C");
    const newerRuntimeTip = git("rev-parse", "HEAD");
    assert.throws(
      () => assertReleaseStillCurrent(runtimeRelease, newerRuntimeTip, repository),
      /newer deployable changes/u,
    );

    await writeFile(join(repository, "worker", "index.js"), "export default { version: 1 };\n", "utf8");
    git("add", "worker/index.js");
    git("commit", "--quiet", "-m", "Revert runtime release C");
    const newerRuntimeRevertedTip = git("rev-parse", "HEAD");
    assert.deepEqual(changedFiles(runtimeRelease, newerRuntimeRevertedTip, repository), []);
    assert.throws(
      () => assertReleaseStillCurrent(runtimeRelease, newerRuntimeRevertedTip, repository),
      /newer deployable changes/u,
    );
  } finally {
    await rm(repository, { recursive: true, force: true });
  }
});

test("merge-resolution-only runtime changes block an older release", async () => {
  const repository = await mkdtemp(join(tmpdir(), "grihagrid-release-merge-"));
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: repository, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };

  try {
    git("init", "--quiet");
    git("config", "user.name", "Release Merge Test");
    git("config", "user.email", "release-merge@example.test");
    await mkdir(join(repository, "worker"));
    await writeFile(join(repository, "worker", "index.js"), "export default { version: 1 };\n", "utf8");
    git("add", "worker/index.js");
    git("commit", "--quiet", "-m", "Runtime release A");
    const runtimeRelease = git("rev-parse", "HEAD");
    const trunk = git("branch", "--show-current");

    git("checkout", "--quiet", "-b", "documentation-topic");
    await mkdir(join(repository, "docs"));
    await writeFile(join(repository, "docs", "topic.md"), "Topic documentation.\n", "utf8");
    git("add", "docs/topic.md");
    git("commit", "--quiet", "-m", "Topic documentation");

    git("checkout", "--quiet", trunk);
    await writeFile(join(repository, "README.md"), "Trunk documentation.\n", "utf8");
    git("add", "README.md");
    git("commit", "--quiet", "-m", "Trunk documentation");
    git("merge", "--quiet", "--no-ff", "--no-commit", "documentation-topic");
    await writeFile(join(repository, "worker", "index.js"), "export default { version: 2 };\n", "utf8");
    git("add", "worker/index.js");
    git("commit", "--quiet", "-m", "Merge documentation with runtime resolution");
    const mergeTip = git("rev-parse", "HEAD");

    assert.ok(changedFilesInCommits(runtimeRelease, mergeTip, repository).includes("worker/index.js"));
    assert.throws(
      () => assertReleaseStillCurrent(runtimeRelease, mergeTip, repository),
      /newer deployable changes/u,
    );
  } finally {
    await rm(repository, { recursive: true, force: true });
  }
});

test("report handoff release evidence is bounded and requires one enabled control", () => {
  const d1 = (results) => [{ success: true, results }];
  const disabled = verifyReportHandoffControlEvidence({
    environment: "staging",
    controlPayload: d1([{ control_key: "report_handoff", enabled: 0 }]),
    expectedEnabled: false,
  });
  assert.deepEqual({
    controlKey: disabled.controlKey,
    controlRows: disabled.controlRows,
    enabled: disabled.enabled,
  }, {
    controlKey: "report_handoff",
    controlRows: 1,
    enabled: false,
  });
  assert.throws(
    () => verifyReportHandoffControlEvidence({
      environment: "production",
      controlPayload: d1([
        { control_key: "report_handoff", enabled: 1 },
        { control_key: "unexpected", enabled: 1 },
      ]),
      expectedEnabled: true,
    }),
    /exactly one row/u,
  );

  const counts = verifyReportHandoffCountsEvidence({
    environment: "production",
    countsPayload: d1([{
      report_shares: 12,
      report_share_read_counters: 3,
      report_share_create_counters: 2,
      report_handoff_controls: 1,
      enabled_report_handoff_controls: 1,
    }]),
  });
  assert.deepEqual(counts.counts, {
    report_shares: 12,
    report_share_read_counters: 3,
    report_share_create_counters: 2,
    report_handoff_controls: 1,
    enabled_report_handoff_controls: 1,
  });
  assert.equal(counts.controlEnabled, true);
  assert.throws(
    () => verifyReportHandoffCountsEvidence({
      environment: "production",
      countsPayload: d1([{
        report_shares: 12,
        report_share_read_counters: 3,
        report_share_create_counters: 2,
        report_handoff_controls: 1,
        enabled_report_handoff_controls: 0,
      }]),
    }),
    /must be enabled after release checks/u,
  );
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

test("release rollback polling propagates legacy Worker compatibility to every smoke sample", async () => {
  const seen = [];
  let clock = 0;
  const result = await waitForRelease(
    "https://worker.example.test",
    "11111111-1111-4111-8111-111111111111",
    {
      timeoutMs: 1_000,
      intervalMs: 1,
      stabilityMs: 2,
      legacyWorker: true,
      monotonicNow: () => clock,
      sleep: async (delayMs) => { clock += delayMs; },
      smoke: async (origin, options) => {
        seen.push({ origin, ...options });
        return { checks: [] };
      },
    },
  );
  assert.equal(result.legacyWorker, true);
  assert.equal(result.consecutiveSamples, 3);
  assert.equal(seen.length, 3);
  assert.ok(seen.every((sample) => sample.legacyWorker === true));
  assert.ok(seen.every((sample) => sample.expectReportHandoff === true));
  assert.ok(seen.every((sample) => sample.expectedReleaseId === result.releaseId));
  assert.equal(new Set(seen.map((sample) => sample.releaseProbe)).size, seen.length);
});

test("release propagation can require the exact Worker while report handoff remains closed", async () => {
  const seen = [];
  let clock = 0;
  const result = await waitForRelease(
    "https://worker.example.test",
    "11111111-1111-4111-8111-111111111111",
    {
      timeoutMs: 1_000,
      intervalMs: 1,
      stabilityMs: 2,
      expectReportHandoff: false,
      monotonicNow: () => clock,
      sleep: async (delayMs) => { clock += delayMs; },
      smoke: async (_origin, options) => {
        seen.push(options);
        return { checks: [] };
      },
    },
  );
  assert.equal(result.expectReportHandoff, false);
  assert.equal(result.consecutiveSamples, 3);
  assert.ok(seen.every((sample) => sample.expectReportHandoff === false));
});

test("report handoff capability parsing never includes a bearer in assertion errors", () => {
  const bearer="q".repeat(43);
  assert.equal(
    reportShareCapabilityToken(`https://worker.example.test/share/report#${bearer}`,"https://worker.example.test"),
    bearer,
  );
  for(const unsafe of [
    `not a URL ${bearer}`,
    `https://evil.example/share/report#${bearer}`,
    `https://worker.example.test/share/report/${bearer}`,
    `https://worker.example.test/share/report?token=${bearer}`,
  ]){
    let error;
    try{reportShareCapabilityToken(unsafe,"https://worker.example.test")}catch(caught){error=caught}
    assert.ok(error instanceof Error);
    assert.equal(String(error.message).includes(bearer),false);
  }
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
  let reportShareActive = false;
  const denied = [];
  const reportShareId = "33333333-3333-4333-8333-333333333333";
  const reportShareToken = "report-share-canary-token-00000000000000000";
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
        checks: legacyResponse ? {} : {
          authSchema: "current",
          reportShareSchema: "current",
          reportHandoffControl: "enabled",
          reportShareAbuseHashing: "configured",
        },
        capabilities: {
          paidCheckout: false,
          paidFulfillment: false,
          privateUploads: false,
          ...(legacyResponse ? {} : { reportFeedback: true, accountSecurity: true, reportHandoff: true }),
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
    if (url.pathname === `/api/projects/${projectId}/report-shares` && method === "POST") {
      assert.match(new Headers(init.headers).get("idempotency-key") || "", /^release-report-share-/u);
      assert.deepEqual(JSON.parse(init.body), {
        projectRevision: 1,
        reportSchemaVersion: 2,
        expiresInDays: 1,
        sections: ["overview", "risks", "next_actions"],
      });
      reportShareActive = true;
      return Response.json({ share: {
        id: reportShareId,
        projectRevision: 1,
        reportSchemaVersion: 2,
        sections: ["overview", "risks", "next_actions"],
        expiresAt: "2026-08-17 00:00:00",
        revokedAt: null,
        active: true,
        accessCount: 0,
        createdAt: "2026-08-16 00:00:00",
        url: `https://worker.example.test/share/report#${reportShareToken}`,
      } }, { status: 201 });
    }
    if (url.pathname === "/api/shared/report" && method === "POST") {
      assert.deepEqual(JSON.parse(init.body), { token: reportShareToken });
      assert.equal(new Headers(init.headers).get("cookie"), null);
      assert.equal(new Headers(init.headers).get("x-csrf-token"), null);
      return reportShareActive
        ? Response.json({ share: {
          expiresAt: "2026-08-17 00:00:00",
          sections: {
            overview: { headline: "A bounded planning overview" },
            risks: ["Verify all site conditions locally."],
            nextActions: ["Commission measured-site validation."],
          },
        } })
        : Response.json({ code: "report_share_unavailable" }, { status: 410 });
    }
    if (url.pathname === `/api/projects/${projectId}/report-shares/${reportShareId}` && method === "DELETE") {
      reportShareActive = false;
      return new Response(null, { status: 204 });
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
    assert.equal(result.reportHandoffVerified, true);
    assert.deepEqual(result.canaryProjectIds, [projectId]);
    assert.equal(deleted, true);

    marker = "";
    deleted = false;
    loggedOut = false;
    legacyResponse = true;
    createCalls = 0;
    reportShareActive = false;
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
        checks: {
          authSchema: "current",
          reportShareSchema: "current",
          reportHandoffControl: "enabled",
          reportShareAbuseHashing: "configured",
        },
        capabilities: { paidCheckout: false, paidFulfillment: false, privateUploads: false, reportFeedback: true, accountSecurity: true, reportHandoff: true },
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
