import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const files = Object.freeze({
  wrangler: new URL("../wrangler.toml", import.meta.url),
  package: new URL("../package.json", import.meta.url),
  gitignore: new URL("../.gitignore", import.meta.url),
  ci: new URL("../.github/workflows/ci.yml", import.meta.url),
  smokeWorkflow: new URL("../.github/workflows/production-smoke.yml", import.meta.url),
  deployWorkflow: new URL("../.github/workflows/deploy.yml", import.meta.url),
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

export async function checkOpsConfig() {
  const [wrangler, packageText, gitignore, ci, smokeWorkflow, deployWorkflow] = await Promise.all(
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
  assert.match(deployWorkflow, /workflow_dispatch'\s*&&\s*github\.ref\s*==\s*'refs\/heads\/main'/u, "manual releases must use the main workflow ref");
  assert.match(deployWorkflow, /manual releases must target the current main tip/u, "manual releases must reject historical main ancestors");
  assert.match(deployWorkflow, /fetch-depth:\s*0/u, "release ancestry must use complete history");
  assert.match(deployWorkflow, /dynamic\/github-code-scanning\/codeql/u, "release gate must verify the trusted CodeQL workflow identity");
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
  assert.match(deployWorkflow, /wait-for-release\.mjs/u, "releases must wait for consecutive exact-version smoke samples");
  assert.match(deployWorkflow, /Reconfirm the exact staging version/u, "production must reject staging drift after its hold");
  assert.match(deployWorkflow, /monitor-release\.mjs/u, "production must run exact-version monitoring");
  assert.match(deployWorkflow, /GRIHAGRID_MONITOR_WATCH_PIDS/u, "the public monitor must watch both exact-version tails");
  assert.match(deployWorkflow, /TAIL_PROCESS_GROUP="\$\$"/u, "a first tail event must terminate its supervised process group immediately");
  assert.match(deployWorkflow, /public_regression=/u, "public regression state must survive tail finalization errors");
  assert.match(deployWorkflow, /--version-id/u, "production error tail must be scoped to the deployed Worker version");
  assert.match(deployWorkflow, /tail-aggregate\.mjs/u, "tail payloads must be reduced to bounded aggregates");
  assert.doesNotMatch(deployWorkflow, /(?:invocation|server)-errors\.ndjson/u, "raw Worker tail payloads must never enter artifacts");
  assert.match(deployWorkflow, /steps\.migrations\.outputs\.pending == 'false'/u, "automatic Worker rollback must be migration-safe");
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

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const result = await checkOpsConfig();
  process.stdout.write(`Operational configuration valid: ${JSON.stringify(result)}\n`);
}
