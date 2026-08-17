import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertSafeMigrationFiles,
  scanMigrationSql,
  selectPolicyMigrationNames,
  TRUSTED_POLICY_BASELINE,
} from "../scripts/check-migration-policy.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const command = path.join(root, "scripts", "check-migration-policy.mjs");

test("automatic migration policy allows additive SQL and ignores quoted or commented policy words", () => {
  const sql = `
    -- DELETE FROM projects is documentation, not executable SQL.
    /* DROP TABLE users; */
    CREATE TABLE project_notes (
      id TEXT PRIMARY KEY,
      description TEXT NOT NULL DEFAULT 'UPDATE projects is not executable here'
    );
    ALTER TABLE projects
      ADD COLUMN planning_note TEXT;
    CREATE INDEX idx_project_notes_id ON project_notes(id);
    INSERT INTO project_notes (id, description) VALUES ('safe', 'REPLACE INTO');
    SELECT "DROP", [DELETE], \`UPDATE\` FROM project_notes;
    CREATE TRIGGER project_notes_immutable_update BEFORE UPDATE ON project_notes
      BEGIN SELECT RAISE(ABORT, 'immutable'); END;
    CREATE TRIGGER project_notes_immutable_delete BEFORE DELETE ON project_notes
      BEGIN SELECT RAISE(ABORT, 'immutable'); END;
  `;

  assert.deepEqual(scanMigrationSql(sql, "0013_additive.sql"), []);
});

test("automatic migration policy rejects multiline and comment-obfuscated destructive SQL", () => {
  const cases = [
    ["DELETE\nFROM users;", "delete"],
    ["DROP\nTABLE users;", "drop"],
    ["DROP/* reviewed elsewhere */TABLE users;", "drop"],
    ["ALTER TABLE users\n/* incompatible */ RENAME COLUMN email TO login;", "alter-table-rename"],
    ["UPDATE/* no whitespace needed */users SET email = 'x';", "update"],
    ["INSERT OR/* conflict policy */REPLACE INTO users(id) VALUES ('x');", "replace"],
    ["PRAGMA main./* bypass */writable_schema = ON;", "writable-schema"],
    ["PRAGMA 'writable_schema' = ON;", "writable-schema"],
    ["ATTACH/* external */DATABASE 'other.db' AS other;", "attach"],
    ["DETACH DATABASE other;", "detach"],
    ["VACUUM/* copy */INTO 'copy.db';", "vacuum-into"],
    ["TRUNCATE\nTABLE users;", "truncate"],
  ];

  for (const [sql, code] of cases) {
    const violations = scanMigrationSql(sql, "0013_unsafe.sql");
    assert.equal(violations.length, 1, sql);
    assert.equal(violations[0].code, code, sql);
    assert.ok(violations[0].line > 0, sql);
    assert.ok(violations[0].column > 0, sql);
  }
});

test("automatic migration policy fails closed on unterminated comments and quoted tokens", () => {
  assert.throws(
    () => scanMigrationSql("CREATE TABLE safe (id TEXT); /*", "0013_comment.sql"),
    /0013_comment\.sql:1:30: unterminated SQL block comment/u,
  );
  assert.throws(
    () => scanMigrationSql("SELECT 'unfinished", "0013_quote.sql"),
    /0013_quote\.sql:1:8: unterminated ' quoted SQL token/u,
  );
});

test("only the exact reviewed 0012-and-earlier baseline bypasses automatic SQL policy", () => {
  assert.deepEqual(selectPolicyMigrationNames([...TRUSTED_POLICY_BASELINE]), []);
  assert.deepEqual(
    selectPolicyMigrationNames([...TRUSTED_POLICY_BASELINE, "0013_additive_notes.sql"]),
    ["0013_additive_notes.sql"],
  );
  assert.throws(
    () => selectPolicyMigrationNames(["0000_policy_bypass.sql", ...TRUSTED_POLICY_BASELINE]),
    /Unrecognized pre-policy migration/u,
  );
  assert.throws(
    () => selectPolicyMigrationNames(TRUSTED_POLICY_BASELINE.slice(1)),
    /Trusted migration baseline is incomplete/u,
  );
});

test("migration policy CLI checks an explicit file set or newline-delimited list", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "grihagrid-migration-policy-"));
  try {
    const safe = path.join(directory, "0013_safe.sql");
    const unsafe = path.join(directory, "0014_unsafe.sql");
    const list = path.join(directory, "pending.txt");
    writeFileSync(safe, "ALTER TABLE projects ADD COLUMN safe_note TEXT;\n", "utf8");
    writeFileSync(unsafe, "DELETE\n/* bypass */ FROM projects;\n", "utf8");
    writeFileSync(list, `${safe}\n${unsafe}\n`, "utf8");

    assert.deepEqual(assertSafeMigrationFiles([safe]), { filesChecked: 1 });

    const direct = spawnSync(process.execPath, [command, safe], { encoding: "utf8" });
    assert.equal(direct.status, 0, direct.stderr);
    assert.match(direct.stdout, /passed for 1 file/u);

    const listed = spawnSync(process.execPath, [command, "--files-from", list], { encoding: "utf8" });
    assert.equal(listed.status, 1);
    assert.match(listed.stderr, /0014_unsafe\.sql:1:1/u);
    assert.match(listed.stderr, /DELETE statements are not allowed/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("migration policy CLI executes through a symlinked script directory", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "grihagrid-migration-policy-cli-"));
  const scriptAlias = path.join(directory, "scripts-alias");
  const safe = path.join(directory, "0013_safe.sql");
  try {
    symlinkSync(path.dirname(command), scriptAlias, process.platform === "win32" ? "junction" : "dir");
    writeFileSync(safe, "ALTER TABLE projects ADD COLUMN safe_note TEXT;\n", "utf8");
    const result = spawnSync(process.execPath, [path.join(scriptAlias, path.basename(command)), safe], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.signal, null);
    assert.match(result.stdout, /passed for 1 file/u);
    assert.equal(result.stderr, "");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("migration policy rejects a symlinked migration even when its targets are regular files", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "grihagrid-migration-policy-link-"));
  const safe = path.join(directory, "0018_safe.sql");
  const unsafe = path.join(directory, "0018_unsafe.sql");
  const linked = path.join(directory, "0018_link.sql");
  try {
    writeFileSync(safe, "ALTER TABLE projects ADD COLUMN safe_note TEXT;\n", "utf8");
    writeFileSync(unsafe, "DROP TABLE projects;\n", "utf8");
    symlinkSync(safe, linked, "file");
    assert.throws(
      () => assertSafeMigrationFiles([linked]),
      /regular non-symlink file/u,
    );
    rmSync(linked);
    symlinkSync(unsafe, linked, "file");
    assert.throws(
      () => assertSafeMigrationFiles([linked]),
      /regular non-symlink file/u,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("portable migration fallback mirrors Wrangler directory-entry filtering", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "grihagrid-migration-policy-portable-"));
  const safe = path.join(directory, "0018_safe.sql");
  const linked = path.join(directory, "0018_link.sql");
  try {
    writeFileSync(safe, "ALTER TABLE projects ADD COLUMN safe_note TEXT;\n", "utf8");
    assert.deepEqual(
      assertSafeMigrationFiles([safe], { forcePortableFallback: true }),
      { filesChecked: 1 },
    );
    symlinkSync(safe, linked, "file");
    assert.throws(
      () => assertSafeMigrationFiles([linked], { forcePortableFallback: true }),
      /regular non-symlink file/u,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("migration policy entrypoint resolution fails closed without leaking paths", () => {
  const missingEntrypoint = path.join(os.tmpdir(), "grihagrid-migration-entrypoint-does-not-exist.mjs");
  const result = spawnSync(process.execPath, [
    "--input-type=module",
    "--eval",
    `process.argv[1] = ${JSON.stringify(missingEntrypoint)}; await import(${JSON.stringify(pathToFileURL(command).href)});`,
  ], { encoding: "utf8" });

  assert.equal(result.status, 1);
  assert.equal(result.signal, null);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "automatic migration policy failed during entrypoint resolution\n");
  assert.equal(result.stderr.includes(missingEntrypoint), false);
});
