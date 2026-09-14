import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';

// Real Bash, detached POSIX process groups, monitor, classifier and aggregator.
// Only Wrangler, public HTTP smoke, startup delay and unavailable macOS utility
// commands are replaced inside an isolated PATH. No credentials or network.
const version = '11111111-1111-4111-8111-111111111111';
const source = new URL('../scripts/', import.meta.url);
const secrets = ['CF_DEPLOY_TOKEN', 'CF_DEPLOY_ACCOUNT', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'];
const fixturePrefix = `import { appendFileSync as fixtureRecord } from 'node:fs';
for (const key of ${JSON.stringify(secrets)}) if (Object.hasOwn(process.env,key)) throw new Error('fixture child inherited credentials');
fixtureRecord(process.env.PID_LOG, JSON.stringify({kind:'aggregate',pid:process.pid})+'\\n');\n`;

async function executable(file, content) { await writeFile(file, content, { mode: 0o700 }); await chmod(file, 0o700); }
async function waitFor(check, timeout = 5000) {
  const until = performance.now() + timeout;
  do { const value = await check(); if (value) return value; await delay(15); } while (performance.now() < until);
  throw new Error('bounded process fixture did not reach its expected state');
}
async function pids(directory) {
  try { return (await readFile(join(directory, 'pids.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}
function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
async function allProcessesStopped(directory) {
  return (await pids(directory)).every(record => !alive(record.pid) && (!record.group || !alive(record.group)));
}

async function fixture(mode, run) {
  const directory = await mkdtemp(join(tmpdir(), 'grihagrid-attempt-process-'));
  const scripts = join(directory, 'scripts'), bin = join(directory, 'bin'), privateRoot = join(directory, 'private'), evidence = join(directory, 'evidence');
  await Promise.all([scripts, bin, privateRoot, evidence].map(path => mkdir(path, { mode: 0o700 })));
  for (const name of ['observe-release-attempt.sh', 'monitor-release.mjs', 'classify-tail-stderr.mjs', 'tail-aggregate.mjs']) {
    await copyFile(new URL(name, source), join(scripts, name));
  }
  await writeFile(join(scripts, 'tail-aggregate.mjs'), fixturePrefix + (await readFile(join(scripts, 'tail-aggregate.mjs'), 'utf8')).replace(/^#!.*\n/, ''));
  const monitor = await readFile(join(scripts, 'monitor-release.mjs'), 'utf8');
  await writeFile(join(scripts, 'monitor-release.mjs'), `if (process.env.FIXTURE_MODE.includes('monitor-noise')) process.stderr.write('PRIVATE-MONITOR-DIAGNOSTIC\\n');\n` + monitor.replace(/^#!.*\n/, ''));
  await writeFile(join(scripts, 'smoke.mjs'), `import { appendFile } from 'node:fs/promises';
export async function runSmoke(origin, options) {
  for (const key of ${JSON.stringify(secrets)}) if (Object.hasOwn(process.env,key)) throw new Error('fixture monitor inherited credentials');
  await appendFile(process.env.PID_LOG,JSON.stringify({kind:'monitor',pid:process.pid})+'\\n');
  if(process.env.FIXTURE_MODE.includes('public')) throw new Error('synthetic confirmed public failure');
  if(process.env.FIXTURE_MODE==='cancel') await new Promise(resolve=>setTimeout(resolve,20000));
  return {checks:[{latencyMs:1,attempts:1}]};
}\n`);
  await symlink(process.execPath, join(bin, 'node'));
  await executable(join(bin, 'setsid'), '#!/usr/bin/python3\nimport os,sys\nos.setsid()\nos.execvp(sys.argv[1],sys.argv[1:])\n');
  await executable(join(bin, 'timeout'), '#!/usr/bin/env bash\nset -eu\n[ "$1" = "--signal=INT" ] && [ "$2" = "--kill-after=10s" ] && [ "$3" = "2100s" ]\nshift 3\nexec "$@"\n');
  await executable(join(bin, 'sleep'), '#!/usr/bin/env bash\nif [ "$1" != 5 ]; then exec /bin/sleep "$@"; fi\nexec /usr/bin/python3 "${BASH_SOURCE[0]}.py"\n');
  await executable(join(bin, 'sleep.py'), `#!/usr/bin/python3
import json,os,sys,time
deadline=time.monotonic()+5
while time.monotonic()<deadline:
  try:
    with open(os.environ['PID_LOG']) as source: records=[json.loads(line) for line in source if line.strip()]
    ready=sum(record['kind']=='wrangler' for record in records)==2
    if os.environ['FIXTURE_MODE'] in ['stubborn','cancel']: ready=ready and sum(record['kind']=='descendant-ready' for record in records)==2
    if ready: time.sleep(.025);sys.exit(0)
  except (FileNotFoundError,json.JSONDecodeError): pass
  time.sleep(.01)
sys.exit(93)
`);
  await executable(join(bin, 'tee'), '#!/usr/bin/env bash\n/usr/bin/tee "$@"\nif [ "$FIXTURE_MODE" = late-event ]; then /bin/sleep 0.12; fi\n');
  await executable(join(bin, 'wrangler'), `#!/usr/bin/env node
const fs=require('node:fs'),{spawn}=require('node:child_process');
const role=process.argv.includes('--status')?'invocation':'server', mode=process.env.FIXTURE_MODE;
fs.appendFileSync(process.env.PID_LOG,JSON.stringify({kind:'wrangler',role,pid:process.pid,group:process.ppid})+'\\n');
if(process.env.CLOUDFLARE_API_TOKEN!=='' || process.env.CLOUDFLARE_ACCOUNT_ID!=='') process.exit(92);
if(role==='invocation' && ['known','late-event','known-monitor-noise'].includes(mode)) process.stderr.write('Tail connection lost. Reconnecting (attempt 1 of 5) in 1s...\\n');
if(role==='server' && mode==='unknown') process.stderr.write('PRIVATE-UNKNOWN-TAIL-DIAGNOSTIC\\n');
if(mode==='stubborn' || mode==='cancel') {
  process.on('SIGTERM',()=>{});
  const child=spawn(process.execPath,['-e','process.on("SIGTERM",()=>{});require("node:fs").appendFileSync(process.env.PID_LOG,JSON.stringify({kind:"descendant-ready",pid:process.pid})+String.fromCharCode(10));setInterval(()=>{},1000)'],{stdio:'ignore'});
  fs.appendFileSync(process.env.PID_LOG,JSON.stringify({kind:'descendant',pid:child.pid})+'\\n');
}
if(mode==='late-event' && role==='server') {
  const timer=setInterval(()=>{try{if(fs.readFileSync(process.env.MONITOR_OUTPUT,'utf8').includes('"status": "failed"')){clearInterval(timer);process.stdout.write('PRIVATE-POSITIVE-EVENT\\n');}}catch{}},3);
}
setInterval(()=>{},1000);
`);
  const child = spawn('bash', [join(scripts, 'observe-release-attempt.sh'), 'https://fixture.example.test', version, evidence, '1'], {
    cwd: directory, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: {
      PATH: `${bin}:/usr/bin:/bin`, RUNNER_TEMP: privateRoot, TMPDIR: privateRoot,
      CF_DEPLOY_TOKEN: '', CF_DEPLOY_ACCOUNT: '', FIXTURE_MODE: mode, PID_LOG: join(directory, 'pids.jsonl'), MONITOR_OUTPUT: join(evidence, 'monitor.json'),
      GRIHAGRID_MONITOR_DURATION_MS: '35', GRIHAGRID_MONITOR_INTERVAL_MS: '50',
    },
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
  const completion = once(child, 'close').then(([code, signal]) => ({ code, signal, stdout, stderr }));
  try { return await run({ child, completion, directory, evidence, privateRoot }); }
  finally {
    try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    for (const record of await pids(directory)) { try { process.kill(record.pid, 'SIGKILL'); } catch {} }
    await completion;
    await rm(directory, { recursive: true, force: true });
  }
}

async function assertClosed(result, state) {
  assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE-|fixture child inherited credentials|fixture monitor inherited credentials/);
  assert.equal(result.stderr, '', 'The runner must not forward expected monitor diagnostics.');
  assert.deepEqual(await readdir(state.privateRoot), []);
  await waitFor(() => allProcessesStopped(state.directory), 2000);
  return JSON.parse(await readFile(join(state.evidence, 'tail-health.json'), 'utf8'));
}

test('actual Bash attempt keeps clean and known transport diagnostics private', async () => {
  for (const mode of ['clean', 'known']) await fixture(mode, async state => {
    const result = await state.completion, health = await assertClosed(result, state);
    assert.equal(result.code, mode === 'clean' ? 0 : 1);
    assert.equal(health.monitorStatus, mode === 'clean' ? 0 : 2);
    assert.equal(health.regression, false); assert.equal(health.closed, true);
    assert.equal(health.invocationProcessExit, 143); assert.equal(health.serverProcessExit, 143);
    if (mode === 'known') {
      assert.equal(health.invocationStderr.unexpected, true);
      assert.equal(health.invocationStderr.hasUnrecognizedContent, false);
      assert.deepEqual(health.invocationStderr.diagnosticClasses, ['wrangler_tail_reconnect']);
    }
  });
});

test('unknown tail diagnostics remain terminal and a late real positive event is retained', async () => {
  for (const mode of ['unknown', 'late-event']) await fixture(mode, async state => {
    const result = await state.completion, health = await assertClosed(result, state);
    assert.equal(result.code, 1); assert.equal(health.infrastructureFailure, true);
    if (mode === 'unknown') assert.equal(health.serverStderr.hasUnrecognizedContent, true);
    else {
      assert.equal(health.tailRegression, true); assert.equal(health.regression, true);
      assert.equal(health.handledServerErrorEvents, 1);
      assert.match(await readFile(join(state.evidence, 'monitor-status.txt'), 'utf8'), /^tail_regression=true$/m);
    }
  });
});

test('unexpected monitor stderr prevents retry while a confirmed public regression stays sticky', async () => {
  for (const mode of ['monitor-noise', 'known-monitor-noise', 'public', 'public-monitor-noise']) await fixture(mode, async state => {
    const result = await state.completion, health = await assertClosed(result, state);
    assert.equal(result.code, mode.includes('monitor-noise') ? 3 : 1);
    assert.equal(health.publicRegression, mode.includes('public'));
    if (mode.includes('public')) assert.match(await readFile(join(state.evidence, 'monitor-status.txt'), 'utf8'), /^public_regression=true$/m);
  });
});

test('TERM-resistant descendants are killed and reaped within the five-second outer cleanup bound', async () => {
  await fixture('stubborn', async state => {
    const started = performance.now(), result = await state.completion;
    assert.ok(performance.now() - started < 4500);
    const health = await assertClosed(result, state);
    assert.equal(result.code, 1); assert.equal(health.tailsStoppedByOperator, false);
    assert.equal(health.invocationProcessExit, 137); assert.equal(health.serverProcessExit, 137);
  });
});

test('outer cancellation cleans both detached groups without waiting for a stalled public monitor', async () => {
  await fixture('cancel', async state => {
    await waitFor(async () => (await pids(state.directory)).some(record => record.kind === 'monitor'));
    const started = performance.now(); process.kill(-state.child.pid, 'SIGTERM');
    const result = await state.completion;
    assert.ok(performance.now() - started < 4500); assert.equal(result.code, 143);
    assert.deepEqual(await readdir(state.privateRoot), []);
    await waitFor(() => allProcessesStopped(state.directory), 2000);
  });
});
