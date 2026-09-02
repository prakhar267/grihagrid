import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

function isDirectExecution() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    process.stderr.write("operational configuration check failed during entrypoint resolution\n");
    process.exitCode = 1;
    return false;
  }
}

const files = Object.freeze({
  wrangler: new URL("../wrangler.toml", import.meta.url),
  package: new URL("../package.json", import.meta.url),
  gitignore: new URL("../.gitignore", import.meta.url),
  ci: new URL("../.github/workflows/ci.yml", import.meta.url),
  smokeWorkflow: new URL("../.github/workflows/production-smoke.yml", import.meta.url),
  deployWorkflow: new URL("../.github/workflows/deploy.yml", import.meta.url),
  releaseScope: new URL("./release-scope.mjs", import.meta.url),
  smoke: new URL("./smoke.mjs", import.meta.url),
  waitForRelease: new URL("./wait-for-release.mjs", import.meta.url),
  readinessLatency: new URL("./readiness-latency.mjs", import.meta.url),
  authenticatedSmoke: new URL("./authenticated-smoke.mjs", import.meta.url),
  canarySessionFence: new URL("./canary-session-fence.mjs", import.meta.url),
  runCanarySessionFence: new URL("./run-canary-session-fence.sh", import.meta.url),
  releaseDbEvidence: new URL("./release-db-evidence.mjs", import.meta.url),
  worker: new URL("../worker/index.js", import.meta.url),
});

function environmentBlock(source, name) {
  const environmentHeaders = [...source.matchAll(/^\[env\.([^.\]]+)\]$/gmu)];
  if (name === "production") {
    const boundary = environmentHeaders[0]?.index ?? -1;
    return boundary === -1 ? source : source.slice(0, boundary);
  }
  const marker = `[env.${name}]`;
  const headerIndex = environmentHeaders.findIndex((match) => match[1] === name);
  const start = environmentHeaders[headerIndex]?.index ?? -1;
  assert.notEqual(start, -1, `wrangler.toml must define ${marker}`);
  const next = environmentHeaders[headerIndex + 1]?.index ?? -1;
  return next === -1 ? source.slice(start) : source.slice(start, next);
}

function quotedVariable(source, name) {
  const match = source.match(new RegExp(`^${name}\\s*=\\s*"([^"]*)"`, "mu"));
  assert.ok(match, `${name} must be an explicit quoted Wrangler variable`);
  return match[1];
}

function workflowStep(source, name) {
  const marker = `      - name: ${name}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `deployment workflow must define step: ${name}`);
  const next = source.indexOf("\n      - name:", start + marker.length);
  return next === -1 ? source.slice(start) : source.slice(start, next);
}

export async function checkOpsConfig() {
  const [wrangler, packageText, gitignore, ci, smokeWorkflow, deployWorkflow, releaseScope, smoke, waitForRelease, readinessLatency, authenticatedSmoke, canarySessionFence, runCanarySessionFence, releaseDbEvidence, worker] = await Promise.all(
    Object.values(files).map((file) => readFile(file, "utf8")),
  );
  const packageJson = JSON.parse(packageText);
  const production = environmentBlock(wrangler, "production");
  const staging = environmentBlock(wrangler, "staging");

  for (const [name, block] of [["production", production], ["staging", staging]]) {
    assert.equal(
      quotedVariable(block, "PAID_CHECKOUT_ENABLED"),
      "false",
      `${name} checkout must be fail-closed in version control`,
    );
    assert.equal(
      quotedVariable(block, "DECISION_COMPARE_FULFILLMENT_ENABLED"),
      "false",
      `${name} fulfillment must be fail-closed in version control`,
    );
    assert.equal(
      quotedVariable(block, "ENABLED_PAYMENT_PLANS"),
      "",
      `${name} must not accept paid plans from version-controlled defaults`,
    );
    const origin = new URL(quotedVariable(block, "APP_ORIGIN"));
    assert.equal(origin.protocol, "https:", `${name} APP_ORIGIN must use HTTPS`);
    assert.equal(origin.pathname, "/", `${name} APP_ORIGIN must not include a path`);
    assert.equal(origin.search, "", `${name} APP_ORIGIN must not include a query`);
    assert.equal(origin.hash, "", `${name} APP_ORIGIN must not include a fragment`);
  }

  assert.notEqual(
    quotedVariable(production, "APP_ORIGIN"),
    quotedVariable(staging, "APP_ORIGIN"),
    "staging and production origins must differ",
  );
  assert.equal(quotedVariable(production, "name"), "grihagrid");
  assert.equal(quotedVariable(staging, "name"), "grihagrid-staging");
  assert.equal(quotedVariable(production, "main"), "dist/server/index.js");
  assert.equal(quotedVariable(production, "directory"), "dist/client");
  assert.doesNotMatch(staging, /^main\s*=/mu, "staging may not override the validated Worker entrypoint");
  assert.doesNotMatch(staging, /^directory\s*=/mu, "staging may not override the validated asset directory");
  assert.equal(quotedVariable(production, "database_name"), "grihagrid-db");
  assert.equal(quotedVariable(production, "database_id"), "42a75a83-ab24-4e3f-93f1-b80c51284f1e");
  assert.equal(quotedVariable(production, "migrations_dir"), "migrations");
  assert.match(staging, /database_name\s*=\s*"grihagrid-staging-db"/u);
  assert.match(staging, /database_id\s*=\s*"ac7ff387-c8c6-40d2-b9db-83078378c054"/u);
  assert.equal(quotedVariable(staging, "migrations_dir"), "migrations");
  assert.notEqual(
    quotedVariable(production, "database_id"),
    quotedVariable(staging, "database_id"),
    "staging and production D1 databases must differ",
  );
  assert.equal(quotedVariable(production, "id"), "c5044339222a4172ad7c91724b98d4fb");
  assert.equal(quotedVariable(staging, "id"), "f48c3f765bc84088a88376e887daf7b1");
  assert.notEqual(quotedVariable(production, "id"), quotedVariable(staging, "id"), "staging and production KV namespaces must differ");
  assert.match(staging, /\[\[env\.staging\.kv_namespaces\]\]/u);
  assert.doesNotMatch(production, /^\s*\[\[r2_buckets\]\]/mu, "production must not enable R2 automatically");
  assert.doesNotMatch(staging, /\[\[env\.staging\.r2_buckets\]\]/u);
  assert.match(staging, /\[env\.staging\.triggers\][\s\S]*crons\s*=\s*\[\]/u);
  assert.match(wrangler, /\[observability\][\s\S]*enabled\s*=\s*true/u);
  assert.match(
    production,
    /\[observability\.logs\][\s\S]*invocation_logs\s*=\s*false/u,
    "production must not emit raw-URL invocation logs containing share bearer tokens",
  );
  assert.match(
    staging,
    /\[env\.staging\.observability\.logs\][\s\S]*invocation_logs\s*=\s*false/u,
    "staging must not emit raw-URL invocation logs containing share bearer tokens",
  );
  assert.match(wrangler, /crons\s*=\s*\["17 2 \* \* \*"\]/u);

  for (const secret of ["GEMINI_API_KEY", "METRICS_READ_TOKEN", "RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"]) {
    assert.doesNotMatch(wrangler, new RegExp(`^${secret}\\s*=`, "mu"), `${secret} must not be committed to Wrangler config`);
  }
  assert.match(gitignore, /^\.dev\.vars$/mu, ".dev.vars must remain ignored");
  assert.equal(packageJson.scripts?.["check:ops"], "node scripts/check-ops-config.mjs");
  assert.equal(packageJson.scripts?.["smoke:auth"], "node scripts/authenticated-smoke.mjs");
  assert.equal(packageJson.scripts?.["monitor:release"], "node scripts/monitor-release.mjs");
  assert.match(
    packageJson.scripts?.["check:worker"] || "",
    /--env=(?:""|'')/u,
    "production Worker validation must explicitly target the top-level environment",
  );
  assert.match(ci, /npm run check:worker:staging/u, "CI must dry-run the isolated staging bundle");
  assert.match(ci, /npm run check:migrations/u, "CI must validate fresh D1 migrations");
  assert.match(ci, /Reject pull request edits to existing migrations/u, "required CI must enforce migration immutability before merge");
  assert.match(ci, /new migrations must follow the trusted 0012 baseline/u, "required CI must reject low-sequence migration policy bypasses");
  assert.match(ci, /npm audit --audit-level=high/u, "CI must fail on high-severity dependency findings");
  for (const [name, workflow] of [["CI", ci], ["public smoke", smokeWorkflow], ["deployment", deployWorkflow]]) {
    assert.match(
      workflow,
      /actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1/u,
      `${name} must pin the reviewed checkout v7.0.1 commit`,
    );
    assert.match(
      workflow,
      /actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020/u,
      `${name} must pin the reviewed setup-node v7.0.0 commit`,
    );
  }
  assert.match(smokeWorkflow, /cron:\s*"23 \* \* \* \*"/u, "public smoke must run hourly");
  assert.match(smokeWorkflow, /EXPECT_PAID_CHECKOUT:\s*"false"/u, "public smoke must expect checkout to remain closed");
  assert.doesNotMatch(smokeWorkflow, /permissions:\s*[\s\S]*?contents:\s*write/u, "read-only smoke may not request content writes");
  assert.match(deployWorkflow, /workflow_run:[\s\S]*workflows:\s*\["CI"\]/u, "deployment must follow completed CI");
  assert.match(deployWorkflow, /concurrency:[\s\S]*queue:\s*max/u, "deployment runs must queue instead of replacing pending releases");
  assert.match(deployWorkflow, /checks:\s*read/u, "deployment gate must read exact-SHA check results");
  assert.match(deployWorkflow, /security-events:\s*read/u, "deployment gate must read bounded code-scanning evidence");
  assert.match(deployWorkflow, /workflow_dispatch'\s*&&\s*github\.ref\s*==\s*'refs\/heads\/main'/u, "manual releases must use the main workflow ref");
  assert.match(deployWorkflow, /github\.event_name\s*==\s*'workflow_dispatch'\s*&&\s*github\.sha/u, "manual releases must derive executable code from the trusted workflow SHA");
  assert.doesNotMatch(deployWorkflow, /inputs\.release_sha/u, "manual releases must not select executable code through an input");
  assert.equal((deployWorkflow.match(/manual release SHA must equal the trusted workflow revision/gu) || []).length, 2, "authorization and validation must bind manual releases to their trusted control-plane revision");
  assert.equal((deployWorkflow.match(/release-scope\.mjs assert-current "\$RELEASE_SHA" "\$current_main_sha"/gu) || []).length, 8, "authorization, unprivileged materialization, and every privileged boundary must reject a candidate behind newer runtime work");
  const authorizationCheckout = workflowStep(deployWorkflow, "Check out trusted main control plane with full history");
  assert.doesNotMatch(authorizationCheckout, /^\s*ref:/mu, "authorization must let GitHub select the trusted event control-plane checkout");
  const validationCheckout = workflowStep(deployWorkflow, "Check out trusted main before authorized materialization");
  assert.doesNotMatch(validationCheckout, /^\s*ref:/mu, "unprivileged validation must let GitHub select the trusted event control-plane checkout");
  const validationSetupNode = workflowStep(deployWorkflow, "Set up Node.js without candidate caching");
  assert.doesNotMatch(validationSetupNode, /cache:\s*npm/u, "unprivileged candidate validation must not populate the default-branch npm cache");
  const materializationStep = workflowStep(deployWorkflow, "Materialize the authorized SHA from trusted main");
  const materializationCurrentness = materializationStep.indexOf('release-scope.mjs assert-current "$RELEASE_SHA" "$current_main_sha"');
  const materializationCheckout = materializationStep.indexOf('git checkout --detach "$RELEASE_SHA"');
  assert.ok(materializationCurrentness >= 0 && materializationCheckout > materializationCurrentness, "validation must prove currentness from trusted main before materializing candidate code");
  const authorizationStep = workflowStep(deployWorkflow, "Require a squash-merged PR and exact trusted workflow results");
  assert.match(authorizationStep, /"repos\/\$GITHUB_REPOSITORY\/commits\/\$RELEASE_SHA\/pulls"/u, "release provenance must first inspect exact commit associations");
  assert.match(authorizationStep, /if \[ "\$associated_pull_count" -eq 0 \]/u, "release provenance may fall back only for an empty association response");
  assert.match(authorizationStep, /gh_api_read "\$RUNNER_TEMP\/closed-main-pulls\.json"[\s\S]*?--paginate --slurp --method GET/u, "release provenance fallback must inspect every closed-main pull-request page through bounded retries");
  assert.match(authorizationStep, /"repos\/\$GITHUB_REPOSITORY\/pulls"/u, "release provenance fallback must use the stable pull-request listing API");
  assert.match(authorizationStep, /candidate\.merge_commit_sha === sha/u, "release provenance must bind the merged PR to the exact release SHA");
  assert.match(authorizationStep, /candidate\.base\?\.repo\?\.full_name === repository/u, "release provenance must bind the merged PR to this repository");
  assert.match(authorizationStep, /matches\.length !== 1/u, "release provenance must require one unambiguous merged PR");
  assert.doesNotMatch(authorizationStep, /gh api[^\n]*\|\|/u, "release provenance must not mask a primary API failure");
  const ancestryPosition = authorizationStep.indexOf('git merge-base --is-ancestor "$RELEASE_SHA" origin/main');
  const codeqlPosition = authorizationStep.indexOf("CODEQL_RELEASE_SHA=\"$RELEASE_SHA\"");
  const scopeInspectionPosition = authorizationStep.indexOf('node scripts/release-scope.mjs assert-current "$RELEASE_SHA" "$current_main_sha"');
  assert.ok(
    ancestryPosition >= 0 && codeqlPosition > ancestryPosition && scopeInspectionPosition > codeqlPosition,
    "authorization must prove ancestry and trusted exact-SHA evidence before scope inspection",
  );
  assert.match(authorizationStep, /env -u GH_TOKEN node scripts\/release-scope\.mjs assert-current/u, "authorization must remove the API token before scope inspection");
  assert.match(releaseScope, /merge-base", "--is-ancestor"/u, "release currentness must require main ancestry");
  assert.match(releaseScope, /git",[\s\S]*?"log"[\s\S]*?--first-parent[\s\S]*?--diff-merges=first-parent[\s\S]*?--name-only[\s\S]*?--no-renames/u, "release currentness must inspect every first-parent commit including merge-resolution changes");
  assert.match(releaseScope, /trailingScope\.deploy,[\s\S]*?false,[\s\S]*?newer deployable changes/u, "release currentness must allow trailing documentation but reject trailing runtime changes");
  assert.match(deployWorkflow, /fetch-depth:\s*0/u, "release ancestry must use complete history");
  assert.match(deployWorkflow, /dynamic\/github-code-scanning\/codeql/u, "release gate must verify the trusted CodeQL workflow identity");
  assert.match(deployWorkflow, /code-scanning\/analyses/u, "release gate must query exact-SHA CodeQL analysis results");
  assert.match(deployWorkflow, /analysis\.commit_sha === process\.env\.CODEQL_RELEASE_SHA/u, "release gate must bind CodeQL analysis evidence to the merged SHA");
  assert.match(deployWorkflow, /analysis\.ref === "refs\/heads\/main"/u, "release gate must bind CodeQL analysis evidence to main");
  assert.match(deployWorkflow, /language:javascript-typescript/u, "release gate must require JavaScript\/TypeScript CodeQL analysis");
  assert.doesNotMatch(deployWorkflow, /code-scanning\/default-setup/u, "release gate must not require the administration-only CodeQL setup endpoint");
  assert.match(deployWorkflow, /const minimumRulesCount = 103/u, "release gate must retain the reviewed extended-suite rule floor");
  assert.match(deployWorkflow, /"dynamic\/github-code-scanning\/codeql:analyze"/u, "release gate must trust the default-setup CodeQL analysis key");
  assert.match(deployWorkflow, /"dynamic\/github-code-scanning\/codeql:upload"/u, "release gate must trust the explicit-upload CodeQL analysis key");
  assert.match(deployWorkflow, /trustedAnalysisKeys\.has\(analysis\.analysis_key\)/u, "release gate must reject every untrusted dynamic analysis key");
  assert.match(deployWorkflow, /runs\.some\(\(run\) => run\.status !== "completed"\)/u, "release gate must wait for every exact-SHA CodeQL run to settle");
  assert.match(deployWorkflow, /run\.run_number/u, "release gate must fingerprint GitHub workflow execution numbers");
  assert.match(deployWorkflow, /run\.run_attempt/u, "release gate must fingerprint GitHub rerun attempts");
  assert.match(deployWorkflow, /run\.run_started_at/u, "release gate must order GitHub reruns by attempt start time");
  assert.match(deployWorkflow, /latest\.every\(\(run\) => run\.conclusion === "success"\)/u, "release gate must require every latest-starting exact-SHA CodeQL attempt to succeed");
  assert.match(deployWorkflow, /gh_api_read\(\)/u, "release gate must use bounded retries for read-only GitHub evidence");
  assert.match(deployWorkflow, /for attempt in 1 2 3 4/u, "release gate GitHub retries must stay bounded");
  assert.equal((deployWorkflow.match(/\bgh api\b/gu) || []).length, 1, "release gate must route every GitHub API read through the retry helper");
  assert.match(deployWorkflow, /code-scanning\/alerts/u, "release gate must query open code-scanning alerts after exact-SHA success");
  assert.match(deployWorkflow, /-f state=open -f ref=refs\/heads\/main -f tool_name=CodeQL/u, "release gate must scope open CodeQL alerts to main");
  assert.match(deployWorkflow, /assert\.equal\(alerts\.length, 0/u, "release gate must fail closed when main has open CodeQL alerts");
  assert.match(deployWorkflow, /assert\.equal\(resultsCount, 0/u, "release gate must fail closed when the exact-SHA CodeQL analysis contains results");
  assert.match(deployWorkflow, /exact-SHA CodeQL analysis set changed during authorization/u, "release gate must reject a changing analysis snapshot");
  assert.match(deployWorkflow, /an exact-SHA CodeQL run started during authorization/u, "release gate must recheck for late CodeQL runs");
  assert.match(deployWorkflow, /exact-SHA CodeQL run attempt set changed during authorization/u, "release gate must reject a changing exact-SHA CodeQL rerun snapshot");
  assert.match(deployWorkflow, /release-evidence\/authorization\/codeql-gate\.json/u, "release gate must persist bounded CodeQL evidence");
  assert.doesNotMatch(deployWorkflow, /path:\s*\$RUNNER_TEMP\/codeql-(?:analyses|open-alerts)\.json/u, "raw CodeQL API responses must not enter artifacts");
  assert.match(deployWorkflow, /environment:[\s\S]*name:\s*staging/u, "deployment must use the staging environment");
  assert.match(deployWorkflow, /needs:\s*\[authorize, validate, staging\]/u, "production must depend on validation and staging");
  assert.match(deployWorkflow, /name:\s*production/u, "deployment must use the production environment");
  assert.match(deployWorkflow, /CLOUDFLARE_API_TOKEN:\s*\$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/u);
  assert.match(deployWorkflow, /CLOUDFLARE_ACCOUNT_ID:\s*\$\{\{ secrets\.CLOUDFLARE_ACCOUNT_ID \}\}/u);
  assert.match(deployWorkflow, /D1_BACKUP_PASSPHRASE:\s*\$\{\{ secrets\.D1_BACKUP_PASSPHRASE \}\}/u);
  assert.doesNotMatch(
    deployWorkflow,
    /^    env:\n(?:^      .*\n)*^      (?:CLOUDFLARE_API_TOKEN|D1_BACKUP_PASSPHRASE|GRIHAGRID_CANARY_PASSWORD):/mu,
    "deploy credentials must never be job-scoped",
  );
  assert.match(deployWorkflow, /GGRIDBK1-AES-256-GCM/u, "migration exports must use authenticated encryption");
  assert.match(deployWorkflow, /backup-crypto\.mjs decrypt/u, "migration exports must pass decrypt verification");
  assert.match(deployWorkflow, /keyVersion:\s*process\.env\.BACKUP_KEY_VERSION/u, "encrypted backups must identify their recovery key version");
  assert.match(deployWorkflow, /Create protected staging export and recovery point/u, "Cloudflare export credentials must be isolated from encryption");
  assert.match(deployWorkflow, /Encrypt and verify protected staging export/u, "backup encryption must be a separate least-privilege step");
  assert.match(deployWorkflow, /authenticated-smoke\.mjs/u, "each environment must run an authenticated canary");
  assert.equal((deployWorkflow.match(/node scripts\/authenticated-smoke\.mjs "\$ORIGIN"/gu) || []).length, 4, "release workflow must contain exactly four mutating authenticated smokes");
  assert.equal((deployWorkflow.match(/run-canary-session-fence\.sh snapshot (?:staging|production) (?:candidate|rollback)/gu) || []).length, 4, "every mutating authenticated smoke must have an exact pre-login session snapshot");
  assert.equal((deployWorkflow.match(/run-canary-session-fence\.sh restore (?:staging|production) (?:candidate|rollback)/gu) || []).length, 4, "every mutating authenticated smoke must have trap-protected session restoration");
  assert.match(authenticatedSmoke, /AUTHENTICATED_SMOKE_REQUEST_TIMEOUT_MS = 15_000/u, "authenticated requests must remain tightly bounded");
  assert.match(authenticatedSmoke, /AUTHENTICATED_SMOKE_LOGIN_TIMEOUT_MS = 30_000/u, "the mutating login request must have a distinct bounded response window");
  assert.match(authenticatedSmoke, /path === "\/api\/auth\/login"/u, "only canary login may use the longer request window");
  assert.match(authenticatedSmoke, /timeoutMs = authenticatedSmokeRequestTimeoutMs\(path, options\)/u, "every authenticated canary request must select its reviewed timeout");
  assert.doesNotMatch(authenticatedSmoke, /\.\.\.requestInit,[\s\S]{0,160}timeoutMs,/u, "the private timeout option must never be sent as a fetch option");
  assert.match(authenticatedSmoke, /const legacyWorker = options\.legacyWorker === true/u, "the current authenticated harness must support previous-Worker compatibility mode");
  assert.match(authenticatedSmoke, /LEGACY_WORKER_COMPAT === "true"/u, "the authenticated CLI must expose reviewed legacy-Worker mode");
  assert.match(authenticatedSmoke, /canaryProjectIds: \[\.\.\.cleanupIds\]\.sort\(\)/u, "authenticated smoke evidence must identify every synthetic project");
  assert.match(authenticatedSmoke, /primaryError\.releaseEvidence = result/u, "failed authenticated canaries must still expose cleanup evidence");
  assert.match(authenticatedSmoke, /readiness\?\.checks\?\.reportShareSchema, "current"/u, "the authenticated canary must require current report-share schema");
  assert.match(authenticatedSmoke, /readiness\?\.checks\?\.reportHandoffControl, "enabled"/u, "the authenticated canary must require the report-handoff control to be enabled");
  assert.match(authenticatedSmoke, /readiness\?\.checks\?\.reportShareAbuseHashing, "configured"/u, "the authenticated canary must require report-share abuse hashing");
  assert.match(authenticatedSmoke, /readiness\?\.capabilities\?\.reportHandoff, true/u, "the authenticated canary must require report handoff readiness");
  assert.match(authenticatedSmoke, /call\("\/api\/shared\/report", \{[\s\S]*?anonymous: true,[\s\S]*?JSON\.stringify\(\{ token: reportShareToken \}\)/u, "the authenticated canary must redeem report handoffs anonymously through the constant POST route");
  assert.match(authenticatedSmoke, /Object\.keys\(publicShare\?\.share \|\| \{\}\)\.sort\(\), \["expiresAt", "sections"\]/u, "the authenticated canary must enforce the minimal public handoff envelope");
  assert.doesNotMatch(authenticatedSmoke, /publicShare\?\.share\?\.report/u, "the authenticated canary must not expect the retired public report wrapper");
  assert.match(authenticatedSmoke, /\[410\]/u, "the authenticated canary must prove revoked report handoffs are gone");
  assert.match(canarySessionFence, /WHERE email = \$\{emailLiteral\}/u, "canary session snapshots must bind the exact normalized account email");
  assert.match(canarySessionFence, /AND deleted_at IS NULL/u, "canary session snapshots must reject deleted accounts");
  assert.match(canarySessionFence, /assert\.equal\(users\.length, 1/u, "canary session cleanup must require exactly one active account");
  assert.match(canarySessionFence, /const delta = newSessionIds\(before, observed\)/u, "canary session cleanup must derive only the post-login session delta");
  assert.match(canarySessionFence, /AND user_id = \$\{userId\}/u, "canary session deletes must remain scoped to the exact account ID");
  assert.match(canarySessionFence, /sameSet\(removed, delta/u, "canary session proof must verify the exact deleted ID set");
  assert.match(canarySessionFence, /sameSet\(final\.sessionIds, before\.sessionIds/u, "canary session proof must verify exact baseline restoration");
  assert.match(canarySessionFence, /restoredExactly: true/u, "canary session release evidence must be count-only and fail closed before success");
  assert.match(canarySessionFence, /mode === "validate-snapshot"/u, "canary session baselines must be parsed before any mutating login");
  assert.match(canarySessionFence, /accumulateCanarySessionCleanupEvidence/u, "delayed reconciliation passes must retain bounded cumulative evidence");
  assert.match(runCanarySessionFence, /node scripts\/canary-session-fence\.mjs validate-snapshot/u, "the session wrapper must fail before login on an unsafe D1 baseline");
  assert.match(runCanarySessionFence, /stabilization_seconds=40/u, "ambiguous login cleanup must outlast the documented post-disconnect work window");
  assert.match(runCanarySessionFence, /while true/u, "ambiguous login cleanup must repeat exact reconciliation through stabilization");
  assert.match(runCanarySessionFence, /CANARY_SESSION_PREVIOUS_PROOF/u, "repeated session cleanup must accumulate count-only proof");
  assert.match(runCanarySessionFence, /--command "\$query_sql_text"/u, "result-bearing session snapshots must use Wrangler's remote command path");
  assert.match(runCanarySessionFence, /--command "\$cleanup_sql_text"/u, "result-bearing session deletes must use Wrangler's remote command path");
  assert.doesNotMatch(runCanarySessionFence, /--file/u, "session fencing must not use Wrangler's metadata-only remote file path");
  assert.match(runCanarySessionFence, /if \[ "\$stabilized_for_ms" -ge "\$stabilization_ms" \]/u, "ambiguous cleanup may stop only after its retained final snapshot reaches the stabilization bound");
  assert.match(runCanarySessionFence, /env -u GRIHAGRID_CANARY_EMAIL -u GRIHAGRID_CANARY_PASSWORD[\s\\]+wrangler d1 execute/u, "raw D1 session calls must not inherit canary credentials");
  assert.match(smoke, /const legacyWorker = options\.legacyWorker === true/u, "public smoke must support previous-Worker compatibility mode");
  assert.match(smoke, /const expectReportHandoff = options\.expectReportHandoff !== false/u, "public smoke must support exact-version checks while handoff is closed");
  assert.match(smoke, /expectReportHandoff \? "enabled" : "disabled"/u, "public smoke must verify the requested report-handoff control state");
  assert.match(smoke, /if \(!legacyWorker\) \{[\s\S]*?reportShareDocumentCheck\(origin,"GET"\)[\s\S]*?reportShareDocumentCheck\(origin,"HEAD"\)/u, "legacy smoke must skip the handoff-only document route");
  assert.match(smoke, /if \(!legacyWorker\) \{[\s\S]*?reportHandoffControl[\s\S]*?reportShareAbuseHashing/u, "legacy smoke must skip current-only handoff readiness checks");
  assert.match(waitForRelease, /releaseProbe,\s*\}\)/u, "release polling must pass a unique routing probe to every smoke sample");
  assert.match(waitForRelease, /LEGACY_WORKER_COMPAT === "true"/u, "release polling CLI must expose legacy compatibility mode");
  assert.match(waitForRelease, /EXPECT_REPORT_HANDOFF !== "false"/u, "release polling CLI must expose closed-control propagation mode");
  assert.match(waitForRelease, /const DEFAULT_STABILITY_MS = 60 \* 1000/u, "release polling must require a sustained one-minute exact-version window");
  assert.doesNotMatch(waitForRelease, /GRIHAGRID_RELEASE_STABILITY_MS/u, "release polling CLI must not permit a sub-minute stability-window override");
  assert.match(waitForRelease, /performance\.now\(\)/u, "release polling must measure stability with a monotonic clock");
  assert.match(smoke, /readiness\?release_probe=/u, "release smoke must cache-bust exact-version readiness during propagation polling");
  assert.match(smoke, /releaseProbe \? \{ headers: \{ "cache-control": "no-cache" \} \} : \{\}/u, "release smoke must request fresh readiness routing during propagation polling");
  assert.ok(smoke.lastIndexOf("jsonCheck(origin, readinessPath") > smoke.lastIndexOf('jsonCheck(origin, "/api/commerce/catalog"'), "release smoke must observe the exact Worker version after every other full-sample check");
  assert.match(readinessLatency, /const DEFAULT_SAMPLE_COUNT = 20/u, "readiness latency must retain twenty raw samples");
  assert.match(readinessLatency, /const DEFAULT_MAX_P95_MS = 500/u, "readiness latency must gate p95 below 500 ms");
  assert.match(readinessLatency, /nearestRankPercentile\(latencies, 0\.95\)/u, "readiness latency must use nearest-rank p95");
  assert.match(readinessLatency, /if \(!\(p95Ms < maxP95Ms\)\)/u, "the p95 threshold must be strictly below its bound");
  assert.match(readinessLatency, /"cache-control": "no-cache"/u, "readiness samples must bypass shared caches");
  assert.match(readinessLatency, /response\.headers\.get\("cache-control"\), "no-store"/u, "readiness samples must require an uncacheable response");
  for (const capability of ["privateUploads", "paidCheckout", "paidFulfillment"]) {
    assert.match(readinessLatency, new RegExp(`"${capability}"`, "u"), `readiness latency must prove ${capability} remains closed`);
  }
  assert.equal((deployWorkflow.match(/^\s*id: readiness_latency$/gmu) || []).length, 2, "both environments must use an exact-version readiness latency gate");
  assert.equal((deployWorkflow.match(/readiness-latency\.mjs/gu) || []).length, 2, "both environments must run the reviewed readiness sampler");
  assert.match(deployWorkflow, /release-evidence\/staging\/readiness-latency\.json/u, "staging latency evidence must be preserved");
  assert.match(deployWorkflow, /release-evidence\/production\/readiness-latency\.json/u, "production latency evidence must be preserved");
  assert.match(releaseDbEvidence, /buildCanaryResidueSql/u, "release evidence must build an exact canary-ID residue query");
  for (const table of ["projects", "project_revisions", "reports", "project_revision_reports", "report_feedback", "report_shares"]) {
    assert.match(
      releaseDbEvidence,
      new RegExp(`FROM ${table} WHERE (?:id|project_id) IN \\(\\$\\{ids\\}\\)`, "u"),
      `canary residue proof must query exact IDs in ${table}`,
    );
  }
  assert.match(releaseDbEvidence, /\["projects", "project_revisions", "reports", "revision_reports", "feedback", "report_shares"\]/u, "canary residue verification must fail closed on every project-owned report and revision table");
  for (const object of [
    "table:report_shares",
    "table:report_share_read_counters",
    "table:report_share_create_counters",
    "table:report_handoff_controls",
    "index:idx_report_shares_owner_created",
    "index:idx_report_shares_expiry",
    "index:idx_report_shares_revoked",
    "index:idx_report_share_read_counters_updated",
    "index:idx_report_share_create_counters_updated",
    "trigger:report_share_sections_insert_guard",
    "trigger:report_share_identity_immutable",
    "trigger:archived_report_share_insert_guard",
    "trigger:report_share_active_limit_insert",
    "trigger:report_handoff_enabled_insert_guard",
  ]) {
    assert.match(releaseDbEvidence, new RegExp(`"${object}"`, "u"), `release evidence must require ${object}`);
  }
  const reportHandoffInventory = releaseDbEvidence.match(/const REQUIRED_0016_OBJECTS = Object\.freeze\(\[([\s\S]*?)\]\);/u)?.[1] || "";
  assert.equal((reportHandoffInventory.match(/"trigger:/gu) || []).length, 5, "release evidence must inventory all five report-handoff D1 triggers");
  for (const object of [
    "table:login_attempt_fences",
    "index:idx_login_attempt_fences_expires",
  ]) {
    assert.match(releaseDbEvidence, new RegExp(`"${object}"`, "u"), `release evidence must require ${object}`);
  }
  for (const column of ["user_id", "window_started_at", "expires_at", "request_count", "limit_count", "updated_at"]) {
    assert.match(
      releaseDbEvidence,
      new RegExp(`"login_attempt_fences:${column}"`, "u"),
      `release evidence must require login_attempt_fences:${column}`,
    );
  }
  assert.match(releaseDbEvidence, /projectIdsSha256/u, "release artifacts must retain only a digest of canary project IDs");
  for (const field of [
    "invalid_input_rows",
    "unknown_input_rows",
    "soil_report_keys",
    "unsafe_revision_reports",
    "unsafe_current_reports",
  ]) {
    assert.match(deployWorkflow, new RegExp(`AS ${field}\\b`, "u"), `pre-migration safety audit must include ${field}`);
    assert.match(releaseDbEvidence, new RegExp(`"${field}"`, "u"), `release evidence must fail closed on ${field}`);
  }
  assert.equal((deployWorkflow.match(/release-db-evidence\.mjs pre /gu) || []).length, 2, "staging and production must record strict pre-migration evidence");
  assert.equal((deployWorkflow.match(/release-db-evidence\.mjs post /gu) || []).length, 2, "staging and production must prove migration invariance");
  assert.equal(
    (deployWorkflow.match(/WITH entities\(entity\) AS \(VALUES \('users'\),\('sessions'\),\('projects'\),\('reports'\),\('orders'\),\('payment_webhook_events'\)\)/gu) || []).length,
    4,
    "all pre/post protected-count queries must use one D1-compatible SELECT",
  );
  assert.doesNotMatch(
    deployWorkflow,
    /SELECT 'users' AS entity,COUNT\(\*\) AS row_count FROM users UNION ALL SELECT 'sessions'/u,
    "protected-count evidence must not exceed D1's compound SELECT term limit",
  );
  assert.equal(
    (deployWorkflow.match(/WITH target_tables\(table_name\) AS \(VALUES \('users'\),\('sessions'\),\('password_change_attempt_counters'\),\('login_attempt_fences'\),\('report_share_read_counters'\),\('report_share_create_counters'\),\('report_handoff_controls'\),\('projects'\),\('orders'\),\('project_revisions'\),\('report_feedback'\),\('report_shares'\),\('project_files'\),\('email_verification_tokens'\),\('password_reset_tokens'\),\('transactional_email_events'\),\('account_deletion_requests'\),\('account_deletion_receipts'\),\('professional_profiles'\),\('professional_review_requests'\),\('professional_review_messages'\),\('professional_review_events'\)\) SELECT target_tables\.table_name,columns\.name FROM target_tables JOIN pragma_table_info\(target_tables\.table_name\) AS columns/gu) || []).length,
    2,
    "both schema-column inventories must use one D1-compatible SELECT",
  );
  assert.doesNotMatch(
    deployWorkflow,
    /pragma_table_info\('users'\) UNION ALL/u,
    "schema-column evidence must not exceed D1's compound SELECT term limit",
  );
  assert.equal((deployWorkflow.match(/LEGACY_WORKER_COMPAT:\s*"true"/gu) || []).length, 6, "both environments must use legacy mode for rollback rehearsals and all four rollback version checks");
  assert.equal((deployWorkflow.match(/0016_report_handoff_links\.sql/gu) || []).length, 2, "both environments must detect a pending report-handoff migration");
  assert.equal((deployWorkflow.match(/0017_login_attempt_fence\.sql/gu) || []).length, 2, "both environments must detect a pending login-attempt-fence migration");
  assert.equal((deployWorkflow.match(/REPORT_SHARE_MIGRATION_PENDING=/gu) || []).length, 2, "both environments must prove both new report-share tables start empty");
  assert.equal((deployWorkflow.match(/LOGIN_ATTEMPT_FENCE_MIGRATION_PENDING=/gu) || []).length, 2, "both environments must distinguish a first login-attempt-fence apply");
  assert.equal(
    (deployWorkflow.match(/SELECT COUNT\(\*\) AS row_count FROM report_share_read_counters;/gu) || []).length,
    2,
    "both environments must count the new hashed read-counter table after migration",
  );
  assert.equal(
    (deployWorkflow.match(/SELECT COUNT\(\*\) AS row_count FROM report_share_create_counters;/gu) || []).length,
    2,
    "both environments must count the new create-counter table after migration",
  );
  assert.equal(
    (deployWorkflow.match(/SELECT COUNT\(\*\) AS row_count FROM login_attempt_fences;/gu) || []).length,
    2,
    "both environments must count the login-attempt fence table after migration",
  );
  assert.equal(
    (deployWorkflow.match(/SELECT control_key,enabled FROM report_handoff_controls ORDER BY control_key;/gu) || []).length,
    8,
    "post-migration, post-canary-closure, and rollback gates must prove the exact report-handoff control row",
  );
  assert.equal((deployWorkflow.match(/release-db-evidence\.mjs handoff-counts /gu) || []).length, 2, "both environments must persist bounded post-canary handoff counts");
  assert.match(releaseDbEvidence, /reportShareReadCounterRows/u, "post-migration evidence must emit the hashed read-counter count");
  assert.match(releaseDbEvidence, /new report_share_read_counters table must start empty/u, "the 0016 release gate must reject a pre-populated hashed read-counter table");
  assert.match(releaseDbEvidence, /reportShareCreateCounterRows/u, "post-migration evidence must emit the create-counter count");
  assert.match(releaseDbEvidence, /new report_share_create_counters table must start empty/u, "the 0016 release gate must reject a pre-populated create-counter table");
  assert.match(releaseDbEvidence, /loginAttemptFenceRows/u, "post-migration evidence must emit the login-attempt fence count");
  assert.match(releaseDbEvidence, /new login_attempt_fences table must start empty/u, "the 0017 release gate must reject a pre-populated fence table only on first apply");
  assert.match(releaseDbEvidence, /report handoff control must contain exactly one row/u, "release evidence must require exactly one report-handoff control row");
  assert.match(releaseDbEvidence, /expectedEnabled: false/u, "post-migration evidence must require the report-handoff control to start disabled");
  assert.match(releaseDbEvidence, /the report handoff control must be enabled after release checks/u, "post-canary evidence must require the control to finish enabled on success");
  const reportShareManifest = worker.match(
    /reportShare:\s*readinessManifest\(\{(?<body>[\s\S]*?)\n\s*\}\),\n\s*projectCreation:/u,
  )?.groups?.body;
  assert.ok(reportShareManifest, "readiness must define the report-share manifest");
  const reportShareTriggerSource = reportShareManifest.match(
    /triggers:\s*\[(?<triggers>[\s\S]*?)\],\n\s*columns:/u,
  )?.groups?.triggers;
  assert.ok(reportShareTriggerSource, "readiness must inventory report-share triggers");
  assert.deepEqual(
    [...reportShareTriggerSource.matchAll(/"([a-z0-9_]+)"/gu)].map((match) => match[1]),
    [
      "report_share_sections_insert_guard",
      "report_share_identity_immutable",
      "archived_report_share_insert_guard",
      "report_share_active_limit_insert",
      "report_handoff_enabled_insert_guard",
    ],
    "readiness must require all five exact report-handoff triggers",
  );
  assert.match(
    worker,
    /const reportShareStructureCurrent = readinessInventoryHas\(inventory, READINESS_MANIFESTS\.reportShare\)/u,
    "readiness must gate report sharing on its complete manifest",
  );
  assert.match(
    worker,
    /const reportShareSchema = reportShareStructureCurrent && reportHandoffControlState !== "unavailable"/u,
    "readiness must fail report-share schema closed when the live control is unavailable",
  );
  assert.match(
    worker,
    /DELETE FROM report_shares WHERE expires_at<datetime\('now','-90 days'\) OR \(revoked_at IS NOT NULL AND revoked_at<datetime\('now','-90 days'\)\)/u,
    "scheduled hygiene must delete only report shares that have been expired or revoked for 90 days",
  );
  assert.match(
    worker,
    /DELETE FROM report_share_read_counters WHERE updated_at<datetime\('now','-2 days'\)/u,
    "scheduled hygiene must bound hashed public-report admission counters to two days",
  );
  assert.match(
    worker,
    /DELETE FROM report_share_create_counters WHERE updated_at<datetime\('now','-2 days'\)/u,
    "scheduled hygiene must bound report-share creation counters to two days",
  );
  assert.doesNotMatch(deployWorkflow, /git show[^\n]*authenticated-smoke\.mjs/u, "rollback rehearsal must not execute the previous commit's harness");
  assert.match(deployWorkflow, /wait-for-release\.mjs/u, "releases must wait for consecutive exact-version smoke samples");
  assert.match(deployWorkflow, /Reconfirm the exact staging version/u, "production must reject staging drift after its hold");
  assert.match(deployWorkflow, /monitor-release\.mjs/u, "production must run exact-version monitoring");
  assert.match(deployWorkflow, /GRIHAGRID_MONITOR_WATCH_PIDS/u, "the public monitor must watch both exact-version tails");
  assert.match(deployWorkflow, /TAIL_PROCESS_GROUP="\$\$"/u, "a first tail event must terminate its supervised process group immediately");
  assert.match(deployWorkflow, /public_regression=/u, "public regression state must survive tail finalization errors");
  assert.match(deployWorkflow, /--version-id/u, "production error tail must be scoped to the deployed Worker version");
  assert.match(deployWorkflow, /tail-aggregate\.mjs/u, "tail payloads must be reduced to bounded aggregates");
  assert.match(deployWorkflow, /classify-tail-stderr\.mjs/u, "tail stderr must be classified without entering release artifacts");
  assert.doesNotMatch(deployWorkflow, /(?:invocation|server)-errors\.ndjson/u, "raw Worker tail payloads must never enter artifacts");
  assert.equal(
    (deployWorkflow.match(/\(needs\.authorize\.outputs\.migrations == 'false' \|\|\s*\(steps\.rollback_compat\.outcome == 'success' && steps\.rollback_residue\.outcome == 'success'\)\)/gu) || []).length,
    6,
    "every migration-bearing rollback path must require explicit compatibility and zero-residue evidence from the authorized release diff",
  );
  assert.doesNotMatch(
    deployWorkflow,
    /\(steps\.migrations\.outputs\.pending == 'false' \|\|\s*\(steps\.rollback_compat\.outcome == 'success'/u,
    "an already-applied remote migration must not bypass rollback compatibility evidence",
  );
  assert.equal(
    (deployWorkflow.match(/if: needs\.authorize\.outputs\.migrations == 'true'/gu) || []).length,
    2,
    "both migration-bearing environment releases must rehearse the previous Worker even when the remote migration was applied earlier",
  );
  assert.equal(
    (deployWorkflow.match(/^\s*if: steps\.migrations\.outputs\.pending == 'true'$/gmu) || []).length,
    6,
    "backup creation, encryption, and storage must remain keyed only to actual pending remote migrations",
  );
  assert.ok((deployWorkflow.match(/umask 077/gu) || []).length >= 8, "raw release evidence must be created with private permissions");
  assert.equal((deployWorkflow.match(/release-db-evidence\.mjs residue-sql /gu) || []).length, 4, "old-Worker and candidate canaries need exact-ID residue SQL in both environments");
  assert.equal((deployWorkflow.match(/release-db-evidence\.mjs residue /gu) || []).length, 4, "old-Worker and candidate canaries need verified zero-residue evidence in both environments");
  assert.equal((deployWorkflow.match(/if: always\(\) && steps\.rollback_compat\.outcome != 'skipped'/gu) || []).length, 2, "rollback rehearsal residue must run after success or failure in both environments");
  assert.equal((deployWorkflow.match(/if: always\(\) && steps\.canary\.outcome != 'skipped'/gu) || []).length, 4, "candidate residue and closed-control proof must run after each attempted canary");
  for (const environment of ["staging", "production"]) {
    const currentMainFence = workflowStep(
      deployWorkflow,
      environment === "staging"
        ? "Reconfirm current main before staging inspection"
        : "Reconfirm current main after the production hold",
    );
    const currentMainFenceName = environment === "staging"
      ? "Reconfirm current main before staging inspection"
      : "Reconfirm current main after the production hold";
    const databaseFenceName = `Reconfirm current main before ${environment} database mutation`;
    const activationFenceName = `Reconfirm current main before ${environment} Worker activation`;
    for (const stepName of [
      currentMainFenceName,
      databaseFenceName,
      activationFenceName,
    ]) {
      const step = stepName === currentMainFenceName ? currentMainFence : workflowStep(deployWorkflow, stepName);
      assert.match(step, /git fetch --no-tags origin \+refs\/heads\/main:refs\/remotes\/origin\/main/u, `${stepName} must refresh main before privileged work`);
      assert.match(step, /release-scope\.mjs assert-current "\$RELEASE_SHA" "\$current_main_sha"/u, `${stepName} must reject a candidate behind newer runtime work`);
    }
    assert.ok(
      deployWorkflow.indexOf(`      - name: ${currentMainFenceName}`)
        < deployWorkflow.indexOf(`      - name: Record current ${environment} Worker`),
      `${environment} must reject a stale release before remote inspection`,
    );
    if (environment === "production") {
      assert.ok(
        deployWorkflow.indexOf("      - name: Reconfirm the exact staging version after the production hold")
          < deployWorkflow.indexOf(`      - name: ${currentMainFenceName}`),
        "production must refresh currentness after sustained staging reconfirmation",
      );
    }
    assert.ok(
      deployWorkflow.indexOf(`      - name: ${databaseFenceName}`)
        < deployWorkflow.indexOf(`      - name: Apply and verify ${environment} migrations`),
      `${environment} must reject a stale release before database mutation`,
    );
    assert.ok(
      deployWorkflow.indexOf(`      - name: ${activationFenceName}`)
        < deployWorkflow.indexOf(`      - name: Deploy authorized SHA to ${environment}`),
      `${environment} must reject a stale release before Worker activation`,
    );

    for (const stepName of [
      `Inspect pending ${environment} migrations and aggregate data state`,
      `Apply and verify ${environment} migrations`,
      `Prove ${environment} rollback rehearsal left zero database residue`,
      `Prove ${environment} canary left zero database residue`,
    ]) {
      const step = workflowStep(deployWorkflow, stepName);
      assert.match(step, /umask 077/u, `${stepName} must protect raw evidence with umask 077`);
      if (stepName.startsWith("Prove ")) {
        assert.match(step, /residue_sql="\$\(</u, `${stepName} must load the validated read-only SQL`);
        assert.match(step, /--command "\$residue_sql"/u, `${stepName} must use Wrangler's JSON-only command path`);
        assert.doesNotMatch(step, /--file/u, `${stepName} must not mix Wrangler file-upload progress with JSON evidence`);
      }
    }
    const applyMigrations = workflowStep(deployWorkflow, `Apply and verify ${environment} migrations`);
    assert.match(applyMigrations, /steps\.migrations\.outputs\.report_share_pending \}\}" != "true"/u, `${environment} later releases must close an already-existing report-handoff control before activation`);
    assert.match(applyMigrations, /UPDATE report_handoff_controls SET enabled=0/u, `${environment} later releases must explicitly start with report handoff closed`);
    assert.match(applyMigrations, /REPORT_HANDOFF_EXPECTED_ENABLED=false/u, `${environment} migration evidence must require a disabled report-handoff control`);
    assert.match(applyMigrations, /SELECT COUNT\(\*\) AS row_count FROM login_attempt_fences;/u, `${environment} migration evidence must count login-attempt fences`);
    assert.match(applyMigrations, /LOGIN_ATTEMPT_FENCE_MIGRATION_PENDING/u, `${environment} migration evidence must identify the first 0017 apply`);

    const rollbackCompatibility = workflowStep(deployWorkflow, `Rehearse rollback Worker against migrated ${environment} schema`);
    assert.match(rollbackCompatibility, /if: needs\.authorize\.outputs\.migrations == 'true'/u, `${environment} rollback compatibility must follow the authorized migration-bearing release diff`);
    assert.match(rollbackCompatibility, /CLOUDFLARE_API_TOKEN:\s*\$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/u, `${environment} rollback session proof must have step-scoped D1 authority`);
    assert.match(rollbackCompatibility, new RegExp(`run-canary-session-fence\\.sh snapshot ${environment} rollback`, "u"), `${environment} rollback canary must validate its session baseline before login`);
    assert.match(rollbackCompatibility, /trap restore_rollback_canary_sessions EXIT/u, `${environment} rollback canary must install unconditional session cleanup`);
    assert.match(rollbackCompatibility, new RegExp(`run-canary-session-fence\\.sh restore ${environment} rollback`, "u"), `${environment} rollback canary trap must prove exact session restoration`);
    assert.match(rollbackCompatibility, new RegExp(`release-evidence/${environment}/rollback-canary-session-cleanup\\.json`, "u"), `${environment} rollback canary must retain count-only session proof`);
    assert.match(rollbackCompatibility, /attempt_outcome=ambiguous/u, `${environment} failed rollback canaries must enter delayed reconciliation`);
    assert.match(rollbackCompatibility, /env -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_ACCOUNT_ID[\s\\]+node scripts\/authenticated-smoke\.mjs/u, `${environment} rollback smoke must not inherit D1 deployment authority`);
    assert.ok(
      rollbackCompatibility.indexOf(`run-canary-session-fence.sh snapshot ${environment} rollback`)
        < rollbackCompatibility.indexOf("trap restore_rollback_canary_sessions EXIT")
        && rollbackCompatibility.indexOf("trap restore_rollback_canary_sessions EXIT")
          < rollbackCompatibility.indexOf("node scripts/authenticated-smoke.mjs"),
      `${environment} rollback session snapshot and trap must precede authenticated mutation`,
    );
    for (const backupStepName of [
      `Create protected ${environment} export and recovery point`,
      `Encrypt and verify protected ${environment} export`,
      `Store encrypted ${environment} export`,
    ]) {
      assert.match(
        workflowStep(deployWorkflow, backupStepName),
        /if: steps\.migrations\.outputs\.pending == 'true'/u,
        `${backupStepName} must run only for an actual pending remote migration`,
      );
    }

    const migrationInspectionName = `Inspect pending ${environment} migrations and aggregate data state`;
    const migrationDriftName = `Reject unexpected ${environment} migration drift`;
    const migrationDrift = workflowStep(deployWorkflow, migrationDriftName);
    assert.match(migrationDrift, /id: migration_drift_guard/u, `${environment} drift validation must expose a downstream gate`);
    assert.match(migrationDrift, /AUTHORIZED_MIGRATIONS: \$\{\{ needs\.authorize\.outputs\.migrations \}\}/u, `${environment} drift validation must use the authorized release scope`);
    assert.match(migrationDrift, /REMOTE_PENDING_MIGRATIONS: \$\{\{ steps\.migrations\.outputs\.pending \}\}/u, `${environment} drift validation must use the inspected remote state`);
    assert.match(migrationDrift, /\[\[ "\$AUTHORIZED_MIGRATIONS" == "false" && "\$REMOTE_PENDING_MIGRATIONS" == "true" \]\]/u, `${environment} must reject remote migration drift outside a migration-bearing release`);
    assert.doesNotMatch(migrationDrift, /continue-on-error/u, `${environment} migration drift rejection must be a hard stop`);
    assert.match(migrationDrift, /exit 1/u, `${environment} migration drift rejection must fail before mutation`);
    const migrationOrder = [
      migrationInspectionName,
      migrationDriftName,
      `Create protected ${environment} export and recovery point`,
      `Apply and verify ${environment} migrations`,
      `Deploy authorized SHA to ${environment}`,
    ].map((name) => deployWorkflow.indexOf(`      - name: ${name}`));
    assert.ok(
      migrationOrder.every((position, index) => position >= 0 && (index === 0 || position > migrationOrder[index - 1])),
      `${environment} must reject unexpected drift before backup, migration, or deployment`,
    );

    const propagation = workflowStep(deployWorkflow, `Wait for sustained exact ${environment} smoke samples`);
    assert.match(propagation, /EXPECT_REPORT_HANDOFF:\s*"false"/u, `${environment} exact-version propagation must run while report handoff remains closed`);

    const latency = workflowStep(deployWorkflow, `Gate ${environment} readiness latency on the exact version`);
    assert.match(latency, /if: steps\.propagation\.outcome == 'success'/u, `${environment} latency must follow exact-version propagation`);
    assert.match(latency, /continue-on-error:\s*true/u, `${environment} latency failure must reach fail-closed rollback handling`);
    assert.match(latency, /GRIHAGRID_READINESS_ORIGIN:\s*\$\{\{ env\.ORIGIN \}\}/u, `${environment} latency must use the configured release origin`);
    assert.match(latency, /GRIHAGRID_RELEASE_ID:\s*\$\{\{ steps\.version\.outputs\.version_id \}\}/u, `${environment} latency must bind every sample to the deployed Worker version`);
    assert.match(latency, /GRIHAGRID_RELEASE_SHA:\s*\$\{\{ env\.RELEASE_SHA \}\}/u, `${environment} latency evidence must identify the merged release SHA`);
    assert.match(latency, /EXPECT_REPORT_HANDOFF:\s*"false"/u, `${environment} latency must run while report handoff is closed`);
    assert.match(
      latency,
      new RegExp(`EXPECT_AI_PLANNING_BRIEF:\\s*"${environment === "production" ? "true" : "false"}"`, "u"),
      `${environment} latency must assert the environment's reviewed AI capability`,
    );
    assert.match(latency, new RegExp(`release-evidence/${environment}/readiness-latency\\.json`, "u"), `${environment} must preserve every latency sample`);
    assert.doesNotMatch(latency, /secrets\./u, `${environment} public latency sampling must not receive secrets`);

    const canary = workflowStep(deployWorkflow, `Run ${environment} authenticated canary under bounded handoff activation`);
    assert.match(
      canary,
      /if: steps\.propagation\.outcome == 'success' && steps\.readiness_latency\.outcome == 'success'/u,
      `${environment} handoff activation must follow closed exact-version propagation and latency evidence`,
    );
    assert.match(canary, /trap reclose_report_handoff_after_canary EXIT/u, `${environment} authenticated canary must install its fail-closed EXIT trap before enabling`);
    assert.match(canary, /UPDATE report_handoff_controls SET enabled=1/u, `${environment} authenticated canary must activate handoff explicitly`);
    assert.match(canary, /UPDATE report_handoff_controls SET enabled=0/u, `${environment} authenticated canary EXIT trap must always re-close handoff`);
    assert.match(canary, /REPORT_HANDOFF_EXPECTED_ENABLED=true/u, `${environment} authenticated canary must prove its bounded activation`);
    assert.match(canary, /REPORT_HANDOFF_EXPECTED_ENABLED=false/u, `${environment} authenticated canary trap must prove it reclosed`);
    assert.match(canary, /authenticated-smoke\.mjs/u, `${environment} bounded activation must contain the authenticated canary`);
    assert.match(canary, new RegExp(`run-canary-session-fence\\.sh snapshot ${environment} candidate`, "u"), `${environment} canary must validate and snapshot its exact account sessions before login`);
    assert.ok(
      canary.indexOf(`run-canary-session-fence.sh snapshot ${environment} candidate`) < canary.indexOf("trap reclose_report_handoff_after_canary EXIT"),
      `${environment} session baseline must be captured before the bounded canary starts`,
    );
    assert.match(canary, new RegExp(`run-canary-session-fence\\.sh restore ${environment} candidate`, "u"), `${environment} canary trap must restore and prove the exact session baseline`);
    assert.match(canary, new RegExp(`release-evidence/${environment}/canary-session-cleanup\\.json`, "u"), `${environment} must persist bounded session-cleanup evidence`);
    assert.match(canary, /\[ "\$session_cleanup_status" -ne 0 \]/u, `${environment} canary must fail closed when session restoration is unverified`);
    assert.match(canary, /attempt_outcome=ambiguous/u, `${environment} failed canaries must enter delayed session reconciliation`);

    const disabled = workflowStep(deployWorkflow, `Prove ${environment} report handoff reclosed after authenticated canary`);
    assert.doesNotMatch(disabled, /UPDATE report_handoff_controls/u, `${environment} post-canary proof must not mask a failed EXIT-trap reclose`);
    assert.match(disabled, /SELECT control_key,enabled FROM report_handoff_controls/u, `${environment} post-canary proof must read the already-closed control`);
    assert.match(disabled, /REPORT_HANDOFF_EXPECTED_ENABLED=false/u, `${environment} post-canary proof must require the disabled database row`);
    assert.match(disabled, /reportHandoffControl, "disabled"/u, `${environment} readiness must report the disabled control`);
    assert.match(disabled, /reportHandoff, false/u, `${environment} readiness must withdraw the handoff capability`);
    assert.match(disabled, /\}, 503\);/u, `${environment} disabled redemption must fail closed with HTTP 503`);
    assert.match(disabled, /report_handoff_disabled/u, `${environment} disabled redemption must expose only the stable disabled code`);

    const restored = workflowStep(deployWorkflow, `Restore and verify ${environment} report handoff control`);
    for (const gate of ["canary", "residue", "handoff_reclosed"]) {
      assert.match(restored, new RegExp(`steps\\.${gate}\\.outcome == 'success'`, "u"), `${environment} final restoration must require successful ${gate} evidence`);
    }
    assert.match(restored, /trap reclose_report_handoff_on_failure EXIT/u, `${environment} restoration must install a fail-closed trap before enabling`);
    assert.match(restored, /UPDATE report_handoff_controls SET enabled=1/u, `${environment} restoration must explicitly enable the control`);
    assert.match(restored, /UPDATE report_handoff_controls SET enabled=0/u, `${environment} restoration failure trap must re-close the control`);
    assert.match(restored, /REPORT_HANDOFF_EXPECTED_ENABLED=true/u, `${environment} restoration must prove the enabled database row`);
    assert.match(restored, /reportHandoffControl, "enabled"/u, `${environment} readiness must report the enabled control`);
    assert.match(restored, /\}, 404\);/u, `${environment} enabled missing-token redemption must return HTTP 404`);
    assert.match(restored, /report_share_not_found/u, `${environment} enabled missing-token redemption must expose the stable not-found code`);

    const counts = workflowStep(deployWorkflow, `Record ${environment} post-canary report handoff counts`);
    assert.match(counts, /if: steps\.handoff_restore\.outcome == 'success'/u, `${environment} bounded counts must follow final verified restoration`);
    for (const count of ["report_shares", "report_share_read_counters", "report_share_create_counters", "report_handoff_controls", "enabled_report_handoff_controls"]) {
      assert.match(counts, new RegExp(`AS ${count}\\b`, "u"), `${environment} post-canary evidence must include ${count}`);
    }
    assert.match(counts, /release-db-evidence\.mjs handoff-counts/u, `${environment} post-canary counts must pass bounded validation`);
    const orderedReleaseSteps = [
      `Wait for sustained exact ${environment} smoke samples`,
      `Gate ${environment} readiness latency on the exact version`,
      `Run ${environment} authenticated canary under bounded handoff activation`,
      `Prove ${environment} canary left zero database residue`,
      `Prove ${environment} report handoff reclosed after authenticated canary`,
      `Restore and verify ${environment} report handoff control`,
      `Record ${environment} post-canary report handoff counts`,
    ].map((name) => deployWorkflow.indexOf(`      - name: ${name}`));
    assert.ok(
      orderedReleaseSteps.every((position, index) => position >= 0 && (index === 0 || position > orderedReleaseSteps[index - 1])),
      `${environment} must propagate closed, gate latency, run a bounded canary, prove residue and closure, then restore and count`,
    );

    const unverifiedFailClosed = workflowStep(deployWorkflow, `Disable ${environment} report handoff before unverified rollback`);
    assert.match(unverifiedFailClosed, /if: >-[\s\S]*steps\.version\.outcome == 'failure'/u, `${environment} ambiguous activation must disable report handoff before rollback`);
    assert.match(unverifiedFailClosed, /UPDATE report_handoff_controls SET enabled=0/u, `${environment} unverified rollback must leave the control disabled`);

    const failClosed = workflowStep(deployWorkflow, `Fail closed ${environment} report handoff before regression handling`);
    assert.match(failClosed, /steps\.current_main_db\.outcome == 'success'/u, `${environment} fail-closed handling must not mutate after a failed pre-database current-main guard`);
    assert.match(failClosed, /steps\.migrations\.outcome == 'success'/u, `${environment} report handoff failure handling may run only after a verified migration step`);
    assert.match(failClosed, /steps\.migration_drift_guard\.outcome == 'success'/u, `${environment} drift rejection must not reach the later always() control mutation`);
    assert.match(failClosed, /steps\.version\.outcome != 'success'/u, `${environment} report handoff must close after an unverified or skipped activation`);
    for (const gate of ["propagation", "readiness_latency", "canary", "residue", "handoff_reclosed", "handoff_restore", "handoff_counts"]) {
      assert.match(failClosed, new RegExp(`steps\\.${gate}\\.outcome != 'success'`, "u"), `${environment} report handoff must close when ${gate} is not successful`);
    }
    if (environment === "production") {
      assert.match(failClosed, /steps\.observe\.outcome != 'success'/u, "production report handoff must close unless the full monitor succeeds");
      assert.match(workflowStep(deployWorkflow, "Observe the exact production version for 30 minutes"), /if: steps\.handoff_counts\.outcome == 'success'/u, "production monitoring must follow handoff count evidence");
    }
    assert.match(failClosed, /UPDATE report_handoff_controls SET enabled=0/u, `${environment} regression handling must close report handoff before rollback or failure`);

    const regressionRollback = workflowStep(deployWorkflow, `Roll back a confirmed compatible ${environment} regression`);
    assert.ok(deployWorkflow.indexOf(`Fail closed ${environment} report handoff before regression handling`) < deployWorkflow.indexOf(`Roll back a confirmed compatible ${environment} regression`), `${environment} report handoff must close before compatible rollback`);
    assert.match(regressionRollback, /steps\.handoff_reclosed\.outcome == 'failure'/u, `${environment} closed-control proof failure must trigger compatible rollback`);
    assert.match(regressionRollback, /steps\.readiness_latency\.outcome == 'failure'/u, `${environment} latency failure must trigger compatible rollback`);
    assert.match(regressionRollback, /steps\.handoff_restore\.outcome == 'failure'/u, `${environment} restore proof failure must trigger compatible rollback`);
    assert.match(regressionRollback, /steps\.handoff_counts\.outcome == 'failure'/u, `${environment} bounded-count failure must trigger compatible rollback`);

    const finalFailure = workflowStep(
      deployWorkflow,
      environment === "staging"
        ? "Fail closed after a staging release regression"
        : "Fail closed after a production release or monitoring failure",
    );
    assert.match(finalFailure, /steps\.readiness_latency\.outcome == 'failure'/u, `${environment} latency failure must fail the release job`);

    const evidenceUpload = workflowStep(deployWorkflow, `Upload ${environment} release evidence`);
    assert.match(evidenceUpload, new RegExp(`path: release-evidence/${environment}`, "u"), `${environment} latency JSON must enter the environment evidence artifact`);
    assert.match(evidenceUpload, /retention-days:\s*30/u, `${environment} latency evidence must be retained for 30 days`);

    for (const rollback of ["unverified", "regression"]) {
      const rollbackVerification = workflowStep(
        deployWorkflow,
        `Verify the exact ${environment} version after ${rollback} rollback`,
      );
      assert.match(rollbackVerification, /LEGACY_WORKER_COMPAT:\s*"true"/u, `${environment} ${rollback} rollback must use legacy public smoke mode`);
      assert.match(rollbackVerification, /REPORT_HANDOFF_EXPECTED_ENABLED=false/u, `${environment} ${rollback} rollback must prove the control remains disabled`);
    }

    const cleanup = workflowStep(deployWorkflow, `Remove ${environment} backup material from the runner`);
    assert.match(cleanup, /if: always\(\)/u, `${environment} raw-evidence cleanup must be unconditional`);
    assert.match(cleanup, /rm -f --/u, `${environment} raw-evidence cleanup must remove temporary files`);
    for (const artifact of [
      "pre-migration-counts.json",
      "pre-migration-audit.json",
      "pre-migration-users.json",
      "pre-migration-sessions.json",
      "pre-migration-projects.json",
      "pre-migration-reports.json",
      "post-migration-counts.json",
      "post-migration-users.json",
      "post-migration-sessions.json",
      "post-migration-projects.json",
      "post-migration-reports.json",
      "post-migration-feedback-count.json",
      "post-migration-report-share-count.json",
      "post-migration-report-share-read-counter-count.json",
      "post-migration-report-share-create-counter-count.json",
      "post-migration-login-attempt-fence-count.json",
      "post-migration-report-handoff-control.json",
      "report-handoff-pre-activation-close.json",
      "report-handoff-canary-enable.json",
      "report-handoff-canary-reclose.json",
      "report-handoff-reclosed.json",
      "report-handoff-enable.json",
      "report-handoff-restore-failure-disable.json",
      "report-handoff-unverified-disable.json",
      "unverified-rollback-report-handoff-control.json",
      "report-handoff-failure-disable.json",
      "regression-rollback-report-handoff-control.json",
      "post-canary-report-handoff-counts.json",
      "rollback-residue.sql",
      "rollback-residue.json",
      "canary-residue.sql",
      "canary-residue.json",
      "canary-session-query.sql",
      "canary-session-before.json",
      "canary-session-observed.json",
      "canary-session-cleanup.sql",
      "canary-session-cleanup.json",
      "canary-session-final.json",
      "rollback-canary-session-query.sql",
      "rollback-canary-session-before.json",
      "rollback-canary-session-observed.json",
      "rollback-canary-session-cleanup.sql",
      "rollback-canary-session-cleanup.json",
      "rollback-canary-session-final.json",
    ]) {
      assert.match(
        cleanup,
        new RegExp(`\\$RUNNER_TEMP/${environment}-${artifact.replaceAll(".", "\\.")}`, "u"),
        `${environment} raw release evidence must be removed unconditionally: ${artifact}`,
      );
    }
  }
  assert.match(deployWorkflow, /unverified-deploy-rollback\.json/u, "ambiguous deployments must roll back and persist exact-version evidence");
  assert.match(deployWorkflow, /regression-rollback\.json/u, "regression rollbacks must persist exact-version evidence");
  assert.match(deployWorkflow, /npm run check:ops/u, "deployment must revalidate fail-closed configuration");
  assert.match(deployWorkflow, /npm run check:migrations/u, "deployment must validate the full local migration chain");
  assert.match(deployWorkflow, /check-migration-policy\.mjs/u, "privileged migration jobs must recheck the forward-only SQL policy");
  assert.match(deployWorkflow, /actions\/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093/u, "privileged jobs must restore the validated build on fresh runners");
  assert.match(deployWorkflow, /path:\s*\$\{\{ runner\.temp \}\}\/grihagrid-release-build/u, "validated builds must restore outside the candidate checkout");
  assert.match(deployWorkflow, /rm -rf -- "\$GITHUB_WORKSPACE\/dist"/u, "privileged jobs must remove candidate-controlled dist files before installing the validated build");
  assert.match(deployWorkflow, /npm install --global --ignore-scripts --no-audit --no-fund[\s\\]+--registry=https:\/\/registry\.npmjs\.org "wrangler@\$WRANGLER_VERSION"/u, "privileged jobs must use the public registry without candidate install hooks");
  assert.doesNotMatch(deployWorkflow, /PAID_CHECKOUT_ENABLED:\s*["']?true/u);
  assert.doesNotMatch(deployWorkflow, /DECISION_COMPARE_FULFILLMENT_ENABLED:\s*["']?true/u);

  return {
    productionOrigin: quotedVariable(production, "APP_ORIGIN"),
    stagingOrigin: quotedVariable(staging, "APP_ORIGIN"),
    paidDefaults: "closed",
  };
}

if (isDirectExecution()) {
  const result = await checkOpsConfig();
  process.stdout.write(`Operational configuration valid: ${JSON.stringify(result)}\n`);
}
