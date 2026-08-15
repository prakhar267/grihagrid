#!/usr/bin/env node
import assert from "node:assert/strict";
import { appendFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const SHA_PATTERN = /^[a-f0-9]{40}$/u;

export function isDocumentationOnly(pathname) {
  return pathname === "AGENTS.md"
    || pathname === "README.md"
    || pathname.startsWith("docs/")
    || pathname.startsWith("design-references/")
    || pathname.startsWith(".artifacts/");
}

export function classifyReleaseFiles(files) {
  assert.ok(Array.isArray(files) && files.length > 0, "release diff must contain at least one file");
  const normalized = [...new Set(files.map((file) => String(file).trim()).filter(Boolean))].sort();
  assert.ok(normalized.length > 0, "release diff must contain at least one non-empty file");
  return {
    files: normalized,
    deploy: normalized.some((file) => !isDocumentationOnly(file)),
    migrations: normalized.some((file) => /^migrations\/\d{4}_[a-z0-9_]+\.sql$/u.test(file)),
  };
}

export function changedFiles(baseSha, releaseSha, cwd) {
  assert.match(baseSha, SHA_PATTERN, "base SHA must be a full lowercase commit SHA");
  assert.match(releaseSha, SHA_PATTERN, "release SHA must be a full lowercase commit SHA");
  const result = spawnSync(
    "git",
    ["diff", "--name-only", "--no-renames", "-z", baseSha, releaseSha],
    { cwd, encoding: "utf8" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.trim() || "git diff failed");
  return result.stdout.split("\0").filter(Boolean);
}

async function main() {
  const [baseSha, releaseSha] = process.argv.slice(2);
  const result = classifyReleaseFiles(changedFiles(baseSha, releaseSha));
  const summary = {
    baseSha,
    releaseSha,
    deploy: result.deploy,
    migrations: result.migrations,
    files: result.files,
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `deploy=${String(result.deploy)}\nmigrations=${String(result.migrations)}\n`,
      "utf8",
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
