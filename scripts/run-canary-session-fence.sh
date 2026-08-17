#!/usr/bin/env bash
set -euo pipefail
set +x

usage() {
  echo "usage: run-canary-session-fence.sh snapshot staging|production candidate|rollback | restore staging|production candidate|rollback proof-output completed|ambiguous" >&2
  exit 2
}

[ "$#" -ge 3 ] && [ "$#" -le 5 ] || usage
mode="$1"
environment="$2"
scope="$3"

case "$environment" in
  staging)
    wrangler_environment=(--env staging)
    ;;
  production)
    wrangler_environment=(--env=)
    ;;
  *)
    usage
    ;;
esac

case "$scope" in
  candidate)
    prefix="$environment-canary-session"
    ;;
  rollback)
    prefix="$environment-rollback-canary-session"
    ;;
  *)
    usage
    ;;
esac

: "${RUNNER_TEMP:?RUNNER_TEMP is required}"
umask 077
query_sql="$RUNNER_TEMP/$prefix-query.sql"
before_json="$RUNNER_TEMP/$prefix-before.json"
observed_json="$RUNNER_TEMP/$prefix-observed.json"
cleanup_sql="$RUNNER_TEMP/$prefix-cleanup.sql"
cleanup_json="$RUNNER_TEMP/$prefix-cleanup.json"
final_json="$RUNNER_TEMP/$prefix-final.json"

snapshot() {
  [ "$#" -eq 0 ] || usage
  test -n "${GRIHAGRID_CANARY_EMAIL:-}"
  env -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_ACCOUNT_ID -u GRIHAGRID_CANARY_PASSWORD \
    node scripts/canary-session-fence.mjs query-sql "$environment" "$query_sql"
  query_sql_text="$(< "$query_sql")"
  env -u GRIHAGRID_CANARY_EMAIL -u GRIHAGRID_CANARY_PASSWORD \
    wrangler d1 execute DB --remote "${wrangler_environment[@]}" --json \
      --command "$query_sql_text" > "$before_json"
  unset query_sql_text
  env -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_ACCOUNT_ID \
    -u GRIHAGRID_CANARY_EMAIL -u GRIHAGRID_CANARY_PASSWORD \
    node scripts/canary-session-fence.mjs validate-snapshot "$environment" "$before_json"
}

restore() {
  [ "$#" -eq 2 ] || usage
  proof_output="$1"
  attempt_outcome="$2"
  case "$attempt_outcome" in
    completed)
      stabilization_seconds=0
      ;;
    ambiguous)
      # Cloudflare documents up to 30 seconds for post-disconnect waitUntil work.
      # Keep a reviewed ten-second margin and reconcile the exact account again.
      stabilization_seconds=40
      ;;
    *)
      usage
      ;;
  esac
  test -s "$query_sql"
  test -s "$before_json"
  rm -f -- "$proof_output"
  started_at_seconds=$SECONDS
  reconciliation_pass=0
  late_retry_count=0
  while true; do
    next_reconciliation_pass=$((reconciliation_pass + 1))
    query_sql_text="$(< "$query_sql")"
    env -u GRIHAGRID_CANARY_EMAIL -u GRIHAGRID_CANARY_PASSWORD \
      wrangler d1 execute DB --remote "${wrangler_environment[@]}" --json \
        --command "$query_sql_text" > "$observed_json"
    unset query_sql_text
    env -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_ACCOUNT_ID -u GRIHAGRID_CANARY_PASSWORD \
      node scripts/canary-session-fence.mjs cleanup-sql "$environment" \
        "$before_json" "$observed_json" "$cleanup_sql"
    cleanup_sql_text="$(< "$cleanup_sql")"
    env -u GRIHAGRID_CANARY_EMAIL -u GRIHAGRID_CANARY_PASSWORD \
      wrangler d1 execute DB --remote "${wrangler_environment[@]}" --json \
        --command "$cleanup_sql_text" > "$cleanup_json"
    unset cleanup_sql_text
    query_sql_text="$(< "$query_sql")"
    env -u GRIHAGRID_CANARY_EMAIL -u GRIHAGRID_CANARY_PASSWORD \
      wrangler d1 execute DB --remote "${wrangler_environment[@]}" --json \
        --command "$query_sql_text" > "$final_json"
    unset query_sql_text
    stabilized_for_ms=$(((SECONDS - started_at_seconds) * 1000))
    proof_environment=(
      CANARY_SESSION_RECONCILIATION_PASS="$next_reconciliation_pass"
      CANARY_SESSION_STABILIZED_FOR_MS="$stabilized_for_ms"
      CANARY_SESSION_ALLOW_LATE_RETRY=true
    )
    if [ "$next_reconciliation_pass" -gt 1 ]; then
      proof_environment+=(CANARY_SESSION_PREVIOUS_PROOF="$proof_output")
    fi
    if env -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_ACCOUNT_ID \
        -u GRIHAGRID_CANARY_EMAIL -u GRIHAGRID_CANARY_PASSWORD \
        "${proof_environment[@]}" \
        node scripts/canary-session-fence.mjs proof "$environment" \
          "$before_json" "$observed_json" "$cleanup_json" "$final_json" "$proof_output"; then
      proof_status=0
    else
      proof_status=$?
    fi
    if [ "$proof_status" -eq 75 ]; then
      late_retry_count=$((late_retry_count + 1))
      if [ "$late_retry_count" -gt 12 ]; then
        echo "canary session reconciliation exceeded its late-arrival retry bound" >&2
        return 1
      fi
      continue
    fi
    if [ "$proof_status" -ne 0 ]; then return "$proof_status"; fi
    reconciliation_pass="$next_reconciliation_pass"
    stabilization_ms=$((stabilization_seconds * 1000))
    if [ "$stabilized_for_ms" -ge "$stabilization_ms" ]; then
      break
    fi
    remaining_ms=$((stabilization_ms - stabilized_for_ms))
    remaining_seconds=$(((remaining_ms + 999) / 1000))
    if [ "$remaining_seconds" -gt 5 ]; then
      sleep 5
    else
      sleep "$remaining_seconds"
    fi
  done
}

case "$mode" in
  snapshot)
    [ "$#" -eq 3 ] || usage
    snapshot
    ;;
  restore)
    [ "$#" -eq 5 ] || usage
    restore "$4" "$5"
    ;;
  *)
    usage
    ;;
esac
