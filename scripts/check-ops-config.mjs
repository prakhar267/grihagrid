import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const files = Object.freeze({
  wrangler: new URL("../wrangler.toml", import.meta.url),
  package: new URL("../package.json", import.meta.url),
  gitignore: new URL("../.gitignore", import.meta.url),
  ci: new URL("../.github/workflows/ci.yml", import.meta.url),
  smokeWorkflow: new URL("../.github/workflows/production-smoke.yml", import.meta.url),
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
  const [wrangler, packageText, gitignore, ci, smokeWorkflow] = await Promise.all(
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
  assert.equal(quotedVariable(production, "database_name"), "grihagrid-db");
  assert.equal(quotedVariable(production, "database_id"), "42a75a83-ab24-4e3f-93f1-b80c51284f1e");
  assert.match(staging, /database_name\s*=\s*"grihagrid-staging-db"/u);
  assert.match(staging, /database_id\s*=\s*"ac7ff387-c8c6-40d2-b9db-83078378c054"/u);
  assert.notEqual(
    quotedVariable(production, "database_id"),
    quotedVariable(staging, "database_id"),
    "staging and production D1 databases must differ",
  );
  assert.equal(quotedVariable(production, "id"), "c5044339222a4172ad7c91724b98d4fb");
  assert.equal(quotedVariable(staging, "id"), "f48c3f765bc84088a88376e887daf7b1");
  assert.notEqual(quotedVariable(production, "id"), quotedVariable(staging, "id"), "staging and production KV namespaces must differ");
  assert.match(staging, /\[\[env\.staging\.kv_namespaces\]\]/u);
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
  assert.match(
    packageJson.scripts?.["check:worker"] || "",
    /--env=(?:""|'')/u,
    "production Worker validation must explicitly target the top-level environment",
  );
  assert.match(ci, /npm run check:worker:staging/u, "CI must dry-run the isolated staging bundle");
  assert.match(ci, /npm run check:migrations/u, "CI must validate fresh D1 migrations");
  assert.match(ci, /npm audit --audit-level=high/u, "CI must fail on high-severity dependency findings");
  assert.match(smokeWorkflow, /cron:\s*"23 \* \* \* \*"/u, "public smoke must run hourly");
  assert.match(smokeWorkflow, /EXPECT_PAID_CHECKOUT:\s*"false"/u, "public smoke must expect checkout to remain closed");
  assert.doesNotMatch(smokeWorkflow, /permissions:\s*[\s\S]*?contents:\s*write/u, "read-only smoke may not request content writes");

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
