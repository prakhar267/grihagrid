#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertSafeMigrationFiles, selectPolicyMigrationNames } from "./check-migration-policy.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDirectory = path.join(root, "migrations");
const migrations = readdirSync(migrationsDirectory)
  .filter((file) => file.endsWith(".sql"))
  .sort();

// Exact baseline names are trusted; new low-numbered files cannot bypass the
// policy by borrowing a pre-0013 sequence.
const policyMigrations = selectPolicyMigrationNames(migrations);
if (policyMigrations.length > 0) {
  assertSafeMigrationFiles(policyMigrations.map((migration) => path.join(migrationsDirectory, migration)));
}

const stateDirectory = mkdtempSync(path.join(os.tmpdir(), "grihagrid-d1-check-"));
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

try {
  const result = spawnSync(
    npx,
    [
      "--no-install",
      "wrangler",
      "d1",
      "migrations",
      "apply",
      "grihagrid-db",
      "--local",
      "--persist-to",
      stateDirectory,
    ],
    {
      cwd: root,
      env: { ...process.env, CI: "true" },
      stdio: "inherit",
    },
  );

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`D1 migration validation failed with exit code ${result.status}.`);
  }

  console.log(`Validated ${migrations.length} migration(s) on a fresh local D1 database.`);
} finally {
  rmSync(stateDirectory, { force: true, recursive: true });
}
