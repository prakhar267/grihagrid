import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, chmod, mkdtemp, open, readFile, readdir, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import {
  RESTORE_TABLES, applicationTables, assertIsolatedClone, cleanupRemoteRestoreDrill, configuredDatabases,
  createWranglerRunner, inspectLocalExport, normalizeCounts, publicDrillSummary, readProtectedFile, runRemoteRestoreDrill,
} from '../scripts/remote-restore-drill.mjs';

const repo = path.resolve(new URL('../', import.meta.url).pathname);
const config = configuredDatabases(await readFile(path.join(repo, 'wrangler.toml'), 'utf8'));
const inventory = config.map(db => ({ uuid: db.id, name: db.name }));
const cloneId = '977b311b-d70e-4840-ae77-0f2da7a2f691';
const migrationNames = (await readdir(path.join(repo, 'migrations'))).filter(name => name.endsWith('.sql')).sort();
const fixtureSql = (await Promise.all(migrationNames.map(name => readFile(path.join(repo, 'migrations', name), 'utf8')))).join('\n')
  + "\nINSERT INTO users(id,email,name) VALUES ('private-fixture-user','private-customer@example.test','Private fixture');\n";
const payload = results => [{ success: true, results }];
const hash = value => createHash('sha256').update(value).digest('hex');

async function fixture(t, { full = false, failure, countsMismatch = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'grihagrid-restore-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'drill');
  const database = new DatabaseSync(':memory:');
  database.exec(fixtureSql);
  t.after(() => database.close());
  const calls = [];
  const existing = [...inventory];
  if (full) while (existing.length < 10) {
    existing.push({ uuid: `11111111-1111-4111-8111-${String(existing.length).padStart(12, '0')}`, name: `existing-${existing.length}` });
  }
  let clone = null, deleted = false;
  const run = async args => {
    calls.push(args);
    if (args[1] === 'list') return [...existing, ...(clone && !deleted ? [clone] : [])];
    if (args[1] === 'create') {
      assert.equal(args.includes('--update-config=false'), true);
      assert.ok(args[2].length <= 63);
      clone = { uuid: cloneId, name: args[2] };
      return null;
    }
    if (args[1] === 'export') {
      await writeFile(args[args.indexOf('--output') + 1], fixtureSql);
      return null;
    }
    if (args[1] === 'execute') {
      const target = JSON.parse(await readFile(args[args.indexOf('--config') + 1], 'utf8'));
      assert.equal(target.d1_databases[0].database_id, cloneId);
      assert.equal(target.workers_dev, false);
      assert.equal(target.preview_urls, false);
      assert.equal(target.d1_databases.length, 1);
      if (args.includes('--file')) {
        if (failure === 'import') throw new Error('private-customer@example.test signed_url=private-secret');
        return null;
      }
      const sql = args[args.indexOf('--command') + 1];
      if (failure === 'foreign_keys' && sql === 'PRAGMA foreign_key_check') return payload([{ table: 'private-table', rowid: 999 }]);
      if (failure === 'quick_check' && sql === 'PRAGMA quick_check') return payload([{ quick_check: 'private internal detail' }]);
      const rows = database.prepare(sql).all().map(row => ({ ...row }));
      if (countsMismatch && sql.includes('row_count')) rows.find(row => row.table_name === 'users').row_count += 1;
      return payload(rows);
    }
    if (args[1] === 'delete') {
      const target = JSON.parse(await readFile(args[args.indexOf('--config') + 1], 'utf8'));
      assert.equal(args[2], 'DRILL_DB');
      assert.equal(target.d1_databases[0].database_id, cloneId);
      deleted = true;
      return null;
    }
    throw new Error('unexpected_test_command');
  };
  return { directory, calls, run, database };
}

test('capacity blocks before export, creation, or customer data access', async t => {
  const f = await fixture(t, { full: true });
  const evidence = await runRemoteRestoreDrill({ directory: f.directory, repo, run: f.run });
  assert.equal(evidence.status, 'capacity_blocked');
  assert.equal(evidence.remoteRestore, 'not_run');
  assert.equal(evidence.appRouteCanaries, 'not_run');
  assert.equal(evidence.fullGovernedDrill, false);
  assert.deepEqual(f.calls.map(args => args.slice(0, 2)), [['d1', 'list']]);
  await assert.rejects(access(path.join(f.directory, 'production-export.sql')));
  assert.equal((await stat(f.directory)).mode & 0o777, 0o700);
  assert.equal((await stat(path.join(f.directory, 'evidence.json'))).mode & 0o777, 0o600);
});

test('explicit preflight never creates or exports even when capacity is available', async t => {
  const f = await fixture(t);
  const evidence = await runRemoteRestoreDrill({ directory: f.directory, repo, run: f.run, preflightOnly: true });
  assert.equal(evidence.status, 'capacity_available');
  assert.equal(evidence.remoteRestore, 'not_run');
  assert.equal(evidence.clone, undefined);
  assert.deepEqual(f.calls.map(args => args.slice(0, 2)), [['d1', 'list']]);
});

test('core restores only into a new pinned clone and compares the same snapshot without claiming route canaries', async t => {
  const f = await fixture(t);
  const evidence = await runRemoteRestoreDrill({ directory: f.directory, repo, run: f.run });
  assert.equal(evidence.status, 'core_verified_pending_app_canaries');
  assert.equal(evidence.remoteRestore, 'core_verified');
  assert.equal(evidence.appRouteCanaries, 'not_run');
  assert.equal(evidence.fullGovernedDrill, false);
  assert.equal(evidence.checks.aggregateParity, true);
  assert.ok(evidence.checks.tablesCompared > RESTORE_TABLES.length);
  for (const table of ['spatial_revisions', 'spatial_tour_revisions', 'spatial_camera_revisions', 'sessions', 'account_deletion_receipts']) {
    assert.ok(evidence.checks.aggregateTables.includes(table));
  }
  assert.equal(evidence.checks.aggregateCoverage, 'all_exported_application_tables');
  assert.equal(evidence.checks.localIntegrity, 'ok');
  assert.equal(evidence.checks.remoteQuickCheck, 'ok');
  assert.equal(evidence.checks.remoteForeignKeys, 'ok');
  assert.equal(f.calls.some(args => ['deploy', 'dev', 'delete'].includes(args[1])), false);
  assert.equal(f.calls.filter(args => args[1] === 'export').length, 1);
  assert.equal(evidence.plaintextRemoved, true);
  await assert.rejects(access(path.join(f.directory, 'production-export.sql')));
  for (const text of [JSON.stringify(publicDrillSummary(evidence)), await readFile(path.join(f.directory, 'evidence.json'), 'utf8')]) {
    assert.equal(text.includes('private-customer'), false);
    assert.equal(text.includes('private-fixture-user'), false);
    assert.equal(text.includes('row_count'), false);
  }
});

for (const failure of ['import', 'foreign_keys', 'quick_check', 'counts']) {
  test(`failed ${failure} retains the clone for review but always removes plaintext and redacts failure detail`, async t => {
    const f = await fixture(t, { failure, countsMismatch: failure === 'counts' });
    const evidence = await runRemoteRestoreDrill({ directory: f.directory, repo, run: f.run });
    assert.equal(evidence.status, 'failed');
    assert.equal(evidence.clone.id, cloneId);
    assert.equal(evidence.plaintextRemoved, true);
    assert.equal(f.calls.some(args => args[1] === 'delete'), false);
    await assert.rejects(access(path.join(f.directory, 'production-export.sql')));
    const summary = JSON.stringify(publicDrillSummary(evidence));
    assert.equal(summary.includes('private'), false);
    assert.equal(summary.includes('signed_url'), false);
  });
}

test('required schema and strict aggregate inventory reject false restore evidence', () => {
  const result = inspectLocalExport(fixtureSql);
  assert.equal(result.counts.users, 1);
  assert.ok(result.schema.requiredSchemaObjectsVerified > 50);
  assert.throws(() => inspectLocalExport(fixtureSql + '\nDROP TRIGGER spatial_cameras_immutable;'), /required schema object/);
  assert.throws(() => normalizeCounts(RESTORE_TABLES.map(table_name => ({ table_name, row_count: -1 }))), /aggregate_count_invalid/);
  assert.throws(() => normalizeCounts(RESTORE_TABLES.map(() => ({ table_name: 'users', row_count: 1 }))), /aggregate_count_invalid/);
  assert.throws(() => applicationTables([{ type: 'table', name: 'unsafe";DROP TABLE users;--' }]), /application_table_inventory_invalid/);
  assert.deepEqual(applicationTables([{ type: 'table', name: 'users' }, { type: 'table', name: '_cf_METADATA' }, { type: 'table', name: 'sqlite_sequence' }]), ['users']);
});

test('ambiguous create failure requires manual identity reconciliation and never implies no clone exists', async t => {
  const f = await fixture(t);
  const evidence = await runRemoteRestoreDrill({
    directory: f.directory, repo,
    run: async args => {
      if (args[1] === 'create') throw new Error('wrangler_operation_failed');
      return f.run(args);
    },
  });
  assert.equal(evidence.status, 'failed');
  assert.equal(evidence.creationOutcome, 'unknown');
  assert.ok(evidence.plannedCloneName.startsWith('grihagrid-restore-drill-'));
  assert.equal(publicDrillSummary(evidence).manualIdentityReconciliationRequired, true);
  assert.equal(publicDrillSummary(evidence).cloneRetainedForIndependentReview, null);
  assert.equal(f.calls.some(args => ['export', 'delete'].includes(args[1])), false);
});

test('production, staging and pre-existing UUIDs are excluded even when the clone name looks safe', () => {
  const runId = '11111111-1111-4111-8111-111111111111';
  const evidence = { runId, clone: { id: cloneId, name: 'grihagrid-restore-drill-20260917-111111111111' }, existingDatabaseIds: [] };
  assert.doesNotThrow(() => assertIsolatedClone(evidence, config));
  for (const db of config) assert.throws(() => assertIsolatedClone({ ...evidence, clone: { ...evidence.clone, id: db.id } }, config), /configured_database_excluded/);
  assert.throws(() => assertIsolatedClone({ ...evidence, existingDatabaseIds: [cloneId] }, config), /clone_was_not_new/);
  assert.throws(() => assertIsolatedClone({ ...evidence, clone: { ...evidence.clone, name: 'unrelated-database' } }, config), /clone_name_invalid/);
});

test('cleanup requires reviewed evidence hash, matching identity and an independent reviewer declaration', async t => {
  const f = await fixture(t);
  const evidence = await runRemoteRestoreDrill({ directory: f.directory, repo, run: f.run });
  const evidencePath = path.join(f.directory, 'evidence.json');
  const raw = await readFile(evidencePath);
  const params = { evidencePath, expectedSha256: hash(raw), databaseId: evidence.clone.id, databaseName: evidence.clone.name, reviewedBy: 'independent-reviewer', repo, run: f.run };
  const before = f.calls.length;
  await assert.rejects(cleanupRemoteRestoreDrill({ ...params, expectedSha256: 'a'.repeat(64) }), /reviewed_evidence_changed/);
  await assert.rejects(cleanupRemoteRestoreDrill({ ...params, databaseName: 'other' }), /cleanup_identity_mismatch/);
  await assert.rejects(cleanupRemoteRestoreDrill({ ...params, reviewedBy: '' }), /independent_reviewer_required/);
  assert.equal(f.calls.length, before);
  const result = await cleanupRemoteRestoreDrill(params);
  assert.equal(result.status, 'deleted');
  assert.equal(result.fullGovernedDrill, false);
  assert.deepEqual(f.calls.slice(before).map(args => args[1]), ['list', 'delete', 'list']);
  const cleaned = JSON.parse(await readFile(evidencePath, 'utf8'));
  assert.equal(cleaned.cleanup.status, 'deleted');
  assert.equal(cleaned.cleanup.reviewedEvidenceSha256, hash(raw));
});

test('cleanup rejects a replaced name and never deletes a different remote UUID', async t => {
  const f = await fixture(t);
  const evidence = await runRemoteRestoreDrill({ directory: f.directory, repo, run: f.run });
  const evidencePath = path.join(f.directory, 'evidence.json');
  const before = f.calls.length;
  await assert.rejects(cleanupRemoteRestoreDrill({
    evidencePath, expectedSha256: hash(await readFile(evidencePath)), databaseId: evidence.clone.id,
    databaseName: evidence.clone.name, reviewedBy: 'reviewer', repo,
    run: async args => { assert.equal(args[1], 'list'); return [...inventory, { uuid: '21111111-1111-4111-8111-111111111111', name: evidence.clone.name }]; },
  }), /cleanup_remote_identity_mismatch/);
  assert.equal(f.calls.length, before);
});

test('a symlink substituted for an export is rejected before import without changing its target', async t => {
  const f = await fixture(t);
  const target = path.join(path.dirname(f.directory), 'untouched.sql');
  await writeFile(target, fixtureSql, { mode: 0o644 });
  const evidence = await runRemoteRestoreDrill({
    directory: f.directory, repo,
    run: async args => {
      const result = await f.run(args);
      if (args[1] === 'export') {
        const output = args[args.indexOf('--output') + 1];
        await rm(output);
        await symlink(target, output);
      }
      return result;
    },
  });
  assert.equal(evidence.status, 'failed');
  assert.equal(evidence.failureCode, 'protected_export_invalid');
  assert.equal(evidence.failurePhase, 'export');
  assert.equal(f.calls.some(args => args[1] === 'execute'), false);
  assert.equal(await readFile(target, 'utf8'), fixtureSql);
  assert.equal((await stat(target)).mode & 0o777, 0o644);
  await assert.rejects(access(path.join(f.directory, 'production-export.sql')));
});

test('cleanup rejects symlink evidence even when its target has the reviewed hash and permissions', async t => {
  const f = await fixture(t);
  const evidence = await runRemoteRestoreDrill({ directory: f.directory, repo, run: f.run });
  const evidencePath = path.join(f.directory, 'evidence.json');
  const target = path.join(f.directory, 'reviewed-target.json');
  const raw = await readFile(evidencePath);
  await rename(evidencePath, target);
  await symlink(target, evidencePath);
  const before = f.calls.length;
  await assert.rejects(cleanupRemoteRestoreDrill({
    evidencePath, expectedSha256: hash(raw), databaseId: evidence.clone.id,
    databaseName: evidence.clone.name, reviewedBy: 'reviewer', repo, run: f.run,
  }), /protected_evidence_required/);
  assert.equal(f.calls.length, before);
  assert.deepEqual(await readFile(target), raw);
  assert.equal((await stat(target)).mode & 0o777, 0o600);
});

test('cleanup rejects replacement evidence before making any remote call', async t => {
  const f = await fixture(t);
  const evidence = await runRemoteRestoreDrill({ directory: f.directory, repo, run: f.run });
  const evidencePath = path.join(f.directory, 'evidence.json');
  const raw = await readFile(evidencePath);
  await rename(evidencePath, path.join(f.directory, 'original.json'));
  await writeFile(evidencePath, JSON.stringify({ ...evidence, clone: { ...evidence.clone, id: '21111111-1111-4111-8111-111111111111' } }), { mode: 0o600 });
  const before = f.calls.length;
  await assert.rejects(cleanupRemoteRestoreDrill({
    evidencePath, expectedSha256: hash(raw), databaseId: evidence.clone.id,
    databaseName: evidence.clone.name, reviewedBy: 'reviewer', repo, run: f.run,
  }), /reviewed_evidence_changed/);
  assert.equal(f.calls.length, before);
});

test('protected reads keep the inspected descriptor when the pathname is replaced after opening', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'grihagrid-protected-read-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'evidence.json');
  await writeFile(file, 'reviewed original', { mode: 0o600 });
  const probe = await open(file, 'r');
  const prototype = Object.getPrototypeOf(probe), originalStat = prototype.stat;
  await probe.close();
  let inspected;
  t.mock.method(prototype, 'stat', async function (...args) {
    const info = await originalStat.apply(this, args);
    if (info.isFile() && !inspected) {
      inspected = this;
      await rename(file, path.join(directory, 'original.json'));
      await writeFile(file, 'unreviewed replacement', { mode: 0o600 });
    }
    return info;
  });
  const raw = await readProtectedFile(file, { maxBytes: 1024, failureCode: 'protected_test_invalid' });
  assert.equal(raw.toString(), 'reviewed original');
  assert.equal(inspected.fd, -1, 'the original descriptor is closed after reading');
});

test('protected reads reject symlink or nonprivate directory boundaries', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'grihagrid-read-boundary-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'evidence.json');
  const alias = `${directory}-link`;
  t.after(() => rm(alias, { force: true }));
  await writeFile(file, 'reviewed original', { mode: 0o600 });
  await symlink(directory, alias);
  const options = { maxBytes: 1024, failureCode: 'protected_test_invalid' };
  await assert.rejects(readProtectedFile(path.join(alias, 'evidence.json'), options), /protected_test_invalid/);
  await chmod(directory, 0o755);
  await assert.rejects(readProtectedFile(file, options), /protected_test_invalid/);
  assert.equal(await readFile(file, 'utf8'), 'reviewed original');
});

test('protected reads close file and directory descriptors after a failed read without exposing the error', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'grihagrid-read-failure-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'evidence.json');
  await writeFile(file, 'reviewed original', { mode: 0o600 });
  const probe = await open(file, 'r');
  const prototype = Object.getPrototypeOf(probe), originalStat = prototype.stat;
  await probe.close();
  const inspected = [];
  t.mock.method(prototype, 'stat', async function (...args) {
    inspected.push(this);
    return originalStat.apply(this, args);
  });
  t.mock.method(prototype, 'readFile', async function () { throw new Error('private-customer-data'); });
  await assert.rejects(readProtectedFile(file, { maxBytes: 1024, failureCode: 'protected_test_invalid' }),
    error => error.message === 'protected_test_invalid' && error.cause === undefined);
  assert.equal(inspected.length, 2);
  assert.ok(inspected.every(handle => handle.fd === -1));
});

test('Wrangler transport forcibly disables disk logs and redacts child-process output on failure', async t => {
  const previous = { write: process.env.WRANGLER_WRITE_LOGS, sanitize: process.env.WRANGLER_LOG_SANITIZE };
  t.after(() => {
    for (const [key, value] of [['WRANGLER_WRITE_LOGS', previous.write], ['WRANGLER_LOG_SANITIZE', previous.sanitize]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  process.env.WRANGLER_WRITE_LOGS = 'true';
  process.env.WRANGLER_LOG_SANITIZE = 'false';
  const run = createWranglerRunner(repo, async (_command, _args, options) => {
    assert.equal(options.env.WRANGLER_LOG, 'log');
    assert.equal(options.env.WRANGLER_WRITE_LOGS, 'false');
    assert.equal(options.env.WRANGLER_LOG_SANITIZE, 'true');
    throw Object.assign(new Error('secret-signed-url'), { stdout: 'private-data', stderr: 'credentials' });
  });
  await assert.rejects(run(['d1', 'list'], { json: true }), error => error.message === 'wrangler_operation_failed' && error.cause === undefined);
});

test('real local Wrangler JSON remains readable with disk logging disabled', { timeout: 60_000 }, async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'grihagrid-restore-json-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const configPath = path.join(directory, 'wrangler.json');
  await writeFile(configPath, JSON.stringify({
    name: 'local-restore-json-test', compatibility_date: '2026-08-01',
    d1_databases: [{ binding: 'DRILL_DB', database_name: 'local-test-only', database_id: cloneId }],
  }), { mode: 0o600 });
  const result = await createWranglerRunner(repo)([
    'd1', 'execute', 'DRILL_DB', '--local', '--config', configPath,
    '--persist-to', path.join(directory, 'state'), '--json', '--command', 'SELECT 1 AS diagnostic;',
  ], { json: true });
  assert.equal(result.length, 1);
  assert.equal(result[0].success, true);
  assert.deepEqual(result[0].results, [{ diagnostic: 1 }]);
});

test('existing output directory is never reused', async t => {
  const f = await fixture(t);
  await runRemoteRestoreDrill({ directory: f.directory, repo, run: f.run });
  const before = f.calls.length;
  await assert.rejects(runRemoteRestoreDrill({ directory: f.directory, repo, run: f.run }), /EEXIST/);
  assert.equal(f.calls.length, before);
});
