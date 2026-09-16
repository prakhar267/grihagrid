#!/usr/bin/env node
// Core restore proof only. App route canaries require a separately reviewed,
// private runner bound solely to the clone, with every provider disabled.
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { verifyRequiredSchemaEvidence } from './release-db-evidence.mjs';

export const RESTORE_TABLES = Object.freeze([
  'users', 'projects', 'reports', 'ai_planning_briefs', 'ai_generation_counters',
  'ai_generation_leases', 'project_files', 'orders', 'payment_webhook_events',
  'payment_terminal_records', 'payment_reconciliation_cases', 'decision_comparisons',
  'purchased_decision_snapshots', 'decision_shares', 'decision_progress',
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA = /^[a-f0-9]{64}$/u;
const MAX_EXPORT_BYTES = 64 * 1024 * 1024;
const OBJECT_SQL = "SELECT type,name FROM sqlite_master WHERE type IN ('table','index','trigger') ORDER BY type,name";
const COLUMN_SQL = "SELECT m.name AS table_name,p.name FROM sqlite_master AS m,pragma_table_info(m.name) AS p WHERE m.type='table' ORDER BY m.name,p.name";
const sha256 = value => createHash('sha256').update(value).digest('hex');
const repoDefault = fileURLToPath(new URL('../', import.meta.url));
const exec = promisify(execFile);

function requireSafe(condition, code) {
  if (!condition) throw new Error(code);
}

export function configuredDatabases(toml) {
  const blocks = [...toml.matchAll(/\[\[(?:env\.[\w-]+\.)?d1_databases\]\]([\s\S]*?)(?=\n\[|$)/gu)];
  const databases = blocks.map(match => {
    const field = name => new RegExp(`^${name}\\s*=\\s*"([^"]+)"`, 'mu').exec(match[1])?.[1];
    return { id: field('database_id'), name: field('database_name'), binding: field('binding'), production: match[0].startsWith('[[d1_databases]]') };
  });
  requireSafe(databases.length >= 2 && databases.every(db => UUID.test(db.id || '') && db.name), 'configured_database_inventory_invalid');
  requireSafe(databases.filter(db => db.production && db.binding === 'DB').length === 1, 'production_database_binding_invalid');
  return databases;
}

export function databaseInventory(payload) {
  requireSafe(Array.isArray(payload), 'database_inventory_invalid');
  const result = payload.map(row => ({ id: row.uuid, name: row.name }));
  requireSafe(result.every(row => UUID.test(row.id || '') && typeof row.name === 'string'), 'database_inventory_invalid');
  requireSafe(new Set(result.map(row => row.id)).size === result.length, 'duplicate_database_identity');
  return result;
}

export function assertIsolatedClone({ clone, runId, existingDatabaseIds }, configured) {
  requireSafe(UUID.test(runId || '') && UUID.test(clone?.id || ''), 'clone_identity_invalid');
  const nameSuffix = runId.replaceAll('-', '').slice(0, 12);
  requireSafe(new RegExp(`^grihagrid-restore-drill-\\d{8}-${nameSuffix}$`, 'u').test(clone.name || ''), 'clone_name_invalid');
  requireSafe(Array.isArray(existingDatabaseIds) && existingDatabaseIds.every(id => UUID.test(id)), 'prior_inventory_invalid');
  requireSafe(!existingDatabaseIds.includes(clone.id), 'clone_was_not_new');
  requireSafe(!configured.some(db => db.id === clone.id || db.name === clone.name), 'configured_database_excluded');
}

function resultRows(payload) {
  requireSafe(Array.isArray(payload) && payload.length === 1 && payload[0]?.success === true
    && Array.isArray(payload[0].results), 'query_result_invalid');
  return payload[0].results;
}

function verifySchema(objects, columns) {
  const asPayload = results => [{ success: true, results }];
  return verifyRequiredSchemaEvidence({ schemaPayload: asPayload(objects), columnsPayload: asPayload(columns) });
}

function schemaSignature(objects, columns) {
  return sha256(JSON.stringify({
    objects: objects.filter(row => !isInternal(row.name))
      .map(row => `${row.type}:${row.name}`).sort(),
    columns: columns.filter(row => !isInternal(row.table_name))
      .map(row => `${row.table_name}:${row.name}`).sort(),
  }));
}

const isInternal = name => /^(?:sqlite_|_cf_)/iu.test(name);
const safeTable = name => typeof name === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/u.test(name);

export function applicationTables(objects) {
  const tables = objects.filter(row => row.type === 'table' && !isInternal(row.name)).map(row => row.name).sort();
  requireSafe(tables.length > 0 && tables.every(safeTable) && new Set(tables).size === tables.length, 'application_table_inventory_invalid');
  return tables;
}

function countSql(tables) {
  requireSafe(tables.every(safeTable), 'application_table_inventory_invalid');
  return tables.map(table => `SELECT '${table}' AS table_name,COUNT(*) AS row_count FROM "${table}"`).join(' UNION ALL ');
}

export function normalizeCounts(rows, tables = RESTORE_TABLES) {
  requireSafe(tables.every(safeTable) && new Set(tables).size === tables.length, 'aggregate_inventory_invalid');
  requireSafe(Array.isArray(rows) && rows.length === tables.length, 'aggregate_inventory_invalid');
  const counts = {};
  for (const row of rows) {
    requireSafe(tables.includes(row.table_name) && !Object.hasOwn(counts, row.table_name)
      && Number.isSafeInteger(row.row_count) && row.row_count >= 0, 'aggregate_count_invalid');
    counts[row.table_name] = row.row_count;
  }
  return Object.fromEntries(tables.map(table => [table, counts[table]]));
}

export function inspectLocalExport(sql) {
  requireSafe(typeof sql === 'string' && Buffer.byteLength(sql) <= MAX_EXPORT_BYTES, 'export_size_limit');
  const database = new DatabaseSync(':memory:');
  try {
    database.exec(sql);
    database.exec('PRAGMA query_only=ON');
    const integrity = database.prepare('PRAGMA integrity_check').all();
    requireSafe(integrity.length === 1 && integrity[0].integrity_check === 'ok', 'local_integrity_failed');
    requireSafe(database.prepare('PRAGMA foreign_key_check').all().length === 0, 'local_foreign_keys_failed');
    const objects = database.prepare(OBJECT_SQL).all(), columns = database.prepare(COLUMN_SQL).all();
    const tables = applicationTables(objects);
    return {
      schema: verifySchema(objects, columns), schemaSignature: schemaSignature(objects, columns),
      tables, counts: normalizeCounts(database.prepare(countSql(tables)).all(), tables), integrity: 'ok', foreignKeys: 'ok',
    };
  } finally {
    database.close();
  }
}

export function createWranglerRunner(repo = repoDefault, execute = exec) {
  return async (args, { json = false, timeout = 60_000 } = {}) => {
    try {
      const { stdout } = await execute(path.join(repo, 'node_modules/.bin/wrangler'), args, {
        cwd: repo, timeout, maxBuffer: 8 * 1024 * 1024,
        // Wrangler emits --json through its normal logger. Error-only logging
        // suppresses that result entirely, so capture normal stdout for JSON.
        env: { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG: json ? 'log' : 'error',
          WRANGLER_WRITE_LOGS: 'false', WRANGLER_LOG_SANITIZE: 'true' },
      });
      return json ? JSON.parse(stdout) : null;
    } catch {
      // Wrangler failures can contain SQL, credentials, or customer values.
      throw new Error('wrangler_operation_failed');
    }
  };
}

async function writePrivate(file, data) {
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  await chmod(file, 0o600);
}

function cloneConfig(clone) {
  return {
    name: clone.name, compatibility_date: '2026-08-01', workers_dev: false, preview_urls: false,
    d1_databases: [{ binding: 'DRILL_DB', database_name: clone.name, database_id: clone.id }],
  };
}

export function publicDrillSummary(evidence) {
  return {
    status: evidence.status, remoteRestore: evidence.remoteRestore,
    appRouteCanaries: 'not_run', fullGovernedDrill: false,
    capacity: evidence.capacity, checks: evidence.checks,
    failureCode: evidence.failureCode, plaintextRemoved: evidence.plaintextRemoved,
    cloneRetainedForIndependentReview: evidence.creationOutcome === 'unknown' ? null
      : Boolean(evidence.clone) && evidence.cleanup?.status !== 'deleted',
    creationOutcomeUnknown: evidence.creationOutcome === 'unknown',
    manualIdentityReconciliationRequired: evidence.creationOutcome === 'unknown',
  };
}

export async function runRemoteRestoreDrill({ directory, repo = repoDefault, run = createWranglerRunner(repo), now = () => new Date(), preflightOnly = false }) {
  const configPath = path.join(repo, 'wrangler.toml');
  const configSource = await readFile(configPath, 'utf8');
  const configured = configuredDatabases(configSource);
  const source = configured.find(db => db.production && db.binding === 'DB');
  directory = path.resolve(directory);
  await mkdir(directory, { mode: 0o700 }); // Existing directories are never reused.
  const evidencePath = path.join(directory, 'evidence.json');
  const exportPath = path.join(directory, 'production-export.sql');
  const controlPath = path.join(directory, 'control.wrangler.json');
  const clonePath = path.join(directory, 'clone.wrangler.json');
  const runId = randomUUID(), started = now();
  const evidence = {
    formatVersion: 1, runId, startedAt: started.toISOString(), source,
    status: 'running', remoteRestore: 'not_run', appRouteCanaries: 'not_run', fullGovernedDrill: false,
    checks: {}, cleanup: { status: 'not_requested' },
  };
  let phase = 'capacity';
  const persist = () => writePrivate(evidencePath, evidence);
  try {
    await writePrivate(controlPath, { name: `restore-control-${runId}`, compatibility_date: '2026-08-01', workers_dev: false, preview_urls: false });
    const inventory = databaseInventory(await run(['d1', 'list', '--json', '--config', configPath, '--env='], { json: true }));
    evidence.capacity = { databases: inventory.length, freePlanLimit: 10 };
    evidence.existingDatabaseIds = inventory.map(db => db.id);
    requireSafe(inventory.some(db => db.id === source.id && db.name === source.name), 'production_identity_not_found');
    if (inventory.length >= 10) {
      evidence.status = 'capacity_blocked';
      evidence.failureCode = 'free_database_capacity_reached';
      return evidence;
    }
    if (preflightOnly) {
      evidence.status = 'capacity_available';
      return evidence;
    }
    const name = `grihagrid-restore-drill-${started.toISOString().slice(0, 10).replaceAll('-', '')}-${runId.replaceAll('-', '').slice(0, 12)}`;
    requireSafe(!inventory.some(db => db.name === name), 'clone_name_already_exists');
    evidence.plannedCloneName = name;
    await persist();
    phase = 'create';
    evidence.creationOutcome = 'unknown';
    await persist();
    await run(['d1', 'create', name, '--config', controlPath, '--update-config=false']);
    const afterCreate = databaseInventory(await run(['d1', 'list', '--json', '--config', configPath, '--env='], { json: true }));
    const matches = afterCreate.filter(db => db.name === name);
    requireSafe(matches.length === 1, 'created_clone_identity_unresolved');
    evidence.clone = matches[0];
    assertIsolatedClone(evidence, configured);
    evidence.creationOutcome = 'confirmed';
    await writePrivate(clonePath, cloneConfig(evidence.clone));
    await persist();
    phase = 'export';
    // Customer data is exported only after capacity and exact clone identity pass.
    await writeFile(exportPath, '', { mode: 0o600, flag: 'wx' });
    await run(['d1', 'export', 'DB', '--remote', '--config', configPath, '--env=', '--skip-confirmation', '--output', exportPath], { timeout: 300_000 });
    await chmod(exportPath, 0o600);
    const info = await lstat(exportPath);
    requireSafe(info.isFile() && !info.isSymbolicLink() && (info.mode & 0o777) === 0o600
      && info.size > 0 && info.size <= MAX_EXPORT_BYTES, 'protected_export_invalid');
    const sql = await readFile(exportPath, 'utf8');
    evidence.export = { sha256: sha256(sql), bytes: info.size, permissions: '600', capturedAt: now().toISOString() };
    const local = inspectLocalExport(sql);
    evidence.checks.localIntegrity = local.integrity;
    evidence.checks.localForeignKeys = local.foreignKeys;
    evidence.checks.localSchema = local.schema;
    // Compare the remote clone to this same snapshot, never to a moving live DB.
    phase = 'import';
    assertIsolatedClone(evidence, configured);
    const importStarted = now();
    await run(['d1', 'execute', 'DRILL_DB', '--remote', '--config', clonePath, '--file', exportPath, '--yes'], { timeout: 600_000 });
    evidence.importElapsedMs = now().getTime() - importStarted.getTime();
    evidence.remoteRestore = 'imported';
    phase = 'verify';
    const query = async sqlText => resultRows(await run(['d1', 'execute', 'DRILL_DB', '--remote', '--config', clonePath, '--json', '--command', sqlText], { json: true }));
    const quick = await query('PRAGMA quick_check');
    requireSafe(quick.length === 1 && quick[0].quick_check === 'ok', 'remote_quick_check_failed');
    requireSafe((await query('PRAGMA foreign_key_check')).length === 0, 'remote_foreign_keys_failed');
    const objects = await query(OBJECT_SQL), columns = await query(COLUMN_SQL);
    const remoteSchema = verifySchema(objects, columns);
    requireSafe(schemaSignature(objects, columns) === local.schemaSignature, 'schema_inventory_mismatch');
    const tables = applicationTables(objects);
    requireSafe(JSON.stringify(tables) === JSON.stringify(local.tables), 'application_table_inventory_mismatch');
    const remoteCounts = normalizeCounts(await query(countSql(tables)), tables);
    requireSafe(JSON.stringify(remoteCounts) === JSON.stringify(local.counts), 'aggregate_parity_failed');
    requireSafe(await readFile(configPath, 'utf8') === configSource, 'production_configuration_changed');
    evidence.checks = { ...evidence.checks, remoteQuickCheck: 'ok', remoteForeignKeys: 'ok', remoteSchema,
      schemaInventoryParity: true, aggregateParity: true, aggregateCoverage: 'all_exported_application_tables',
      aggregateTables: tables, tablesCompared: tables.length, productionConfigurationUnchanged: true };
    evidence.remoteRestore = 'core_verified';
    evidence.status = 'core_verified_pending_app_canaries';
  } catch (error) {
    evidence.status = 'failed';
    evidence.failurePhase = phase;
    evidence.failureCode = /^[a-z_]+$/u.test(error?.message || '') ? error.message : 'restore_verification_failed';
  } finally {
    await rm(exportPath, { force: true });
    evidence.plaintextRemoved = true;
    evidence.finishedAt = now().toISOString();
    evidence.elapsedMs = now().getTime() - started.getTime();
    await persist();
  }
  return evidence;
}

export async function cleanupRemoteRestoreDrill({ evidencePath, expectedSha256, databaseId, databaseName, reviewedBy, repo = repoDefault, run = createWranglerRunner(repo) }) {
  requireSafe(SHA.test(expectedSha256 || '') && UUID.test(databaseId || ''), 'cleanup_confirmation_invalid');
  requireSafe(typeof reviewedBy === 'string' && /^[A-Za-z0-9_.@/-]{3,100}$/u.test(reviewedBy), 'independent_reviewer_required');
  const info = await lstat(evidencePath);
  requireSafe(info.isFile() && !info.isSymbolicLink() && (info.mode & 0o777) === 0o600, 'protected_evidence_required');
  const raw = await readFile(evidencePath);
  requireSafe(sha256(raw) === expectedSha256, 'reviewed_evidence_changed');
  const evidence = JSON.parse(raw.toString('utf8'));
  const configured = configuredDatabases(await readFile(path.join(repo, 'wrangler.toml'), 'utf8'));
  requireSafe(evidence.formatVersion === 1 && evidence.plaintextRemoved === true && evidence.cleanup?.status === 'not_requested', 'cleanup_evidence_invalid');
  assertIsolatedClone(evidence, configured);
  requireSafe(evidence.clone.id === databaseId && evidence.clone.name === databaseName, 'cleanup_identity_mismatch');
  const configPath = path.join(path.dirname(evidencePath), 'cleanup.wrangler.json');
  await writePrivate(configPath, cloneConfig(evidence.clone));
  const inventory = databaseInventory(await run(['d1', 'list', '--json', '--config', configPath], { json: true }));
  requireSafe(inventory.some(db => db.id === databaseId && db.name === databaseName), 'cleanup_remote_identity_mismatch');
  // Use a binding pinned to the reviewed UUID, never a name-only lookup.
  await run(['d1', 'delete', 'DRILL_DB', '--config', configPath, '--skip-confirmation']);
  const after = databaseInventory(await run(['d1', 'list', '--json', '--config', configPath], { json: true }));
  requireSafe(!after.some(db => db.id === databaseId), 'cleanup_remote_database_remains');
  evidence.cleanup = { status: 'deleted', reviewedBy, reviewedEvidenceSha256: expectedSha256, completedAt: new Date().toISOString(), exactIdentityVerified: true };
  await writePrivate(evidencePath, evidence);
  return { status: 'deleted', exactIdentityVerified: true, fullGovernedDrill: false, appRouteCanaries: 'not_run' };
}

function options(args) {
  requireSafe(args.length % 2 === 0, 'invalid_arguments');
  const parsed = {};
  for (let i = 0; i < args.length; i += 2) {
    requireSafe(/^--[a-z-]+$/u.test(args[i]) && !Object.hasOwn(parsed, args[i].slice(2)), 'invalid_arguments');
    parsed[args[i].slice(2)] = args[i + 1];
  }
  return parsed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [command, ...args] = process.argv.slice(2), opts = options(args);
    if (['run', 'preflight'].includes(command) && Object.keys(opts).join() === 'directory') {
      const evidence = await runRemoteRestoreDrill({ directory: opts.directory, preflightOnly: command === 'preflight' });
      console.log(JSON.stringify(publicDrillSummary(evidence)));
      if (!['core_verified_pending_app_canaries', 'capacity_available'].includes(evidence.status)) process.exitCode = 1;
    } else if (command === 'cleanup' && Object.keys(opts).sort().join() === 'database-id,database-name,evidence,expected-sha256,reviewed-by') {
      console.log(JSON.stringify(await cleanupRemoteRestoreDrill({ evidencePath: opts.evidence,
        expectedSha256: opts['expected-sha256'], databaseId: opts['database-id'], databaseName: opts['database-name'], reviewedBy: opts['reviewed-by'] })));
    } else throw new Error('usage_preflight_or_run_directory_or_cleanup_reviewed_exact_identity');
  } catch (error) {
    console.error(JSON.stringify({ status: 'failed', code: /^[a-z_]+$/u.test(error?.message || '') ? error.message : 'drill_failed' }));
    process.exitCode = 1;
  }
}
