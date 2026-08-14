# GrihaGrid production operations runbook

This is the operating procedure for GrihaGrid on Cloudflare Workers, D1, KV,
optional R2, Google Gemini, and Razorpay. It covers release, monitoring, recovery, payment operations,
and the decision to open or close paid traffic. Commands assume they are run
from the repository root by an authenticated operator.

The first paid wedge is the structured-input, no-upload ₹999 Decision Compare
defined in `docs/decision-compare.md`. R2 is not a dependency for that wedge.
Uploads and any product that promises them stay closed while R2 is absent.

## 1. Service record and current state

| Component | Production value | Role | Current operational state |
|---|---|---|---|
| Worker | `grihagrid` | React assets and `/api/*` | Configured in `wrangler.toml` |
| Staging Worker | `grihagrid-staging` | Synthetic pre-production journeys | Deployed at `https://grihagrid-staging.prakhargupta267.workers.dev`; dedicated D1/KV; smoke and secrets remain release-specific |
| Canonical launch origin | `https://grihagrid.prakhargupta267.workers.dev` until a custom domain is attached | Same-origin UI, API, cookies, and Razorpay callback | Must also be set as `APP_ORIGIN` before checkout works |
| D1 binding | `DB` → `grihagrid-db` (`42a75a83-ab24-4e3f-93f1-b80c51284f1e`) | Users, sessions, projects, reports, file metadata, orders, webhook ledger | Bound; remote application of all migrations must be verified |
| KV binding | `GRIHAGRID_CACHE` → `c5044339222a4172ad7c91724b98d4fb` | Best-effort abuse/rate limiting | Bound; never a money or entitlement ledger |
| R2 binding | `FILES` → intended bucket `grihagrid-files` | Future private user uploads | **Deferred:** not required for no-upload Decision Compare; all upload promises remain disabled |
| Razorpay | Payment Links API and signed webhook | Checkout and paid-state confirmation | **Not active:** live account configuration, secrets, webhook registration, and reconciliation evidence are absent |
| Google Gemini | Structured Interactions API | Optional sanitized planning brief | Active for sanitized beta; shared free-tier project must be isolated before material customer volume |
| Cron | `17 2 * * *` | Session/order/AI admission cleanup | Configured daily at 02:17 UTC / 07:47 IST |
| Observability | Worker observability, `head_sampling_rate = 1`; automatic invocation logs disabled | Templated custom request logs and traces | Enabled at 100% sampling; raw-URL invocation logs stay off because share URLs contain bearer secrets; alert rules and external synthetics still need proof |

`/api/health` is a dependency-independent liveness probe. `/api/readiness`
checks D1 reachability, the required schema, the KV binding, and reports
AI/upload/payment capabilities. Neither endpoint proves Gemini generation quality, Razorpay webhook delivery,
cron execution, or a complete customer journey; synthetics remain mandatory.

The Worker currently reads these runtime values:

- Bindings: `ASSETS`, `DB`, `GRIHAGRID_CACHE`, and optional `FILES`.
- Non-secret configuration: `APP_ENV`, `APP_ORIGIN`, `GEMINI_MODEL`,
  `PAID_CHECKOUT_ENABLED`, `DECISION_COMPARE_FULFILLMENT_ENABLED`,
  `ENABLED_PAYMENT_PLANS`, and optional comma-separated `ALLOWED_ORIGINS`.
- Secrets: `GEMINI_API_KEY`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and
  `RAZORPAY_WEBHOOK_SECRET`; `METRICS_READ_TOKEN` protects private aggregate
  product metrics.

## 2. Ownership and incident authority

Assign named people before accepting money. One person may fill several roles
at launch, but every role needs a primary and backup contact recorded outside
this repository.

| Role | Authority and responsibility |
|---|---|
| Incident commander | Sets severity, stops launches, coordinates recovery, and closes the incident |
| Engineering on-call | Worker, D1, KV, R2, deploy, rollback, and evidence collection |
| Finance/payment owner | Razorpay dashboard, settlement, refund, chargeback, and reconciliation decisions |
| Security/privacy owner | Access incidents, secret rotation, retention, notification, and legal escalation |
| Product/professional owner | Estimate/report safety, claim accuracy, and customer communication |

Only the incident commander or payment owner may re-enable checkout after a
money incident. Only the security/privacy owner may declare a data exposure
contained.

## 3. Environment model

Production and staging are represented in `wrangler.toml`; staging has its own
Worker hostname, D1 UUID, and KV namespace. Provider secrets and modes must also
remain physically separate before paid launch:

| Environment | Data | Razorpay | Required isolation |
|---|---|---|---|
| Local | Synthetic only; local D1/KV emulation | Test doubles or Razorpay test mode | `.dev.vars` is ignored by Git; no production secrets |
| Preview | Ephemeral synthetic data | Disabled | Per-branch Worker; never bind production D1/KV |
| Staging | Persistent synthetic test accounts | Razorpay test mode | `grihagrid-staging`, D1 `ac7ff387-c8c6-40d2-b9db-83078378c054`, KV `f48c3f765bc84088a88376e887daf7b1`, separate secrets |
| Production | Real customer and financial records | Razorpay live mode | `grihagrid`, production D1/KV and least-privilege deploy identity |

Maintain explicit Wrangler environments. Never use production bindings merely
because a staging deployment is short-lived. Use a different canary email and
payment account in each environment.

### Required production configuration

Keep non-secret configuration in version-controlled Wrangler environment
configuration:

```toml
[vars]
APP_ENV = "production"
APP_ORIGIN = "https://grihagrid.prakhargupta267.workers.dev"
GEMINI_MODEL = "gemini-3.6-flash"
PAID_CHECKOUT_ENABLED = "false"
DECISION_COMPARE_FULFILLMENT_ENABLED = "false"
ENABLED_PAYMENT_PLANS = ""
```

Version-controlled defaults remain closed. After every paid gate is signed, a
reviewed production-only release first sets
`DECISION_COMPARE_FULFILLMENT_ENABLED="true"`, verifies artifact/share access,
then sets `PAID_CHECKOUT_ENABLED="true"` and
`ENABLED_PAYMENT_PLANS="decision_compare"`. Closing checkout and closing
fulfillment remain separate containment actions even though both must be open
before a new payable link is created. Missing, malformed, or contradictory
controls must behave as false.

When a custom domain becomes canonical, update `APP_ORIGIN` in the same release
and add the old origin to `ALLOWED_ORIGINS` only for a short, documented
transition. Do not permit `*` for authenticated writes.

Enter secrets interactively so values do not appear in shell history:

```sh
npx wrangler secret put RAZORPAY_KEY_ID --env=""
npx wrangler secret put RAZORPAY_KEY_SECRET --env=""
npx wrangler secret put RAZORPAY_WEBHOOK_SECRET --env=""
npx wrangler secret put GEMINI_API_KEY --env=""
npx wrangler secret put METRICS_READ_TOKEN --env=""
npx wrangler secret list --env=""

# Use distinct test-mode values in staging; never copy production secrets.
npx wrangler secret put RAZORPAY_KEY_ID --env staging
npx wrangler secret put RAZORPAY_KEY_SECRET --env staging
npx wrangler secret put RAZORPAY_WEBHOOK_SECRET --env staging
npx wrangler secret put GEMINI_API_KEY --env staging
npx wrangler secret put METRICS_READ_TOKEN --env staging
npx wrangler secret list --env staging
```

Register this exact live webhook URL in Razorpay:

```text
https://grihagrid.prakhargupta267.workers.dev/api/payments/razorpay/webhook
```

Subscribe to the exact state-changing events covered by automated tests:
`payment_link.paid`, `payment.captured`, `refund.processed`,
`payment.dispute.created`, and `payment.dispute.lost`. The Worker
verifies `x-razorpay-signature`, deduplicates by event ID/body hash, validates
amount and currency, and only then marks an order paid. Preserve the same
webhook secret on both sides of each environment during deployment; an
uncoordinated change causes valid payments to remain unfulfilled. Production
and staging secrets must remain different.

## 4. Standard release procedure

### 4.1 Change readiness

1. Name the release owner, change window, rollback owner, and customer impact.
2. Confirm `git status --short` contains only reviewed release changes.
3. Record the immutable commit with `git rev-parse HEAD` in the release ticket.
4. Review schema, payment-state, auth/cookie, file-retention, and pricing changes
   explicitly; they receive two-person review.
5. Keep checkout closed during any release that changes orders, webhooks,
   pricing, entitlements, or report fulfillment.

### 4.2 Build and verify

```sh
npm ci
npm run check:migrations
npm run check
npm run check:worker
npm run check:worker:staging
npm audit --audit-level=high
```

`npm run check` builds the Vite client and Worker bundle, runs all Node tests,
and validates fail-closed operational config. `check:migrations` applies the
full schema history to a fresh temporary local D1 database. Both Worker commands
validate bundles and environment bindings without deploying. The test runner
executes test files serially because the two real-D1 suites each own a local
Wrangler/workerd lifecycle; their adversarial concurrency is driven inside the
fixtures rather than by competing test processes. Do not deploy from
a dirty working tree, with skipped tests, or
after an audit finding has merely been ignored. Document any accepted
non-critical dependency risk with an owner and expiry.

### 4.3 Verify target and bindings

```sh
npx wrangler whoami
npx wrangler d1 info grihagrid-db
npx wrangler d1 migrations list grihagrid-db --remote
npx wrangler secret list --env=""
npx wrangler deployments status --env=""
npx wrangler d1 info grihagrid-staging-db
npx wrangler d1 migrations list DB --remote --env staging
npx wrangler secret list --env staging
npx wrangler deployments status --env staging
```

Match the Cloudflare account, Worker name, D1 UUID, KV namespace,
hostname, and secret names to the release ticket. `secret list` shows names,
not values. Stop if the account or any resource differs.

If a future release enables uploads, separately validate its private R2 bucket,
binding, malware/quarantine and retention controls. R2 absence is expected for
Decision Compare and must not be worked around with public object storage.

### 4.4 Back up D1

Create a temporary mode-0600 export outside the repository before a production
migration, then move it immediately into approved encrypted backup storage. The
export contains identity, password hashes, project data, and financial metadata
and must never be committed, left in a shared folder, or attached to a ticket.

```sh
umask 077
mkdir -p ../grihagrid-ops-backups
GG_BACKUP_FILE="../grihagrid-ops-backups/grihagrid-db-$(date -u +%Y%m%dT%H%M%SZ).sql"
npx wrangler d1 export grihagrid-db --remote --output "$GG_BACKUP_FILE"
chmod 600 "$GG_BACKUP_FILE"
shasum -a 256 "$GG_BACKUP_FILE" > "$GG_BACKUP_FILE.sha256"
```

Record the checksum, protected storage location, Cloudflare Time Travel
bookmark/horizon, and restore owner in the release ticket. Move the files into
approved encrypted backup storage immediately; this local mode-0600 copy is a
temporary staging file, not encrypted backup evidence.

### 4.5 Apply migrations safely

Migrations currently run in this order:

1. `0001_initial.sql`: users, sessions, projects, orders, and leads.
2. `0002_backend.sql`: password credentials, CSRF/session fields, reports, and
   private-file metadata.
3. `0003_payments.sql`: Payment Link fields and immutable webhook-event ledger.
4. `0004_commercial_fulfillment.sql`: immutable purchased-report snapshots and
   idempotent paid-order fulfillment state.
5. `0005_gemini_ai.sql`: owner-scoped, versioned Gemini planning briefs.
6. `0006_ai_abuse_controls.sql`: transactional generation counters and
   expiring per-project AI leases.
7. `0007_decision_compare.sql`: versioned two-scenario comparisons, purchase
   snapshots, versioned checkout consent, revocable shares, aggregate-only
   product events, progress timestamps and compatible Decision Compare product
   codes for existing order storage.
8. `0008_payment_state_hardening.sql`: canonical checkout request hashes,
   immutable refund/dispute terminal facts and durable duplicate-capture
   reconciliation cases.
9. `0009_decision_selection_lock.sql`: monotonic project-input revisions,
   comparison source-revision pins, an editable pre-checkout choice and the D1
   trigger fence that atomically locks the exact current choice at checkout.
10. `0010_family_alignment.sql`: redacted seven-day Family Alignment rooms,
    bounded response receipts, response-count integrity triggers and retention
    indexes.
11. `0011_archived_project_write_fence.sql`: database-level race fences that
    prevent planning/content inserts or updates after a project archive while
    preserving explicit privacy deletes, revocations and paid-state updates.
12. `0012_brief_check_revision_history.sql`: derived Brief Check fields on the
    current project projection; one honest immutable baseline per existing
    project; immutable revision, idempotency and report-snapshot ledgers; source
    change/Family closure, archive, CAS and report-generation race fences; and
    nullable compatibility fields for a short rollback to the previous Worker.

Migration `0012` and the new Worker are one ordered change: back up, migrate D1,
verify the schema, then deploy the Worker. Never deploy the new Worker before
the migration. Before staging or production migration, record these counts and
retain them with the release ticket:

```sql
SELECT COUNT(*) AS projects, COALESCE(MAX(input_revision),0) AS max_revision FROM projects;
SELECT COUNT(*) AS reports,
       SUM(CASE WHEN version=1 THEN 1 ELSE 0 END) AS version_one_reports
  FROM reports;
SELECT COUNT(*) AS open_family_rooms
  FROM family_alignment_rooms WHERE revoked_at IS NULL;
```

After migration, require one baseline per existing project—not one row for every
number below `input_revision`—and reconcile the report backfill:

```sql
SELECT COUNT(*) AS missing_baselines
  FROM projects p LEFT JOIN project_revisions r
    ON r.project_id=p.id AND r.revision=p.input_revision
 WHERE r.project_id IS NULL;
SELECT COUNT(*) AS fabricated_or_duplicate_baselines
  FROM (SELECT project_id,COUNT(*) AS count FROM project_revisions GROUP BY project_id)
 WHERE count!=1;
SELECT COUNT(*) AS migrated_report_mismatch
  FROM reports r LEFT JOIN project_revision_reports rr
    ON rr.project_id=r.project_id
   AND rr.project_revision=r.project_input_revision
   AND rr.report_schema_version=r.version
 WHERE r.project_input_revision IS NOT NULL AND rr.project_id IS NULL;
```

All three results must be zero immediately after the migration. Also verify
readiness reports `revisionSchema=current` and `briefCheck=true`, while
`paidCheckout=false`, `privateUploads=false`, and the paid-plan allowlist stays
empty. Do not repair a mismatch by synthesizing earlier revisions; stop and
restore into an isolated database to diagnose it.

Apply the exact files to staging first and complete its smoke suite. For
production:

```sh
npx wrangler d1 migrations apply DB --remote --env staging
npm run deploy -- --env staging
npm run smoke -- https://grihagrid-staging.prakhargupta267.workers.dev

npx wrangler d1 migrations list DB --remote --env=""
npx wrangler d1 migrations apply DB --remote --env=""
npx wrangler d1 migrations list DB --remote --env=""
```

The final list must show no unapplied migrations. Wrangler captures a backup
when applying D1 migrations, but the explicit export remains required.

All future schema changes use expand/contract:

1. Add nullable columns, new tables, or backward-compatible indexes.
2. Deploy code that can read old and new representations.
3. Backfill in bounded, restartable batches with counts and checksums.
4. Switch reads only after validation.
5. Remove old fields in a later release after the rollback window.

Never edit an already-applied migration, reuse its filename, drop a production
column/table in the same release, or assume application rollback reverses D1.

### 4.6 Deploy and record the version

```sh
npm run deploy -- --env=""
npx wrangler deployments status --env=""
npx wrangler deployments list --env=""
```

Record the new version ID, commit SHA, migration set, operator, start/end time,
and previous known-good version ID. Watch errors while the smoke tests run:

```sh
npx wrangler tail grihagrid --format json --status error
```

### 4.7 Production smoke tests

Use only synthetic, non-sensitive data. Every check must record timestamp,
status, latency, and Worker version.

```sh
GG_ORIGIN="https://grihagrid.prakhargupta267.workers.dev"
npm run smoke -- "$GG_ORIGIN"
```

Then use the dedicated production canary account to verify:

1. Login and session restoration after reload.
2. Create, read, update, report-generate, and delete one canary project.
3. When `0012` is in the release, open Brief Check, preview one synthetic
   change, prove the preview does not change any row, accept and save it, retry
   with the same idempotency key, read both revision details, explicitly
   generate current report v2 and read the prior report through revision
   history. Confirm readiness says `revisionSchema=current` and
   `briefCheck=true` and delete every canary row.
4. Generate one sanitized AI brief, read the cached copy, and delete the project;
   confirm the provider is called only once and no synthetic rows remain.
5. Create exactly two canary scenarios, issue/read a comparison under a test
   entitlement in staging, record a choice and confirm the frozen versions.
6. Confirm one user cannot fetch another canary user's project, revision/history,
   AI brief,
   comparison, artifact, choice, order or share; expect
   ownership-safe `404`.
7. Confirm production catalog accepts no plan before the launch record is
   signed; staging test mode may accept only `decision_compare`.
8. Verify mobile and desktop landing, start, auth, dashboard, Brief Check,
   revision history, comparison, print
   and return routes.

Do not create a real charge as a routine deploy smoke. Before first paid launch,
perform one controlled live ₹999 purchase, webhook confirmation,
settlement check, and full refund with the payment owner present.

## 5. Continuous health and synthetic monitoring

Configure checks from at least two external regions. Cloudflare's own dashboard
does not count as an independent availability check.

`.github/workflows/production-smoke.yml` runs the read-only public suite against
production and staging hourly and on demand. It is a regression backstop, not a
one-minute/two-region availability monitor. Keep its paid expectation false
until the signed launch release; if checkout is intentionally opened, update it
in the same reviewed change so it asserts that only `decision_compare` accepts
orders.

| Frequency | Check | Success condition |
|---|---|---|
| 1 minute | `GET /` | `200`, expected brand marker, TLS valid, less than 3 s |
| 1 minute | `GET /api/health` | `200`, JSON `status=ok`, fresh timestamp |
| 1 minute | `GET /api/readiness` | `200`, JSON `status=ready`, D1/schema/KV checks healthy |
| 5 minutes | `POST /api/estimate` fixture | `200`, expected schema and fixed numeric fixture |
| 15 minutes | Canary login + `GET /api/projects` | Session succeeds and only canary-owned data appears |
| Daily | Full canary project/report CRUD | Create/read/update/report/delete completes without residue |
| Daily while Brief Check is enabled | Authenticated preview → save → replay → history → explicit report v2 → delete | Preview is write-free; one revision/map/report snapshot exists; history/currentness is truthful; cleanup leaves no source, request or report rows |
| Daily during pilot | Authenticated two-scenario comparison | Frozen A/B inputs and numeric deltas match fixture; choice is idempotent; cleanup leaves no rows |
| Daily while Family Alignment is enabled | Synthetic room → public read → response update → owner summary → revoke | One room/receipt, redacted A/B projection, aggregate summary reconciles, revoked URL is `410`, cleanup leaves no rows or token in monitor output |
| Daily during pilot | Paid fulfillment age | Every verified payment is issued or explicitly paused inside the published promise |
| Daily while AI enabled | Sanitized AI generation + cached read | Valid advisory schema, one provider call, cached replay, cleanup leaves no rows |
| Daily only after a future R2 launch | Private file round trip | Upload/download SHA-256 match/delete; anonymous fetch denied |
| Daily | Cron evidence | Expired session count does not grow and scheduled invocation succeeded |
| Daily during sales | Payment reconciliation | Razorpay and D1 ledgers balance exactly |

The monitor account password belongs in the monitoring provider's encrypted
secret store. Never log cookies, CSRF values, project inputs, email addresses,
file bytes, Razorpay payloads, or provider authorization headers.

The Worker currently emits one bounded JSON completion log after each handled
request and returns the same opaque request ID in `x-request-id`. Its
implemented schema is:

```json
{
  "type": "request_complete",
  "environment": "production",
  "route": "/api/projects/:projectId/decision-compare",
  "method": "GET",
  "status": 200,
  "outcome": "success",
  "requestId": "opaque-uuid",
  "releaseId": "cloudflare-version-id-or-unknown",
  "durationMs": 42
}
```

Use a route template, never the raw URL: share tokens, project/comparison/order
IDs and queries must not enter `route`. Implemented `outcome` values are the
bounded classes `success`, `redirect`, `client_error`, and `server_error`; they
never contain an exception or response body. `releaseId` comes from Cloudflare
version metadata and may be `unknown` in local tests. Paid launch still needs a
deployed-version correlation check and a secret/PII canary test against
captured logs so support can correlate failures without asking for cookies or
payloads.

Browser-event telemetry is a different, aggregate-only surface. `POST /api/events`
accepts only the seven documented `decision_compare_*` names plus allowlisted
`surface` and `outcome`; D1 stores day/name/surface/outcome/count/update time.
It stores no event IDs, users, projects, orders, comparison versions, IPs, free
text or client timestamps. `GET /api/events/aggregate` is rate-limited and
hidden behind a constant-time checked `METRICS_READ_TOKEN` bearer value. D1 also
stores four paid-cohort first timestamps—opened, printed, shared and explicit
professional handoff—against already-retained opaque order/snapshot keys. The
metrics response exposes only cohort counts/rate, never those keys or individual
timestamps. Treat these linked records as personal data for access, retention,
backup and deletion policy. Artifact/share delivery is authoritative; its
best-effort milestone write must never turn delivery into a false failure.

Family Alignment events are server-only. After a valid auth/bearer boundary and
successful core action, the Worker may increment only
`family_alignment_room_created`, `family_alignment_review_opened`,
`family_alignment_response_submitted`, or
`family_alignment_room_revoked` on `owner_compare` or `family_review`. The
browser must not post a duplicate. These are the same aggregate rows, never a
room/response stream: do not add room, project, comparison, receipt, role,
preference, reason, token, IP, user-agent, or client-time fields. Failure to
write an aggregate must be logged with the fixed payload-free marker and must
not change a room/read/response/revoke result.

## 6. SLIs, SLOs, and alerts

Initial targets are intentionally conservative and must be reviewed after four
weeks of real traffic.

| Service level indicator | Monthly objective | Measurement |
|---|---|---|
| Public calculator availability | 99.9% | Successful external homepage, health, and estimate checks |
| Authenticated API availability | 99.9% | Non-4xx project/report requests excluding deliberate client errors |
| Worker server-error ratio | At least 99.9% non-5xx | Cloudflare invocations by route and version |
| Health/estimate latency | p95 under 500 ms | External and Worker latency |
| Authenticated CRUD latency | p95 under 750 ms | Worker route-template latency |
| Brief revision correctness | 100%; zero tolerance | One CAS winner/idempotent result per accepted edit; no fabricated history, stale-current report, reopened Family room or mutation of sold evidence |
| Decision Compare fulfillment | At least 90% inside published pilot promise | `payment_webhook_events.processed_at`/`orders.paid_at` to an available matching purchased snapshot; v1 has no correction/reissue workflow |
| Decision action | At least 60% within seven days during pilot | Protected `paidDecisionCohort`: paid denominator and first print/share/professional-handoff within seven days; reconcile against orders before using it for a decision |
| Gemini brief availability | 99% while enabled | Daily sanitized generation succeeds; cached read remains independent of provider |
| AI advisory-boundary safety | 100%; zero tolerance | No accepted compliance/approval/structural guarantee or construction-start directive |
| Checkout creation availability | 99.9% when checkout is open | Valid requests receiving a trusted Razorpay URL; excludes user/provider validation 4xx |
| Webhook processing | 99.9% accepted within 60 s of provider delivery | Razorpay delivery timestamp versus `payment_webhook_events.processed_at` |
| Financial correctness | 100%; zero tolerance | No duplicate, amount/currency mismatch, unverified paid state, or unmatched settlement |
| Cross-account resource isolation | 100%; zero tolerance | Negative project/comparison/artifact/choice/share/order synthetics and incident reports |
| Family Alignment active-room availability | 99.9% | Valid owner create/summary and bearer public-read/response synthetics, excluding deliberate validation/rate-limit `4xx` |
| Family Alignment privacy and capacity | 100%; zero tolerance | Redaction/log canaries, cross-owner/token negative tests, at most one room per comparison and five receipts per room |
| Family Alignment retention | 99% within 24 h after the 90-day closed-room boundary | D1 expiry/revocation query and successful scheduled cleanup |
| Session cleanup | 99% within 24 h after expiry | D1 expiry query and cron invocation logs |
| Backup recovery | RPO 24 h; RTO 4 h | Last verified backup and quarterly restore drill |

Page the on-call for:

- two consecutive health failures or any five-minute outage;
- Worker 5xx above 2% for five minutes with at least 20 requests;
- any cross-account result, private R2 exposure, CSP/TLS failure, or secret leak;
- any Family Alignment bearer value in logs/analytics/referrers, public private-
  field exposure, response takeover/cross-room update, sixth receipt, response
  committed after closure, or Family Alignment action changing an order or
  entitlement;
- any fabricated/missing revision, two winners for one source revision, report
  served for the wrong source/schema, migrated v1 treated as current v2,
  revision that rewrites purchased/financial evidence, or Family response
  committed after a source change;
- any `amount_mismatch`, `reference_mismatch`, `payment_mismatch`, duplicate
  fulfillment, or paid-provider/D1 disagreement;
- checkout failures above 5% for 15 minutes with at least 10 valid attempts;
- any Razorpay webhook delivery exhausted or signature failures sustained for
  five minutes;
- D1 query errors above 1% for five minutes;
- a failed daily Gemini synthetic, a sustained provider-error spike, an AI
  quota crossing 90%, or any accepted advisory-boundary violation;
- R2 upload/download errors above 2% for 10 minutes;
- the daily cron missing twice, expired session backlog increasing for two
  days, or retention-eligible Family Alignment rooms growing across two
  successful invocations;
- no valid backup within 26 hours or a failed restore drill.

Create a ticket, not a page, for p95 latency degradation, storage/cost forecast
breach, non-critical dependency findings, and isolated user-visible failures.

The current Worker emits a privacy-bounded completion log with environment,
method, templated route, status, bounded outcome, opaque request ID, Cloudflare
release ID, and duration; it also returns `x-request-id`. Paid launch remains
blocked until deployed-version correlation, safe log-canary evidence,
dashboards, and the alerts above are implemented and tested. Keep 100% head
sampling during a small invited launch; reduce it only after error metrics
remain complete at lower sampling.

## 7. D1 backup and restore

### Backup policy

Baseline evidence before Decision Compare: the 2026-08-13 production export was
stored outside the repository with mode 0600 and SHA-256
`5e36b156b46a789915a054cd7ca10e7acd94b48f1dcff24e28532cf2c0aeb595`.
An isolated local restore recovered users=1, projects=1, reports=1, AI briefs=1
and orders=0. `PRAGMA integrity_check` was unavailable through the authenticated
D1 path, so schema and aggregate checks were used. This proves the export is
readable, not the remote RPO/RTO gate; move it to approved encrypted storage and
perform a timed remote staging restore before paid launch.

- Export production D1 daily and before every migration or payment-state
  release.
- Encrypt at rest, restrict to the incident/security operators, and keep an
  immutable copy in a separate failure domain.
- Retain daily, weekly, and monthly copies according to the approved privacy and
  financial-retention policy. Do not invent a retention period before counsel
  approves it.
- Record SHA-256, row counts by table, schema version, capture time, and restore
  test status.
- Exercise restoration quarterly and after any schema/tooling change.

### Non-destructive restore drill

1. Create an isolated database named with the date, for example
   `grihagrid-restore-drill-YYYYMMDD`.
2. Import the chosen SQL export into that database with
   `wrangler d1 execute <restore-db> --remote --file=<export.sql>`.
3. Bind only an isolated staging Worker; never attach the restored copy to a
   public hostname.
4. Compare schema and aggregate counts for `users`, `projects`, `reports`,
   `ai_planning_briefs`, `ai_generation_counters`, `ai_generation_leases`,
   `project_files`, `orders`, `payment_webhook_events`,
   `payment_terminal_records`, `payment_reconciliation_cases`,
   `decision_comparisons`, `purchased_decision_snapshots`, `decision_shares`,
   and `decision_progress`.
5. Run login, ownership, report, AI-cache/admission, and payment-ledger read
   checks without sending emails or calling Google or Razorpay live APIs.
6. Record elapsed restore time and destroy the drill database only after its
   exact name/UUID and evidence have been independently checked.

### Production recovery

Production D1 restore or Time Travel is a destructive incident action:

1. Declare the incident and close customer writes, checkout, and fulfillment.
   Keep Razorpay delivery/retries and the webhook secret active; if D1 writes
   must pause, verify the provider retains/retries events and preserve delivery
   IDs for authenticated replay.
2. Export the damaged database for evidence.
3. Identify the recovery timestamp/backup before the damaging event and quantify
   orders/events that would be lost.
4. Prefer restoring/forking to a new D1 database, validate it, then change the
   binding. Use in-place Time Travel only with incident-commander approval.
5. Replay verified Razorpay events for the recovery gap idempotently before
   reopening fulfillment.
6. Validate row counts, ownership, paid-order parity, health, and synthetics.

Never restore D1 alone and assume provider/storage consistency. Reconcile
Razorpay and every bound storage system at the chosen recovery boundary.

## 8. Payment operations and reconciliation

D1 is the product order ledger; Razorpay is the money-movement authority. A
customer receives paid status only through a verified webhook. KV is not used
for payment correctness. `Idempotency-Key` is user-scoped and enforced by a D1
unique constraint.

### Daily reconciliation

Export or query these D1 sets without exposing customer emails:

```sh
npx wrangler d1 execute DB --remote --env="" --command \
  "SELECT status,COUNT(*) AS count,SUM(amount_paise) AS paise FROM orders GROUP BY status ORDER BY status;"

npx wrangler d1 execute DB --remote --env="" --command \
  "SELECT id,provider_order_id,status,provider_status,created_at FROM orders WHERE status='created' AND created_at < datetime('now','-30 minutes') ORDER BY created_at;"

npx wrangler d1 execute DB --remote --env="" --command \
  "SELECT provider_event_id,event_type,order_id,provider_payment_id,processing_result,received_at FROM payment_webhook_events WHERE processing_result NOT IN ('paid','already_paid','ignored_event') ORDER BY received_at DESC LIMIT 100;"

npx wrangler d1 execute DB --remote --env="" --command \
  "SELECT record_type,provider_object_id,terminal_action,provider_payment_id,order_id,amount_paise,currency,provider_state,observed_at FROM payment_terminal_records ORDER BY observed_at DESC LIMIT 100;"

npx wrangler d1 execute DB --remote --env="" --command \
  "SELECT id,order_id,conflicting_order_id,provider_payment_id,reason,status,created_at,resolved_at FROM payment_reconciliation_cases WHERE status='open' ORDER BY created_at;"
```

Compare by provider Payment Link ID/payment ID, INR amount in paise, state, and
timestamp against Razorpay's payment and settlement exports. Classify every
difference:

- `created` older than 30 minutes: query Razorpay; do not retry or mark paid
  blindly.
- Razorpay paid/captured but D1 not paid: stop fulfillment, repair webhook
  delivery/signature, and replay the authentic provider event.
- D1 paid but Razorpay not captured or amount differs: SEV-1; stop checkout and
  fulfillment immediately.
- `unmatched`, `reference_mismatch`, `payment_mismatch`, or `amount_mismatch`:
  preserve the event and escalate; never edit references to make it balance.
- Duplicate identical webhook: expected and safe; confirm it did not duplicate
  fulfillment.
- Refund/chargeback: verify provider status, customer communication, invoice,
  entitlement consequence, and D1 state as one controlled case.

Decision Compare code is required to handle signed paid/captured, refund, and
dispute events idempotently. Invoice/GST/receipt integration, provider
settlement comparison and an operator reconciliation surface remain launch
gates. Until the complete live journey has two-person evidence, any live test or
refund is controlled manually and checkout remains closed to the public.

### Emergency checkout and fulfillment stop

The primary containment controls are `PAID_CHECKOUT_ENABLED` and
`DECISION_COMPARE_FULFILLMENT_ENABLED`. Deploy both as `"false"` to stop new
checkout and new artifact/share access. Closing checkout alone stops new
payable links; closing fulfillment also stops artifact reads, share creation,
and public share reads. The catalog and access endpoints must fail closed, but
Razorpay webhook verification remains active so an already-created checkout
cannot become an unrecorded payment.

If a code/config regression prevents the checkout switch from containing new
links, delete only the production `RAZORPAY_KEY_SECRET` after verifying the
active account/Worker. Do **not** delete `RAZORPAY_WEBHOOK_SECRET`.

```sh
npx wrangler deployments status --env=""
npx wrangler secret delete RAZORPAY_KEY_SECRET --env=""
```

Also hide purchase CTAs in an emergency release. Reopen only after reconciling
every order since the incident start, testing both flags in staging, restoring
the provider key interactively if it was deleted, and receiving incident-
commander plus payment-owner approval.

## 9. R2 operations and cleanup

R2 must remain private: keep `r2.dev` access and public custom bucket domains
disabled. All file reads pass through Worker authentication, D1 ownership, and
opaque object keys. The current 10 MiB upload maximum is a hard product and cost
guardrail.

Before enabling `FILES`:

1. Complete Cloudflare R2 subscription/billing activation.
2. Create `grihagrid-files` in the correct account and a separate staging bucket.
3. Confirm all public access is disabled.
4. Uncomment the `FILES` binding, deploy staging, and run ownership/round-trip
   tests.
5. Add malware scanning/quarantine before broadening production uploads. The
   current PDF/JPEG/PNG/WebP signature checks are not a malware scanner;
   ZIP/DOCX/XLSX/DWG/DXF are not accepted and need an explicit security design
   before any future enablement.
6. Define approved retention/deletion rules. Do not apply a blanket lifecycle
   rule that could delete active customer evidence.

The upload path writes R2 first and deletes that object if the D1 metadata write
fails. A failed compensating delete can still leave an orphan. Conversely, an
operator or provider error can leave D1 metadata whose object is missing.

Run a weekly reconciliation job that:

- lists objects by the `users/<user>/projects/<project>/<file>` key shape and
  compares keys, size, checksum, and metadata to `project_files`;
- quarantines R2-only objects for a defined grace period before deletion;
- flags D1-only rows immediately as `file_content_not_found` incidents;
- never logs object content, filenames, user IDs, or signed credentials;
- emits counts and opaque IDs for review, with two-person approval for bulk
  deletion.

Project deletion removes known R2 objects before deleting D1 metadata. If R2 is
unavailable, project deletion fails safely; do not delete the D1 rows manually
or the recovery pointer is lost. Maintain a deletion audit and retry queue before
claiming account deletion is complete.

## 10. Cron verification

The scheduled handler currently performs seven bounded operations:

```sql
DELETE FROM sessions WHERE expires_at < datetime('now');
UPDATE orders SET status='failed', ...
 WHERE status='created' AND created_at < datetime('now','-25 hours');
DELETE FROM ai_generation_leases WHERE expires_at <= datetime('now');
DELETE FROM ai_generation_counters WHERE updated_at < datetime('now','-8 days');
DELETE FROM decision_shares
 WHERE expires_at < datetime('now','-90 days')
    OR (revoked_at IS NOT NULL AND revoked_at < datetime('now','-90 days'));
DELETE FROM family_alignment_rooms
 WHERE expires_at < datetime('now','-90 days')
    OR (revoked_at IS NOT NULL AND revoked_at < datetime('now','-90 days'));
DELETE FROM product_event_aggregates WHERE event_day < date('now','-400 days');
```

It is scheduled for 02:17 UTC daily. Verify after every trigger/config change:

Production owns this trigger. Staging explicitly sets `crons=[]` because the
Cloudflare account was at its five-trigger free-plan limit (API 10072) during
the 2026-08-13 staging deployment. Until quota is available, run the scheduled
handler against synthetic local/staging fixtures during release testing; do not
remove the production trigger or attach staging to production D1 as a shortcut.

1. Cloudflare dashboard shows cron `17 2 * * *` attached to the current Worker
   version.
2. The scheduled invocation succeeded around 02:17 UTC.
3. The following counts return zero or trend back to zero after the run:

   ```sh
   npx wrangler d1 execute grihagrid-db --remote --command \
     "SELECT COUNT(*) AS expired_sessions FROM sessions WHERE expires_at < datetime('now');
      SELECT COUNT(*) AS expired_ai_leases FROM ai_generation_leases WHERE expires_at <= datetime('now');
      SELECT COUNT(*) AS old_ai_counters FROM ai_generation_counters WHERE updated_at < datetime('now','-8 days');
      SELECT COUNT(*) AS old_family_rooms FROM family_alignment_rooms
       WHERE expires_at < datetime('now','-90 days')
          OR (revoked_at IS NOT NULL AND revoked_at < datetime('now','-90 days'));"
   ```

4. Deliberately expired synthetic sessions, checkout links, AI leases and
   retention-eligible Family Alignment rooms in staging are removed by a tested
   scheduled invocation; recent counters and active/recent rooms remain.
5. Before/after fixture counts prove each removed Family Alignment room's
   responses cascade while its project, comparison, owner selection, purchased
   snapshot, order and payment ledger rows remain unchanged. Never put raw room
   or response tokens in cron output.

Alert after one missed run and page after two. The handler uses `ctx.waitUntil`;
an invocation record without successful D1 completion is not evidence of cleanup.

## 11. Capacity and cost guardrails

Do not base safety on a provider's current free-tier number. Record the active
Cloudflare and Razorpay quotas/pricing in the monthly operations review and alert
at 50%, 75%, and 90% of each approved budget or quota.

- **Workers:** watch requests, CPU time, duration, subrequests, 4xx/5xx, and
  asset traffic by version. Load test staging at 2× the forecast launch peak.
- **D1:** watch database size, rows read/written, query latency, lock/error rate,
  and full scans. Keep list endpoints bounded; archive only under an approved
  retention policy.
- **KV:** authentication/checkout read-then-write limiting is best effort and
  can race under concurrency; it is an abuse brake, not a money/spend ledger.
- **Gemini:** D1 is the strict spend boundary: six admitted generations per
  user per UTC hour and 200 reserved provider attempts per UTC day. Each call
  reserves up to two attempts, failures are not refunded, cache hits are free,
  and an expiring project lease prevents duplicate concurrent calls. Alert at
  50%, 75%, and 90% of the platform allowance and treat unexpected lease
  backlog as an incident signal.
- **R2:** track stored bytes, Class A/B operations, failed operations, and orphan
  count. Alert on a 2× day-over-day upload-byte increase or unexpected file-type
  mix.
- **Razorpay:** track checkout creation, paid conversion, refunds, chargebacks,
  webhook retries, settlement lag, and fees against D1 order totals.
- **Observability:** 100% sampling is appropriate only for the initial small
  cohort. Set a cost ceiling and preserve complete error/financial signals if
  normal traces are sampled down.

Growth gates: at 50% sustained resource capacity, optimize and forecast; at 75%,
capacity work becomes release-blocking; at 90%, stop acquisition/large uploads
until headroom is restored.

## 12. Security operations

- Require phishing-resistant MFA for Cloudflare, GitHub, Razorpay, domain, and
  backup administrators. Remove shared accounts and review access monthly.
- Use a least-privilege, short-lived CI token scoped to the exact Worker and
  required D1/KV/R2 resources. Never use a global API key.
- Protect the GitHub default branch with required `npm run check`, dependency
  review, secret scanning, review, and signed/auditable releases.
- Rotate Razorpay and deploy credentials on personnel change, suspected leak,
  and the documented periodic schedule. Test rotation in staging first.
- Correlate logs using the response's opaque `x-request-id` and Cloudflare
  release ID; look up order/project IDs separately in owner-scoped operational
  data. Do not paste bearer cookies, CSRF tokens, emails, addresses, briefs,
  files, backup contents, or payment payloads into chat or tickets.
- Review dependencies at least monthly and urgently for exploited advisories.
- Test origin/CSRF, session expiry, ownership-safe `404`, file signature/size,
  webhook signature/replay, CSP, HSTS, frame denial, and MIME protection on every
  security-sensitive release.
- Treat cross-account access, private-file exposure, credential leakage, and
  unverified paid state as SEV-1 even if only one record is known affected.

The current application has no email verification, password-reset/recovery,
account-deletion workflow, immutable audit-event table, or malware scanning.
Documented manual support is not an enterprise substitute; implement and test
these controls before broad public sales.

In particular, direct `DELETE FROM users` is not an account-erasure operation:
the original finance-retention schema sets `projects.user_id` to null, so raw
deletion can orphan private project and revision bytes. Operators must not run
it to fulfill a privacy request. A future governed workflow must revoke sessions,
classify legally retained orders/artifacts, delete every eligible project through
the project-deletion boundary, redact retained private input where policy allows,
verify D1/R2 cascades, and only then tombstone/delete identity with an audit trail.

## 13. Incident response

### Severity

- **SEV-1:** incorrect/duplicate charge, D1/Razorpay mismatch that could fulfill
  incorrectly, cross-account access, private-file/secret exposure, destructive
  data loss, unsafe report with plausible construction harm, or broad outage.
- **SEV-2:** login unavailable, D1/R2 degraded, checkout/provider outage without
  incorrect money movement, report generation materially broken, or cron/session
  backlog outside target.
- **SEV-3:** isolated failure, delayed non-critical workflow, cosmetic defect, or
  performance regression within SLO.

### First 15 minutes

1. Acknowledge, open a timestamped incident record, assign commander and scribe.
2. State customer impact, first known time, affected version/routes/resources,
   and whether data or money is at risk.
3. Contain narrowly: close checkout while preserving webhooks for payment risk;
   disable file routes for R2 exposure; roll back code for a release regression.
4. Preserve Cloudflare version IDs/logs, D1 export/Time Travel point, Razorpay
   event/delivery IDs, and relevant checksums. Do not copy sensitive payloads.
5. Establish a 15-minute update cadence for SEV-1 and 30-minute cadence for
   SEV-2. Use factual, non-speculative customer messaging.

### Recovery and closure

Recovery requires the failing SLI to remain healthy for at least 30 minutes,
successful synthetics, payment/D1/R2 reconciliation where relevant, and incident
commander approval. Then document root cause, contributing controls, full impact,
timeline, customer/legal actions, and owned corrective work. Complete a blameless
review within five business days for SEV-1/2.

## 14. Application rollback

Application rollback does not roll back D1, R2, secrets, cron state, or Razorpay
events.

```sh
npx wrangler deployments list --env=""
npx wrangler rollback <known-good-version-id> --env="" --message "Incident <id>: <reason>"
npx wrangler deployments status --env=""
```

Before rollback, confirm the chosen version predates the regression and remains
compatible with the **current** D1 schema and bindings. For payment-semantic
changes, close checkout first while keeping webhook verification alive. After
rollback, run health, estimate, auth/project, report, and relevant R2 synthetics;
reconcile all orders created during the incident window.

After migration `0012`, a previous Worker may run briefly because new project
columns are additive and triggers capture legacy project creates/real source
updates. That compatibility is containment, not a normal operating mode:

- keep checkout, fulfillment and uploads closed and stop new Brief Check edits;
- do not claim an old schema-v1 report is a current Brief Check report;
- expect legacy source updates to create a truthful revision with nullable
  content hash/Brief Check, invalidate the mutable report cache and close active
  Family rooms; after roll-forward the new Worker recomputes the derived view;
- verify the old Worker can perform health, auth, project read and one synthetic
  legacy source update in isolated staging before selecting it for rollback;
- after roll-forward, require `revisionSchema=current`, regenerate v2 explicitly,
  and reconcile `projects.input_revision` to the maximum stored revision for
  every project before reopening edits.

```sql
SELECT p.id,p.input_revision,MAX(r.revision) AS stored_revision
  FROM projects p LEFT JOIN project_revisions r ON r.project_id=p.id
 GROUP BY p.id HAVING stored_revision IS NULL OR stored_revision!=p.input_revision;
SELECT project_id,project_input_revision,version
  FROM reports
 WHERE project_input_revision IS NULL OR version!=2;
```

The first query must return no rows. Rows from the second query are legacy cache
state, not data loss: the new Worker must ignore them as current, preserve any
already-captured historical v1 snapshot, and create v2 only on an explicit
owner generation. Do not mutate or delete immutable history to make the query
look clean.

Never reverse an applied migration by editing history. Use an additive corrective
migration and roll forward. If an older Worker cannot understand the expanded
schema/state, deploy a small compatibility fix instead of forcing rollback.

## 15. Launch checklist and go/no-go decision

### Free public demo / lead collection

- [ ] `npm run check` is green from the release commit.
- [ ] Migrations list is clean and `/api/readiness` reports `status=ready`.
- [ ] Homepage, estimate, registration/login, project CRUD, and report smoke pass.
- [ ] External homepage/health/estimate monitors and 5xx alert are firing to a
  tested contact path.
- [ ] Legal review approves brand, privacy, terms, report disclaimer, and lead
  collection.
- [ ] Support/contact route and incident owner are staffed.

A free demo may launch without R2 or Razorpay only if upload and purchase paths
are visibly unavailable and no claim suggests they work.

### Paid Decision Compare pilot — all are mandatory

- [x] Dedicated staging and production Worker/D1/KV resources exist; GitHub
  production/staging environments, protected strict `main`, vulnerability
  alerts, secret scanning/push protection, Dependabot security fixes and
  private vulnerability reporting are configured. CodeQL default-setup run
  `31729695152` finished successfully. Required PR review and admin enforcement
  remain a launch gate.
- [ ] Provider modes/secrets remain separate, every migration is verified in
  staging and production, and a timed remote restore meets RPO/RTO.
- [ ] `APP_ORIGIN` matches the canonical HTTPS origin exactly.
- [ ] Razorpay live onboarding, restricted keys, webhook events/callback,
  GST/invoice/receipt, refund, chargeback and settlement configuration pass.
- [ ] One controlled live ₹999 payment → signed webhook → D1 paid state →
  immutable comparison → settlement → refund journey reconciles exactly.
- [ ] Automated or two-person daily reconciliation is operational; signed
  refunds/disputes revoke fulfillment/shares as policy requires without
  deleting immutable money evidence.
- [x] Checkout and fulfillment controls are implemented and tested independently;
  already-created checkout webhooks remain accepted during containment.
- [ ] Implemented structured logs and request/version correlation pass a
  deployed-log secret/PII canary; paging alerts and external synthetics pass
  deliberate failure injection.
- [ ] Email verification/recovery/receipts, account deletion, support/refund
  procedures and security incident contacts work end to end.
- [ ] Pricing, taxes, terms, privacy, refund and explicit no-correction/reissue
  policy, professional disclaimers and trademark/domain are approved.
- [ ] Representative comparison fixtures and first-ten-artifact practitioner
  review pass; unsafe/misleading output has a tested fulfillment stop.
- [ ] Capacity at 2× invited-pilot peak and cost alerts at 50/75/90% pass;
  incident, engineering, finance and quality coverage is staffed.

R2 is not required for this structured-input pilot. No upload or hosted-file
promise may be sold. Site Plus, Expert, or any future upload product additionally
requires private R2, upload ownership/round-trip/orphan tests, malware or
quarantine controls, and an approved retention/deletion policy.

### Current decision

**NO-GO for public paid sales.** Isolation and core GitHub release protections
now exist, and independent checkout/fulfillment containment has local real-D1
proof. Razorpay live/account/tax configuration, live refund/settlement
reconciliation, deployed log-canary/alerts, remote restore RTO,
email/receipt/recovery,
legal/brand approval, practitioner quality evidence and staffed ownership are
not yet proven. R2 is not a blocker for Decision Compare and remains a blocker
for any upload-bearing offer.

**Potential GO for a clearly labelled free prototype** after the free-demo
checklist passes. Re-evaluate paid launch only when every mandatory item has an
owner, dated evidence, and no unresolved SEV-1/SEV-2 finding. The founder,
engineering on-call, and payment owner must all sign the launch record; silence
or partial completion is a no-go.
