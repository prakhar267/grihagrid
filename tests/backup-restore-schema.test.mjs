import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { verifyBackupRestoreSchema } from "../scripts/verify-backup-restore.mjs";

function restoredFixture(t) {
  const database = new DatabaseSync(":memory:");
  t.after(() => database.close());
  const migrations = new URL("../migrations/", import.meta.url);
  for (const name of readdirSync(migrations).filter(name => name.endsWith(".sql")).sort()) {
    database.exec(readFileSync(new URL(name, migrations), "utf8"));
  }
  return database;
}

test("restore evidence checks the current migration schema using metadata only", t => {
  const database = restoredFixture(t);
  database.exec("PRAGMA query_only=ON");
  const evidence = verifyBackupRestoreSchema(database);
  assert.equal(evidence.schema, "current");
  assert.ok(evidence.requiredSchemaObjectsVerified > 50);
  assert.ok(evidence.requiredColumnsVerified > 100);
  assert.deepEqual(Object.keys(evidence).sort(), ["requiredColumnsVerified", "requiredSchemaObjectsVerified", "schema"]);
});

for (const [description, mutation, expected] of [
  ["immutable trigger", "DROP TRIGGER spatial_cameras_immutable", /required schema object is missing: trigger:spatial_cameras_immutable/],
  ["ownership index", "DROP INDEX idx_projects_user_creation_key", /required schema object is missing: index:idx_projects_user_creation_key/],
  ["account table", "DROP TABLE login_attempt_fences", /required schema object is missing: table:login_attempt_fences/],
  ["account column", "ALTER TABLE users DROP COLUMN email_verified_at", /required schema column is missing: users:email_verified_at/],
]) {
  test(`SQLite integrity alone cannot accept a backup missing an ${description}`, t => {
    const database = restoredFixture(t);
    database.exec(mutation);
    assert.equal(database.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    assert.throws(() => verifyBackupRestoreSchema(database), expected);
  });
}


test("private receiver accepts evidence from every current migration and rejects schema drift", t => {
  const evidence = verifyBackupRestoreSchema(restoredFixture(t));
  const receiver = readFileSync(new URL("../ops/backup-vault/receive_backup.py", import.meta.url), "utf8");
  const objects = Number(receiver.match(/^REQUIRED_SCHEMA_OBJECTS = (\d+)$/m)?.[1]);
  const columns = Number(receiver.match(/^REQUIRED_SCHEMA_COLUMNS = (\d+)$/m)?.[1]);
  assert.equal(objects, evidence.requiredSchemaObjectsVerified, "review the private receiver after required schema changes");
  assert.equal(columns, evidence.requiredColumnsVerified, "review the private receiver after required column changes");
});
