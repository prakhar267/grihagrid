#!/usr/bin/env bash
# One isolated observation attempt. No retry or release acceptance happens here.
set -euo pipefail
umask 077
export ORIGIN="$1"
export GRIHAGRID_RELEASE_ID="$2"
observation_directory="$3"
attempt_index="$4"
private_directory="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/grihagrid-tail-attempt.XXXXXX")"
invocation_pid=""
server_pid=""
invocation_status=0
server_status=0
stop_tail_groups() {
  # Bound the entire pair's graceful drain, not one timeout per process. The
  # outer supervisor gives this runner five seconds before its own SIGKILL.
  if [ -n "$invocation_pid" ]; then kill -TERM -- "-$invocation_pid" 2>/dev/null || true; fi
  if [ -n "$server_pid" ]; then kill -TERM -- "-$server_pid" 2>/dev/null || true; fi
  for cleanup_tick in $(seq 1 20); do
    groups_alive=false
    if [ -n "$invocation_pid" ] && kill -0 -- "-$invocation_pid" 2>/dev/null; then groups_alive=true; fi
    if [ -n "$server_pid" ] && kill -0 -- "-$server_pid" 2>/dev/null; then groups_alive=true; fi
    if [ "$groups_alive" = false ]; then break; fi
    sleep 0.1
  done
  invocation_forced=false
  server_forced=false
  if [ -n "$invocation_pid" ] && kill -0 -- "-$invocation_pid" 2>/dev/null; then
    invocation_forced=true
    kill -KILL -- "-$invocation_pid" 2>/dev/null || true
  fi
  if [ -n "$server_pid" ] && kill -0 -- "-$server_pid" 2>/dev/null; then
    server_forced=true
    kill -KILL -- "-$server_pid" 2>/dev/null || true
  fi
  if [ -n "$invocation_pid" ]; then
    if wait "$invocation_pid" 2>/dev/null; then invocation_status=0; else invocation_status=$?; fi
  fi
  if [ -n "$server_pid" ]; then
    if wait "$server_pid" 2>/dev/null; then server_status=0; else server_status=$?; fi
  fi
  # A group leader can exit143 while a descendant ignores TERM. Do not call
  # that a clean operator stop or allow transport retry after forced cleanup.
  if [ "$invocation_forced" = true ]; then invocation_status=137; fi
  if [ "$server_forced" = true ]; then server_status=137; fi
  invocation_pid=""
  server_pid=""
}
cleanup() {
  stop_tail_groups
  rm -rf -- "$private_directory"
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
set -euo pipefail
invocation_summary="${observation_directory}/invocation-tail-aggregate.json"
server_summary="${observation_directory}/server-tail-aggregate.json"
invocation_stderr="$private_directory/invocation-tail.stderr"
server_stderr="$private_directory/server-tail.stderr"
monitor_stderr="$private_directory/monitor.stderr"

command -v setsid >/dev/null
INVOCATION_SUMMARY="$invocation_summary" setsid bash -c '
  set -o pipefail
  CLOUDFLARE_API_TOKEN="$CF_DEPLOY_TOKEN" CLOUDFLARE_ACCOUNT_ID="$CF_DEPLOY_ACCOUNT" \
    WRANGLER_LOG=warn WRANGLER_HIDE_BANNER=true WRANGLER_WRITE_LOGS=false \
    timeout --signal=INT --kill-after=10s 2100s \
    wrangler tail --env="" --format json --status error \
      --version-id "$GRIHAGRID_RELEASE_ID" \
    | env -u CF_DEPLOY_TOKEN -u CF_DEPLOY_ACCOUNT -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_ACCOUNT_ID \
      TAIL_STOP_ON_EVENT=true TAIL_PROCESS_GROUP="$$" \
      node scripts/tail-aggregate.mjs "$INVOCATION_SUMMARY"
' 2> "$invocation_stderr" &
invocation_pid=$!
SERVER_SUMMARY="$server_summary" setsid bash -c '
  set -o pipefail
  CLOUDFLARE_API_TOKEN="$CF_DEPLOY_TOKEN" CLOUDFLARE_ACCOUNT_ID="$CF_DEPLOY_ACCOUNT" \
    WRANGLER_LOG=warn WRANGLER_HIDE_BANNER=true WRANGLER_WRITE_LOGS=false \
    timeout --signal=INT --kill-after=10s 2100s \
    wrangler tail --env="" --format json \
      --search "\"outcome\":\"server_error\"" --version-id "$GRIHAGRID_RELEASE_ID" \
    | env -u CF_DEPLOY_TOKEN -u CF_DEPLOY_ACCOUNT -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_ACCOUNT_ID \
      TAIL_STOP_ON_EVENT=true TAIL_PROCESS_GROUP="$$" \
      node scripts/tail-aggregate.mjs "$SERVER_SUMMARY"
' 2> "$server_stderr" &
server_pid=$!
unset CF_DEPLOY_TOKEN CF_DEPLOY_ACCOUNT
watch_stderr="$(node -e 'process.stdout.write(JSON.stringify(process.argv.slice(1)))' "$invocation_stderr" "$server_stderr")"
sleep 5

tails_alive=true
kill -0 "$invocation_pid" 2>/dev/null || tails_alive=false
kill -0 "$server_pid" 2>/dev/null || tails_alive=false

set +e
GRIHAGRID_MONITOR_WATCH_PIDS="$invocation_pid,$server_pid" \
  GRIHAGRID_MONITOR_WATCH_STDERR="$watch_stderr" \
  node scripts/monitor-release.mjs "$ORIGIN" "$GRIHAGRID_RELEASE_ID" \
  2> "$monitor_stderr" \
  | tee "$observation_directory/monitor.json"
monitor_status=${PIPESTATUS[0]}
kill -0 "$invocation_pid" 2>/dev/null || tails_alive=false
kill -0 "$server_pid" 2>/dev/null || tails_alive=false
public_regression=false
monitor_infrastructure_failure=false
case "$monitor_status" in
  0) ;;
  1) public_regression=true ;;
  2) monitor_infrastructure_failure=true ;;
  *) monitor_infrastructure_failure=true ;;
esac
{
  echo "public_regression=$public_regression"
  echo "monitor_infrastructure_failure=$monitor_infrastructure_failure"
} > "$observation_directory/monitor-status.txt"
stop_tail_groups
set -e

# Only the monitor's three fixed CLI messages are expected. A private bounded
# read returns a boolean, never diagnostic text, a path, or provider details.
monitor_stderr_valid="$(node --input-type=module - "$monitor_stderr" "$monitor_status" <<'NODE'
import { constants } from "node:fs";
import { open } from "node:fs/promises";
const expected = { 0: "", 1: "release monitor detected a public regression\n", 2: "release monitor lost exact-version tail coverage\n" };
let valid = false, handle;
try {
  handle = await open(process.argv[2], constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  const before = await handle.stat();
  if (before.isFile() && before.size <= 256 && Object.hasOwn(expected, process.argv[3])) {
    const bytes = Buffer.alloc(257);
    let length = 0;
    while (length < bytes.length) {
      const part = await handle.read(bytes, length, bytes.length - length, length);
      if (!part.bytesRead) break;
      length += part.bytesRead;
    }
    const after = await handle.stat();
    valid = before.size === after.size && length === after.size && bytes.subarray(0, length).equals(Buffer.from(expected[process.argv[3]]));
  }
} catch { /* Unexpected or unreadable diagnostics fail closed without disclosure. */ }
finally { await handle?.close().catch(() => {}); }
process.stdout.write(String(valid));
NODE
)"
if [ "$monitor_stderr_valid" != true ]; then
  monitor_infrastructure_failure=true
  echo "monitor_infrastructure_failure=true" >> "$observation_directory/monitor-status.txt"
fi

invocation_stderr_summary="$(node scripts/classify-tail-stderr.mjs "$invocation_stderr")"
server_stderr_summary="$(node scripts/classify-tail-stderr.mjs "$server_stderr")"

for attempt in $(seq 1 50); do
  if [ -s "$invocation_summary" ] && [ -s "$server_summary" ]; then
    break
  fi
  sleep 0.1
done

tail_regression="$(node --input-type=module - "$invocation_summary" "$server_summary" <<'NODE'
import { readFileSync } from "node:fs";
let regression = false;
for (const file of process.argv.slice(2)) {
  try {
    const aggregate = JSON.parse(readFileSync(file, "utf8"));
    if (Number(aggregate.eventCount) > 0) regression = true;
  } catch {
    // Combined validation below treats missing or malformed evidence as infrastructure failure.
  }
}
process.stdout.write(String(regression));
NODE
)"
echo "tail_regression=$tail_regression" >> "$observation_directory/monitor-status.txt"

rm -f -- "$invocation_stderr" "$server_stderr" "$monitor_stderr"

set +e
MONITOR_STATUS="$monitor_status" PUBLIC_REGRESSION="$public_regression" \
  TAIL_REGRESSION="$tail_regression" MONITOR_INFRASTRUCTURE_FAILURE="$monitor_infrastructure_failure" TAILS_ALIVE="$tails_alive" \
  INVOCATION_STATUS="$invocation_status" SERVER_STATUS="$server_status" \
  INVOCATION_STDERR_SUMMARY="$invocation_stderr_summary" SERVER_STDERR_SUMMARY="$server_stderr_summary" \
  node --input-type=module - "$invocation_summary" "$server_summary" "$observation_directory" "$attempt_index" <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
const [invocationFile, serverFile, directory, attemptIndex] = process.argv.slice(2);
const output = `${directory}/tail-health.json`;
const monitor = JSON.parse(readFileSync(`${directory}/monitor.json`, "utf8"));
const invocation = JSON.parse(readFileSync(invocationFile, "utf8"));
const server = JSON.parse(readFileSync(serverFile, "utf8"));
const monitorStatus = Number(process.env.MONITOR_STATUS);
const invocationStatus = Number(process.env.INVOCATION_STATUS);
const serverStatus = Number(process.env.SERVER_STATUS);
const publicRegression = process.env.PUBLIC_REGRESSION === "true";
const tailRegression = process.env.TAIL_REGRESSION === "true";
const parseStderrSummary = (name) => {
  const summary = JSON.parse(process.env[name]);
  if (!Number.isSafeInteger(summary.byteCount) || summary.byteCount < 0
    || typeof summary.ignoredProxyWarning !== "boolean"
    || typeof summary.unexpected !== "boolean") {
    throw new Error(`invalid ${name}`);
  }
  return summary;
};
const invocationStderr = parseStderrSummary("INVOCATION_STDERR_SUMMARY");
const serverStderr = parseStderrSummary("SERVER_STDERR_SUMMARY");
const normalizeDiagnostics = (summary) => ({
  ...summary,
  diagnosticClasses: summary.diagnosticClasses || (summary.unexpected ? ["unrecognized_stderr"] : []),
  recognizedWarningCount: summary.recognizedWarningCount || 0,
  hasUnrecognizedContent: summary.hasUnrecognizedContent ?? summary.unexpected,
});
const stoppedEarly = monitorStatus !== 0;
const tailsStoppedByOperator = invocationStatus === 143 && serverStatus === 143;
const regression = publicRegression || tailRegression || invocation.eventCount > 0 || server.eventCount > 0;
const infrastructureFailure = process.env.MONITOR_INFRASTRUCTURE_FAILURE === "true"
  || process.env.TAILS_ALIVE !== "true"
  || invocationStderr.unexpected
  || serverStderr.unexpected
  || !tailsStoppedByOperator;
writeFileSync(output, `${JSON.stringify({
  attempt: Number(attemptIndex),
  closed: true,
  monitorStatus,
  exactVersion: process.env.GRIHAGRID_RELEASE_ID,
  configuredDurationMs: 1_800_000,
  observedDurationMs: monitor.observedDurationMs,
  finalFencePassed: monitor.finalFencePassed,
  finalFenceReleaseId: monitor.finalFenceReleaseId,
  completedFullDuration: !stoppedEarly && monitor.completedFullDuration === true,
  publicRegression,
  tailRegression,
  invocationEvents: invocation.eventCount,
  invocationBytes: invocation.byteCount,
  handledServerErrorEvents: server.eventCount,
  handledServerErrorBytes: server.byteCount,
  tailsAliveThroughPublicMonitor: process.env.TAILS_ALIVE === "true",
  invocationProcessExit: invocationStatus,
  serverProcessExit: serverStatus,
  tailsStoppedByOperator,
  invocationStderr: normalizeDiagnostics(invocationStderr),
  serverStderr: normalizeDiagnostics(serverStderr),
  regression,
  infrastructureFailure,
}, null, 2)}\n`);

if (regression || infrastructureFailure) process.exit(1);
NODE
evidence_status=$?
set -e
# A known transport warning cannot disguise unexpected monitor diagnostics.
# Keep the original public/tail flags above for the controller's sticky scan.
if [ "$monitor_stderr_valid" != true ]; then exit 3; fi
exit "$evidence_status"
