#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDirectory = path.join(root, "migrations");
const migrationPattern = /^(\d{4})_[a-z0-9_]+\.sql$/;
const migrations = readdirSync(migrationsDirectory)
  .filter((file) => file.endsWith(".sql"))
  .sort();

if (migrations.length === 0) {
  throw new Error("No D1 migrations found.");
}

let previousSequence = -1;
for (const migration of migrations) {
  const match = migration.match(migrationPattern);
  if (!match) {
    throw new Error(
      `Invalid migration filename: ${migration}. Expected NNNN_description.sql.`,
    );
  }

  const sequence = Number(match[1]);
  if (sequence <= previousSequence) {
    throw new Error(`Migration sequence is not strictly increasing at ${migration}.`);
  }
  previousSequence = sequence;
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
