# GrihaGrid production operations runbook

This is the operating procedure for GrihaGrid on Cloudflare Workers, D1, KV,
R2, Google Gemini, and Razorpay. It covers release, monitoring, recovery, payment operations,
and the decision to open or close paid traffic. Commands assume they are run
from the repository root by an authenticated operator.

## 1. Service record and current state

| Component | Production value | Role | Current operational state |
|---|---|---|---|
| Worker | `grihagrid` | React assets and `/api/*` | Configured in `wrangler.toml` |
| Canonical launch origin | `https://grihagrid.prakhargupta267.workers.dev` until a custom domain is attached | Same-origin UI, API, cookies, and Razorpay callback | Must also be set as `APP_ORIGIN` before checkout works |
| D1 binding | `DB` → `grihagrid-db` (`42a75a83-ab24-4e3f-93f1-b80c51284f1e`) | Users, sessions, projects, reports, file metadata, orders, webhook ledger | Bound; remote application of all migrations must be verified |
| KV binding | `GRIHAGRID_CACHE` → `c5044339222a4172ad7c91724b98d4fb` | Best-effort abuse/rate limiting | Bound; never a money or entitlement ledger |
| R2 binding | `FILES` → intended bucket `grihagrid-files` | Private user uploads | **Not active:** R2 subscription/billing activation is incomplete and the binding is commented out |
| Razorpay | Payment Links API and signed webhook | Checkout and paid-state confirmation | **Not active:** live account configuration, secrets, webhook registration, and reconciliation evidence are absent |
| Google Gemini | Structured Interactions API | Optional sanitized planning brief | Active for sanitized beta; shared free-tier project must be isolated before material customer volume |
| Cron | `17 2 * * *` | Session/order/AI admission cleanup | Configured daily at 02:17 UTC / 07:47 IST |
| Observability | Worker observability, `head_sampling_rate = 1` | Invocation logs and traces | Enabled at 100% sampling; alert rules and external synthetics still need proof |

`/api/health` is a dependency-independent liveness probe. `/api/readiness`
checks D1 reachability, the required schema, the KV binding, and reports
AI/upload/payment capabilities. Neither endpoint proves Gemini generation quality, Razorpay webhook delivery,
cron execution, or a complete customer journey; synthetics remain mandatory.

The Worker currently reads these runtime values:

- Bindings: `ASSETS`, `DB`, `GRIHAGRID_CACHE`, and optional `FILES`.
- Non-secret configuration: `APP_ENV`, `APP_ORIGIN`, `GEMINI_MODEL`, `ENABLED_PAYMENT_PLANS`, and optional
  comma-separated `ALLOWED_ORIGINS`.
- Secrets: `GEMINI_API_KEY`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and
  `RAZORPAY_WEBHOOK_SECRET`.

`SESSION_SECRET` and `RESEND_API_KEY` appear in `.dev.vars.example` but are not
consumed by the current Worker. Sessions use random bearer values whose hashes
are stored in D1. Do not mistake either unused variable for an active control.

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

Production is the only environment currently represented in `wrangler.toml`.
That is adequate for a demo, not for a paid service. Create physically separate
Cloudflare resources before paid launch:

| Environment | Data | Razorpay | Required isolation |
|---|---|---|---|
| Local | Synthetic only; local D1/R2/KV emulation | Test doubles or Razorpay test mode | `.dev.vars` is ignored by Git; no production secrets |
| Preview | Ephemeral synthetic data | Disabled | Per-branch Worker; never bind production D1/KV/R2 |
| Staging | Persistent synthetic test accounts | Razorpay test mode | Separate Worker, D1, KV, R2, secrets, and hostname |
| Production | Real customer and financial records | Razorpay live mode | Dedicated resources and least-privilege deploy identity |

Add explicit Wrangler environments or separate config files. Never use
production bindings merely because a staging deployment is short-lived. Use a
different canary email and payment account in each environment.

### Required production configuration

Keep non-secret configuration in version-controlled Wrangler environment
configuration:

```toml
[vars]
APP_ENV = "production"
APP_ORIGIN = "https://grihagrid.prakhargupta267.workers.dev"
GEMINI_MODEL = "gemini-3.6-flash"
ENABLED_PAYMENT_PLANS = ""

[[r2_buckets]]
binding = "FILES"
bucket_name = "grihagrid-files"
```

When a custom domain becomes canonical, update `APP_ORIGIN` in the same release
and add the old origin to `ALLOWED_ORIGINS` only for a short, documented
transition. Do not permit `*` for authenticated writes.

Enter secrets interactively so values do not appear in shell history:

```sh
npx wrangler secret put RAZORPAY_KEY_ID
npx wrangler secret put RAZORPAY_KEY_SECRET
npx wrangler secret put RAZORPAY_WEBHOOK_SECRET
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret list
```

Register this exact live webhook URL in Razorpay:

```text
https://grihagrid.prakhargupta267.workers.dev/api/payments/razorpay/webhook
```

Subscribe to at least `payment_link.paid` and `payment.captured`. The Worker
verifies `x-razorpay-signature`, deduplicates by event ID/body hash, validates
amount and currency, and only then marks an order paid. Preserve the same
webhook secret on both sides during deployment; an uncoordinated change causes
valid payments to remain unfulfilled.

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
npm audit --audit-level=high
```

`npm run check` builds the Vite client and Worker bundle, then runs all Node
tests, including backend and payment tests. `check:migrations` applies the full
schema history to a fresh temporary local D1 database, while `check:worker`
validates the built asset manifest and Worker configuration without contacting
production. Do not deploy from a dirty working tree, with skipped tests, or
after an audit finding has merely been ignored. Document any accepted
non-critical dependency risk with an owner and expiry.

### 4.3 Verify target and bindings

```sh
npx wrangler whoami
npx wrangler d1 info grihagrid-db
npx wrangler d1 migrations list grihagrid-db --remote
npx wrangler r2 bucket info grihagrid-files
npx wrangler secret list
npx wrangler deployments status
```

Match the Cloudflare account, Worker name, D1 UUID, KV namespace, R2 bucket,
hostname, and secret names to the release ticket. `secret list` shows names,
not values. Stop if the account or any resource differs.

The R2 command is expected to fail until the account's R2 subscription is
activated and `grihagrid-files` is created. That failure is a paid-launch
blocker, not a warning to bypass.

### 4.4 Back up D1

Create an encrypted, access-controlled export outside the repository before a
production migration. The export contains identity, password hashes, project
data, and financial metadata and must never be committed or attached to a
public ticket.

```sh
mkdir -p ../grihagrid-ops-backups
GG_BACKUP_FILE="../grihagrid-ops-backups/grihagrid-db-$(date -u +%Y%m%dT%H%M%SZ).sql"
npx wrangler d1 export grihagrid-db --remote --output "$GG_BACKUP_FILE"
shasum -a 256 "$GG_BACKUP_FILE" > "$GG_BACKUP_FILE.sha256"
```

Record the checksum, protected storage location, Cloudflare Time Travel
bookmark/horizon, and restore owner in the release ticket. Move the files into
approved encrypted backup storage immediately; the local copy is temporary.

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

Apply the exact files to staging first and complete its smoke suite. For
production:

```sh
npx wrangler d1 migrations list grihagrid-db --remote
npx wrangler d1 migrations apply grihagrid-db --remote
npx wrangler d1 migrations list grihagrid-db --remote
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
npm run deploy
npx wrangler deployments status
npx wrangler deployments list
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
curl --fail-with-body --silent --show-error "$GG_ORIGIN/" >/dev/null
curl --fail-with-body --silent --show-error "$GG_ORIGIN/api/health"
curl --fail-with-body --silent --show-error \
  -H 'content-type: application/json' \
  --data '{"width":30,"length":50,"floors":"G+1","quality":"Signature","city":"Pune"}' \
  "$GG_ORIGIN/api/estimate"
```

Then use the dedicated production canary account to verify:

1. Login and session restoration after reload.
2. Create, read, update, report-generate, and delete one canary project.
3. Generate one sanitized AI brief, read the cached copy, and delete the project;
   confirm the provider is called only once and no synthetic rows remain.
4. Upload, download, checksum/size compare, and delete a small safe PDF once R2
   is active.
5. Confirm one user cannot fetch another canary user's project, AI brief, or file; expect
   ownership-safe `404`.
6. Verify mobile and desktop landing, start, auth, dashboard, and report routes.

Do not create a real charge as a routine deploy smoke. Before first paid launch,
perform one controlled live low-value purchase, webhook confirmation,
settlement check, and full refund with the payment owner present.

## 5. Continuous health and synthetic monitoring

Configure checks from at least two external regions. Cloudflare's own dashboard
does not count as an independent availability check.

| Frequency | Check | Success condition |
|---|---|---|
| 1 minute | `GET /` | `200`, expected brand marker, TLS valid, less than 3 s |
| 1 minute | `GET /api/health` | `200`, JSON `status=ok`, fresh timestamp |
| 1 minute | `GET /api/readiness` | `200`, JSON `status=ready`, D1/schema/KV checks healthy |
| 5 minutes | `POST /api/estimate` fixture | `200`, expected schema and fixed numeric fixture |
| 15 minutes | Canary login + `GET /api/projects` | Session succeeds and only canary-owned data appears |
| Daily | Full canary project/report CRUD | Create/read/update/report/delete completes without residue |
| Daily while AI enabled | Sanitized AI generation + cached read | Valid advisory schema, one provider call, cached replay, cleanup leaves no rows |
| Daily after R2 activation | Private file round trip | Upload/download SHA-256 match/delete; anonymous fetch denied |
| Daily | Cron evidence | Expired session count does not grow and scheduled invocation succeeded |
| Daily during sales | Payment reconciliation | Razorpay and D1 ledgers balance exactly |

The monitor account password belongs in the monitoring provider's encrypted
secret store. Never log cookies, CSRF values, project inputs, email addresses,
file bytes, Razorpay payloads, or provider authorization headers.

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
| Gemini brief availability | 99% while enabled | Daily sanitized generation succeeds; cached read remains independent of provider |
| AI advisory-boundary safety | 100%; zero tolerance | No accepted compliance/approval/structural guarantee or construction-start directive |
| Checkout creation availability | 99.9% when checkout is open | Valid requests receiving a trusted Razorpay URL; excludes user/provider validation 4xx |
| Webhook processing | 99.9% accepted within 60 s of provider delivery | Razorpay delivery timestamp versus `payment_webhook_events.processed_at` |
| Financial correctness | 100%; zero tolerance | No duplicate, amount/currency mismatch, unverified paid state, or unmatched settlement |
| Cross-account/private-file isolation | 100%; zero tolerance | Negative synthetics, tests, and incident reports |
| Session cleanup | 99% within 24 h after expiry | D1 expiry query and cron invocation logs |
| Backup recovery | RPO 24 h; RTO 4 h | Last verified backup and quarterly restore drill |

Page the on-call for:

- two consecutive health failures or any five-minute outage;
- Worker 5xx above 2% for five minutes with at least 20 requests;
- any cross-account result, private R2 exposure, CSP/TLS failure, or secret leak;
- any `amount_mismatch`, `reference_mismatch`, `payment_mismatch`, duplicate
  fulfillment, or paid-provider/D1 disagreement;
- checkout failures above 5% for 15 minutes with at least 10 valid attempts;
- any Razorpay webhook delivery exhausted or signature failures sustained for
  five minutes;
- D1 query errors above 1% for five minutes;
- a failed daily Gemini synthetic, a sustained provider-error spike, an AI
  quota crossing 90%, or any accepted advisory-boundary violation;
- R2 upload/download errors above 2% for 10 minutes;
- the daily cron missing twice or expired session backlog increasing for two
  days;
- no valid backup within 26 hours or a failed restore drill.

Create a ticket, not a page, for p95 latency degradation, storage/cost forecast
breach, non-critical dependency findings, and isolated user-visible failures.

The current Worker emits only limited `console.error` events and lacks a
structured request ID/route/latency/outcome log for every API invocation. Paid
launch is blocked until safe structured telemetry and the alerts above are
implemented and tested. Keep 100% head sampling during a small invited launch;
reduce it only after error metrics remain complete at lower sampling.

## 7. D1 backup and restore

### Backup policy

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
   `project_files`, `orders`, and `payment_webhook_events`.
5. Run login, ownership, report, AI-cache/admission, and payment-ledger read
   checks without sending emails or calling Google or Razorpay live APIs.
6. Record elapsed restore time and destroy the drill database only after its
   exact name/UUID and evidence have been independently checked.

### Production recovery

Production D1 restore or Time Travel is a destructive incident action:

1. Declare the incident and close all writes, especially checkout and webhooks.
2. Export the damaged database for evidence.
3. Identify the recovery timestamp/backup before the damaging event and quantify
   orders/events that would be lost.
4. Prefer restoring/forking to a new D1 database, validate it, then change the
   binding. Use in-place Time Travel only with incident-commander approval.
5. Replay verified Razorpay events for the recovery gap idempotently before
   reopening fulfillment.
6. Validate row counts, ownership, paid-order parity, health, and synthetics.

Never restore D1 alone and assume R2/payment consistency. Reconcile all three
systems at the chosen recovery boundary.

## 8. Payment operations and reconciliation

D1 is the product order ledger; Razorpay is the money-movement authority. A
customer receives paid status only through a verified webhook. KV is not used
for payment correctness. `Idempotency-Key` is user-scoped and enforced by a D1
unique constraint.

### Daily reconciliation

Export or query these D1 sets without exposing customer emails:

```sh
npx wrangler d1 execute grihagrid-db --remote --command \
  "SELECT status,COUNT(*) AS count,SUM(amount_paise) AS paise FROM orders GROUP BY status ORDER BY status;"

npx wrangler d1 execute grihagrid-db --remote --command \
  "SELECT id,provider_order_id,status,provider_status,created_at FROM orders WHERE status='created' AND created_at < datetime('now','-30 minutes') ORDER BY created_at;"

npx wrangler d1 execute grihagrid-db --remote --command \
  "SELECT provider_event_id,event_type,order_id,provider_payment_id,processing_result,received_at FROM payment_webhook_events WHERE processing_result NOT IN ('paid','already_paid','ignored_event') ORDER BY received_at DESC LIMIT 100;"
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

The code currently handles paid/captured events but has no refund/chargeback
webhook workflow, invoice/GST integration, admin reconciliation UI, or automated
fulfillment ledger. Those are explicit paid-launch blockers. Until implemented,
any live test/refund requires two-person manual evidence and checkout must remain
closed to the public.

### Emergency checkout stop

There is no application feature flag yet. The current reversible containment is
to remove only the production `RAZORPAY_KEY_SECRET`, after verifying the active
Cloudflare account and Worker name:

```sh
npx wrangler deployments status
npx wrangler secret delete RAZORPAY_KEY_SECRET
```

This makes new checkout creation return `503 payments_unavailable`. Do **not**
delete `RAZORPAY_WEBHOOK_SECRET`; already-paid checkouts must continue to post
verified events. Also hide/disable purchase CTAs in a maintenance release. To
reopen, investigate and reconcile first, restore the key interactively with
`wrangler secret put RAZORPAY_KEY_SECRET`, then run a controlled checkout test.
A dedicated `CHECKOUT_ENABLED` kill switch is required before public sales.

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
5. Add malware scanning/quarantine or restrict production uploads to formats
   that can be safely validated. The current signature checks are not a malware
   scanner, and ZIP/DOCX/XLSX/DWG/DXF need stronger handling.
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

The scheduled handler currently performs four bounded operations:

```sql
DELETE FROM sessions WHERE expires_at < datetime('now');
UPDATE orders SET status='failed', ...
 WHERE status='created' AND created_at < datetime('now','-25 hours');
DELETE FROM ai_generation_leases WHERE expires_at <= datetime('now');
DELETE FROM ai_generation_counters WHERE updated_at < datetime('now','-8 days');
```

It is scheduled for 02:17 UTC daily. Verify after every trigger/config change:

1. Cloudflare dashboard shows cron `17 2 * * *` attached to the current Worker
   version.
2. The scheduled invocation succeeded around 02:17 UTC.
3. The following counts return zero or trend back to zero after the run:

   ```sh
   npx wrangler d1 execute grihagrid-db --remote --command \
     "SELECT COUNT(*) AS expired_sessions FROM sessions WHERE expires_at < datetime('now');
      SELECT COUNT(*) AS expired_ai_leases FROM ai_generation_leases WHERE expires_at <= datetime('now');
      SELECT COUNT(*) AS old_ai_counters FROM ai_generation_counters WHERE updated_at < datetime('now','-8 days');"
   ```

4. Deliberately expired synthetic sessions, checkout links, and AI leases in
   staging are removed by a tested scheduled invocation; recent counters remain.

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
- Tail/search logs using opaque order/project IDs. Do not paste bearer cookies,
  CSRF tokens, emails, addresses, briefs, files, backup contents, or payment
  payloads into chat or tickets.
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
npx wrangler deployments list
npx wrangler rollback <known-good-version-id> --message "Incident <id>: <reason>"
npx wrangler deployments status
```

Before rollback, confirm the chosen version predates the regression and remains
compatible with the **current** D1 schema and bindings. For payment-semantic
changes, close checkout first while keeping webhook verification alive. After
rollback, run health, estimate, auth/project, report, and relevant R2 synthetics;
reconcile all orders created during the incident window.

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

### Paid launch — all are mandatory

- [ ] Separate staging/production resources, secrets, hostnames, and provider
  modes exist; GitHub CI and branch protection gate production releases.
- [ ] All checked-in D1 migrations are verified remotely, a fresh encrypted backup
  exists, and a timed restore drill meets RPO/RTO.
- [ ] R2 subscription is active, `grihagrid-files` exists privately, the `FILES`
  binding is enabled, and upload/download/delete/ownership/orphan checks pass.
- [ ] Upload malware/quarantine strategy and retention/deletion policy are
  approved and tested.
- [ ] `APP_ORIGIN` matches the canonical HTTPS origin exactly.
- [ ] Razorpay live onboarding, keys, webhook secret/events, callback, GST/invoice,
  refund, chargeback, and settlement configuration are complete.
- [ ] One controlled live payment → signed webhook → D1 paid state → fulfillment
  → settlement → refund journey reconciles exactly.
- [ ] Automated or two-person daily payment reconciliation is operational, and
  refund/chargeback state cannot diverge from entitlements.
- [ ] Checkout and fulfillment kill switches are implemented and tested; removing
  the provider key is only an emergency fallback.
- [ ] Structured safe logs, request/version correlation, all paging alerts, and
  external synthetics have been tested by deliberate failure injection.
- [ ] Email verification/recovery/receipts, account deletion, support/refund
  procedures, and security incident contacts work end to end.
- [ ] Pricing, taxes, terms, privacy, refund policy, architectural/engineering
  disclaimers, professional licensing/supply, and trademark/domain are approved.
- [ ] Representative reports and estimates have passed the licensed-practitioner
  quality threshold; unsafe or misleading output has a tested stop mechanism.
- [ ] Capacity test passes at 2× launch peak and cost alerts fire at 50/75/90%.
- [ ] On-call and finance coverage are staffed for the first invited cohort.

### Current decision

**NO-GO for public paid sales.** R2 external billing activation/bucket/binding,
Razorpay live credentials and account setup, canonical `APP_ORIGIN`, production
webhook registration, refund/reconciliation/fulfillment controls, environment
isolation, CI release gates, structured alerting, restore evidence, and several
security/customer-lifecycle controls are not yet proven.

**Potential GO for a clearly labelled free prototype** after the free-demo
checklist passes. Re-evaluate paid launch only when every mandatory item has an
owner, dated evidence, and no unresolved SEV-1/SEV-2 finding. The founder,
engineering on-call, and payment owner must all sign the launch record; silence
or partial completion is a no-go.
