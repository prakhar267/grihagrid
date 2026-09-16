import { verifyRequiredSchemaEvidence } from "./release-db-evidence.mjs";

// Inspect only SQLite's schema metadata. Never read customer rows, credential
// records or table counts into the public backup manifest.
export function verifyBackupRestoreSchema(database) {
  const objects = database.prepare(
    "SELECT type,name FROM sqlite_master WHERE type IN ('table','index','trigger')",
  ).all();
  const columns = database.prepare(
    `SELECT m.name AS table_name,p.name
       FROM sqlite_master AS m,pragma_table_info(m.name) AS p
      WHERE m.type='table'`,
  ).all();
  const result = verifyRequiredSchemaEvidence({
    schemaPayload: [{ success: true, results: objects }],
    columnsPayload: [{ success: true, results: columns }],
  });
  return { schema: "current", ...result };
}
