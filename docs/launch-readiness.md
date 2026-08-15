# Launch readiness

## Current decision

**The free public demonstration is live with paid checkout closed. NO-GO for
accepting public money or issuing paid Decision Compare artifacts.**

The application, free estimator, authentication, projects, deterministic
report, Gemini brief, production Worker/D1/KV and an isolated staging D1/KV are
implemented. Decision Compare is the intended no-upload ₹999 pilot wedge. Its
canonical contract is in `docs/decision-compare.md`.

Cloudflare R2 is explicitly deferred for this wedge because it accepts
structured inputs and can use a versioned print artifact. This exception does
not make uploads available and does not waive any money, identity, recovery,
quality, or operational gate below.

Brief Check, Change Study and immutable project-revision history are live as a
paid-closed product release. They remain concept-stage planning aids rather than
feasibility, code, design, structural or construction approval. Paid checkout,
fulfillment, the paid-plan allowlist and private uploads remain closed.

## Brief Check and revision-history release recorded on 2026-08-15

The deployed application source is exact merged-main SHA
`4bee3e86271794f273d8d401cf30d5737d97d394`. Production Worker version
`5ec5aeb2-d60b-409e-a7cd-7d7194ca7485` and staging Worker version
`b3a9b456-4455-4de8-9ec0-6b9451e9a2fb` both carry tag
`brief-check-v1-4bee3e8`. Migration `0012` is applied in both D1 databases and
no migration remains pending.

| Evidence | Result | Limitation |
|---|---|---|
| Reviewed source and protected checks | [PR `#17`](https://github.com/prakhar267/grihagrid/pull/17) merged as `4bee3e86271794f273d8d401cf30d5737d97d394` from exact head `e865ec17a58558b28681fa2ba1cb677913906877` after [CI `31851674165`](https://github.com/prakhar267/grihagrid/actions/runs/31851674165) and [CodeQL `31851672158`](https://github.com/prakhar267/grihagrid/actions/runs/31851672158) passed. Post-merge [main CI `31851934838`](https://github.com/prakhar267/grihagrid/actions/runs/31851934838) and [CodeQL `31851934701`](https://github.com/prakhar267/grihagrid/actions/runs/31851934701) also passed on the deployed SHA | Automated review does not replace an independent human approval, penetration test or accessibility certification |
| Local and real-D1 release gates | The exact frozen tree passed the production build, operational checks and **96/96** serialized tests; fresh migrations `0001`–`0012`, production/staging Worker dry-runs, high-severity dependency audit and diff hygiene passed. Real workerd/D1 tests cover zero-write preview, CAS and idempotency races, immutable revision/report history, migrated-v1 truth, rollback compatibility, Gemini supersession, ownership, archive and deletion boundaries | Synthetic and local concurrency does not establish customer comprehension, long-running load behaviour or professional planning correctness |
| Staging recovery point and schema | Immediately before migration, staging contained users=0, projects=2, reports=0 and orders=0. Mode-0600 export `grihagrid-staging-pre-0012-20260814T235514Z.sql` on the FileVault-encrypted operator volume has SHA-256 `fb31507ecdb694e136d949fd611caa9f8e2a8f27955ce7a8b912a806389e6282`; Time Travel bookmark `00000038-00000000-000050c7-c35fb78b4ab82764865a80b0724c9636` and previous Worker `091268fd-8359-4367-981e-e38d64440b47` were recorded. Migration produced exactly two baselines, zero report snapshots/requests, three tables, three indexes and fourteen readiness-counted triggers, with zero reconciliation or foreign-key violations | The local encrypted recovery copy is not a separately governed off-site backup; staging intentionally has no Gemini, R2, payment secrets or cron |
| Staging release, canary and rollback | Public smoke and the authenticated report-v2 → zero-write preview → accepted revision → same-key replay → stale conflict → history/detail → historical report → cross-owner `404` → archive fence → deletion journey passed with exact cleanup. The previous Worker was briefly restored at 100%, successfully performed a legacy source update under migration `0012`, produced two null-fingerprint compatibility revisions, and was then replaced by the new version. A 30-minute exact-version observation (`2026-08-15T00:00:51.043Z`–`00:30:53.106Z`) passed 21 samples, 63 endpoint checks and 210 assertions with zero failures and zero error-tail events | This proves the deterministic paid-closed path and short application rollback, not paid-provider or Gemini behaviour in staging |
| Production recovery point and schema | Immediately before migration, production contained users=1, projects=1, reports=1 (schema v1), AI briefs=1 and orders=0. Mode-0600 export `grihagrid-production-pre-0012-20260815T003128Z.sql` on the FileVault-encrypted operator volume has SHA-256 `e825af2f092d1732b3396d2b0e97e20a758aeefd886ec4b30a3f044ee5856d18`; Time Travel bookmark `0000005e-00000000-000050c8-3c1f7642bb88bb6259e4d304b2944205` and previous Worker `588f0fb0-5973-44fd-9b6f-299e3aad5c51` were recorded. Migration produced one honest current baseline and one immutable historical v1 report, with zero reconciliation/foreign-key violations and exact three-table/three-index/fourteen-trigger readiness shape | The encrypted local copy and D1 Time Travel are immediate recovery evidence, not the required durable off-site backup or a new timed restore drill |
| Production deployment and authenticated canary | Worker `5ec5aeb2-d60b-409e-a7cd-7d7194ca7485` reached 100% traffic. Readiness reports every schema current, `briefCheck=true`, Gemini configured, `paidCheckout=false`, `privateUploads=false` and an empty paid-plan allowlist; the catalog accepts no order. A secure-session canary passed read-only report `404` → explicit v2 report → zero-write preview → revision save/replay/stale conflict → immutable history → pre-report AI rejection → current v2 report → real sanitized Gemini generation/cache reuse → cross-owner `404` → archive fence → deletion. Exact cleanup restored users/projects/reports/AI briefs to `1/1/1/1`, revisions/report snapshots to `1/1`, and orders/revision requests/synthetic users to zero | The Gemini call validates integration and currentness, not model-output correctness at scale; the existing production user's v1 report remains historical until that owner explicitly generates v2 |
| Production observation | A 30-minute exact-version observation (`2026-08-15T00:35:22.512Z`–`01:05:24.382Z`) sampled health, readiness and catalog 21 times at roughly 90-second cadence. All 63 HTTP requests and 546 assertions passed; readiness, all seven schema checks and configured AI/rate/abuse controls stayed healthy; paid checkout, private uploads and every catalog order remained closed. The Cloudflare `status=error` tail for exact Worker `5ec5aeb2-d60b-409e-a7cd-7d7194ca7485` emitted zero events. Request latency was 11 ms minimum, 1,985 ms maximum and 658 ms average | This bounded single-region observation is not a load test, long-term SLO record or independent multi-region authenticated synthetic |
| External public synthetic | Manually dispatched [run `31854021837`](https://github.com/prakhar267/grihagrid/actions/runs/31854021837) passed staging and production liveness, readiness, security-header and fail-closed-commerce jobs on exact deployed SHA `4bee3e86271794f273d8d401cf30d5737d97d394` | One GitHub-hosted source is not independent multi-region monitoring and does not exercise authentication or Gemini |

Paid acceptance remains **NO-GO**. A governed whole-account erasure service,
Razorpay/KYC/refund/invoice operations, durable off-site backup/restore evidence,
independent human approval and broader assistive-technology testing remain open
launch gates. Authorized project deletion is implemented and tested; operators
must never substitute raw `DELETE FROM users` for account erasure.

## Evidence recorded on 2026-08-14

| Evidence | Result | Limitation |
|---|---|---|
| Independent local release rehearsal | Final `npm run check` passed a production build, all **69/69** serialized tests and operational-config validation after migrations 0008–0009 and payment-race hardening; that product tree was subsequently reviewed and merged through protected PR `#3` | Local synthetic evidence does not replace browser, provider, accessibility, load or live-environment proof |
| Real D1/Worker Decision Compare and payment E2E | Fresh 0001–0009 migrations plus real local workerd/D1/KV passed owner isolation, editable A→B pre-checkout choice, monotonic source revision, atomic checkout-race rollback, post-boundary immutability, webhook reconciliation while fulfillment was paused, artifact/share/progress access, refund/dispute revocation, aggregate-only browser events, privacy-bounded paid-cohort milestones and abandoned-checkout deletion. Adversarial SQL-time refund/dispute-versus-capture and duplicate-late-capture reconciliation also passed without incorrect fulfillment | Uses synthetic provider records and signed test webhooks; no Razorpay network call, remote D1 or multi-process load was exercised |
| Schema and bundle gates | `npm run check:migrations` freshly applied all nine migrations; final production and isolated staging Worker dry-runs passed. Both bundles bind distinct D1/KV resources, declare version metadata/observability, omit R2, and keep checkout, fulfillment and the paid allowlist closed | Dry-runs do not prove remote migration, secrets, routing, deployed version or provider mode |
| Isolated staging release | Remote migrations 0008–0009 applied after preflight confirmed zero orders; Worker version `9d754f65-b77c-4395-b67b-0d2dceb8e5dd` deployed with checkout/fulfillment/allowlist closed. Public smoke passed home, health, readiness, estimate and catalog. A real secure-session journey passed register → project → report → compare → A/B choice change → cross-origin rejection → closed checkout → delete → logout, followed by exact synthetic-user cleanup; `checks.schema`, `decisionSchema` and `paymentSchema` reported `current` | Paid provider, AI and R2 are intentionally unconfigured in staging; this proves the deterministic paid-closed path, not a live-money journey |
| Deployed visual audit | The staging Decision Compare editor, working artifact, side-by-side measures, recommendation, architect handoff questions and paid-closed panels passed screenshot-first desktop review and live choice interaction with zero browser-console errors; the same release CSS had already passed 390 px reflow with no horizontal overflow | This is targeted visual/interaction evidence, not a complete WCAG 2.2 AA screen-reader or device-matrix certification |
| Protected GitHub release | PR `#3` merged as `da7abd9064adc31be8f1316ba6cfc85b04021c0e` only after the required build/test validation, CodeQL JavaScript analysis and CodeQL policy check passed on the final head. The post-merge `main` CI and security-update checks also passed | The repository still does not require an independent human approval or enforce environment reviewers; CodeQL and review do not replace penetration testing |
| Production backup and recovery point | Immediately before production migration, D1 contained users=1, projects=1, reports=1, AI briefs=1 and orders=0. A mode-0600 export outside the repository has SHA-256 `5e36b156b46a789915a054cd7ca10e7acd94b48f1dcff24e28532cf2c0aeb595`; Time Travel bookmark `00000025-00000000-000050c6-5ae043941e6f9ceb675421d8a2aa7f5c` and previous Worker version `3536f47c-d92d-4789-afec-eccc1b457acb` were recorded | The operator-local export is not approved durable encrypted backup storage; retain D1 Time Travel and move exports into the governed backup destination |
| Paid-closed production release | Remote migrations 0007–0009 applied and Worker version `da71e617-fb51-4559-8e23-40dc8aa23740` deployed from merged `main`. Public smoke, current schema/readiness, a secure-session register → project → report → real sanitized Gemini brief → compare → A/B change → cross-origin rejection → paid-disabled checkout → delete → logout journey, public-sample screenshot/console review and exact cleanup passed. Final data returned to the original 1/1/1/1/0 boundary with zero Decision/payment test rows | Checkout/fulfillment/allowlist remain closed; this proves the free and deterministic product path, not Razorpay settlement, receipts, refund operations or paid quality control |
| External read-only synthetic | Manually dispatched GitHub run `31740980038` passed production and staging homepage, health, readiness, estimate, security-header and paid-closed catalog checks; the same workflow is scheduled hourly | One GitHub-hosted source is not the required two-region monitor and does not exercise authentication, Gemini or payment webhooks |
| Dependency and static safety checks | `npm audit --audit-level=high` reported zero vulnerabilities; `git diff --check` passed; focused final source scans found no live-key/private-key signature or dangerous DOM execution sink | Pattern scanning is not full history scanning, penetration testing, the post-commit CodeQL run, or a browser CSP/XSS exercise |

### Family Alignment paid-closed release

Family Alignment is live as a free, optional collaboration surface. Public
payment acceptance and paid Decision Compare fulfillment remain closed. The
release evidence below applies to the immutable production source
`64d3de43f3189d67cca5c6b1eaf52d650a4177c1`.

| Evidence | Result | Limitation |
|---|---|---|
| Reviewed source and protected checks | Feature PR `#8` merged as `4c8f114`; the remote-migration parser correction PR `#9` merged as `64d3de4`. Post-merge main [CI run `31750350861`](https://github.com/prakhar267/grihagrid/actions/runs/31750350861) and [CodeQL run `31750350269`](https://github.com/prakhar267/grihagrid/actions/runs/31750350269) both completed successfully on the production SHA | GitHub still does not require an independent human approval or protected environment reviewer |
| Local release gates | `npm run check` passed the production build, operational checks and **75/75** tests. Fresh migrations `0001`–`0010`, production/staging Worker dry-runs, `npm audit --audit-level=high` and `git diff --check` passed | Automated evidence does not replace assistive-technology or multi-region load testing |
| Real D1 concurrency and lifecycle | Real workerd/D1 tests cover one room per immutable comparison, first-link replay, five-receipt cap, same-receipt update at cap, concurrent unique writers, response-versus-revoke closure, expiry, 90-day retention, cross-owner access, malformed tokens, redaction, payment isolation and five-child project cascade deletion | Test traffic is synthetic and does not establish household adoption or comprehension |
| Staging migration and release | A mode-0600 pre-migration export has SHA-256 `0cd6851d51c0e5eb54253e3e1bed642bae50985fe0069cdf40a36cb0de4dc700`; Time Travel bookmark `00000014-00000000-000050c6-4f62285eb325c0221f3436766c0886b4` was recorded. Corrected migration `0010` applied once, producing exactly two Family tables, seven triggers and three indexes. Worker version `2f5b9298-b6f0-4112-b73c-a06befc2917f` passed public smoke and the authenticated create → redacted read → response → update → summary → revoke/`410` → project-delete journey; cleanup returned Family and synthetic rows to zero | Staging intentionally has no Gemini, R2 or payment secrets and no cron |
| Production recovery point | Immediately before migration, production contained users=1, projects=1, reports=1, AI briefs=1 and orders=0. A mode-0600 export outside the repository has SHA-256 `e2f15443670c07b66c758ddc4b8e23b39de81c5c508533da6addbe0b74c406c5`; Time Travel bookmark `0000002d-00000000-000050c6-e71f17803d8acad300f070f684957093` and previous Worker version `da71e617-fb51-4559-8e23-40dc8aa23740` were recorded | The operator-local export must still be moved to governed encrypted backup storage |
| Production migration and deployment | Migration `0010` applied successfully and no migration remains pending. D1 exposes exactly two Family tables, seven triggers and three indexes. Worker version `13643004-0686-47e9-96b1-f4d836340ccb` is deployed; readiness reports `familyAlignmentSchema=current` and `familyAlignment=true` while `paidCheckout=false`, `acceptingPaidPlans=[]` and the ₹999 catalog item remains closed. Independent GitHub-hosted [public smoke run `31751351609`](https://github.com/prakhar267/grihagrid/actions/runs/31751351609) passed on the deployed production SHA. A 30-minute version-scoped observation captured 19 sample sets/57 health, readiness and catalog requests through `2026-08-13T23:12:15Z`: every request was HTTP 200, schema/capabilities stayed stable, and the Cloudflare error-only tail emitted zero events | The first immediate multi-colo smoke reached one pre-rollout readiness response; the canonical smoke passed after propagation at `2026-08-13T22:42:50Z` |
| Production journey and cleanup | A secure-session synthetic passed register → project → immutable comparison → room → public redaction → first response → own response update → owner aggregate → revoke → public `410` → project delete → logout. Exact cleanup left synthetic users, rooms, responses and orders at zero and preserved the original 1/1/1/1 production boundary | This proves the technical free journey, not long-term retention execution or customer comprehension |
| Visual, privacy and accessibility review | Production desktop rendered with no horizontal overflow or console errors, semantic headings, four named fieldsets, one live region, 11 radios and six checkboxes. Public canaries confirmed project name, city and raw option labels were absent. The same release passed 390 px reflow, 48 px targets, keyboard focus, three-reason announcements and save → update → reload receipt reuse in the local browser QA | VoiceOver/NVDA, an independent 200% zoom/text-spacing/contrast audit and device-matrix certification remain outstanding |

### Project Decision Home and fail-closed upload release

Project Decision Home and the fail-closed private-upload UI are live in
Cloudflare Worker version `588f0fb0-5973-44fd-9b6f-299e3aad5c51`, deployed
from the operator-recorded reviewed application source commit
`e2935ef27a146c981ceb67c484636a3920ddb573`. PR `#15` changed only the external
smoke harness and its tests; current-main SHA
`6c6188833b2bc44d3699f7a156482e1b44c5e7fd` is the source of the hardened
synthetic, not a newer application bundle. Paid checkout, fulfillment, the
paid-plan allowlist and private uploads remain closed.

| Evidence | Result | Limitation |
|---|---|---|
| Reviewed source and protected checks | Project Decision Home [PR `#12`](https://github.com/prakhar267/grihagrid/pull/12) merged as `ef726dfa1c29762d1cbe8be2b32b12df0dbbd517` from head `354905b0308e21608f02e51a2aa05a7dec13da60` after [CI run `31811918878`](https://github.com/prakhar267/grihagrid/actions/runs/31811918878) and [CodeQL run `31811916943`](https://github.com/prakhar267/grihagrid/actions/runs/31811916943) completed successfully. The fail-closed upload correction [PR `#13`](https://github.com/prakhar267/grihagrid/pull/13) merged as `dfaa9f54450f7c6007e0e033d48b22c9273d70fd` from exact head `d4caa852d18da16e6dc1ad8a6cca2a34c7f105c8`; [CI `31814603407`](https://github.com/prakhar267/grihagrid/actions/runs/31814603407) and [CodeQL `31814602303`](https://github.com/prakhar267/grihagrid/actions/runs/31814602303) passed. The final storage-qualified copy [PR `#14`](https://github.com/prakhar267/grihagrid/pull/14) merged as `e2935ef27a146c981ceb67c484636a3920ddb573` from head `1654236ed722039fbc9f03996328444861ed088b` after [CI `31815815854`](https://github.com/prakhar267/grihagrid/actions/runs/31815815854) and [CodeQL `31815814074`](https://github.com/prakhar267/grihagrid/actions/runs/31815814074) passed. The bounded synthetic retry [PR `#15`](https://github.com/prakhar267/grihagrid/pull/15) merged as `6c6188833b2bc44d3699f7a156482e1b44c5e7fd` from head `271fdfbffe38ff6ab259527c069b47ecf33ee2ff` after [CI `31816645379`](https://github.com/prakhar267/grihagrid/actions/runs/31816645379) and [CodeQL `31816643227`](https://github.com/prakhar267/grihagrid/actions/runs/31816643227) passed. Post-merge [main CI `31816883423`](https://github.com/prakhar267/grihagrid/actions/runs/31816883423) and [CodeQL `31816882564`](https://github.com/prakhar267/grihagrid/actions/runs/31816882564) also passed on exact SHA `6c6188833b2bc44d3699f7a156482e1b44c5e7fd` | GitHub still does not require an independent human approval or protected environment reviewer; automated review does not replace penetration or accessibility testing |
| Staging schema and deployment | Migration `0011_archived_project_write_fence.sql` applied successfully, no migration remains pending, and all 13 named archive-safety triggers exist. Project Decision Home first deployed as Worker version `6f4726ab-1271-4cc3-b324-3af076e8d8d1`, the fail-closed upload-UI correction as `553626b4-1eb7-4989-9abb-59c2065b6c0e`, and final storage-qualified copy as `091268fd-8359-4367-981e-e38d64440b47`. Public smoke and readiness passed with `schema=current`, `archiveSafetySchema=current`, `privateStorage=unavailable`, `privateUploads=false`, `paidCheckout=false` and `acceptingPaidPlans=[]` | Staging intentionally has no Gemini, R2 or payment secrets and no cron; it proves the deterministic paid-closed release, not provider or scheduled-operation behavior |
| Staging browser and synthetic cleanup | Browser checks showed the unavailable private-storage state instead of a file picker while project creation and report use remained available without uploads. The authenticated Project Decision Home lifecycle and archive/write-fence synthetic passed. Cleanup removed the canary user and returned comparisons, selections, Family rooms/responses, orders and project files to zero while preserving the pre-release staging boundary of two existing project rows | The browser check is targeted release evidence, not an assistive-technology, device-matrix or slow-network certification |
| Local release gates | The production build, full 85/85 automated suite, fresh `0001`–`0011` migration rehearsal, production and staging Worker dry-runs, high-severity dependency audit and `git diff --check` all passed | Local and CI automation does not replace a production penetration test, accessibility certification or provider-backed purchase rehearsal |
| Production recovery point | Immediately before migration `0011`, a mode-0600 export named `grihagrid-db-pre-0011-20260814T153456Z.sql` was stored outside the repository with SHA-256 `2ae738c8192f7f350919c60c260fc574820a8de5a0b09dae5fba0a80b38f01b4`. Time Travel bookmark `0000003e-00000000-000050c7-027b91a9b57fe4fcdbd05f9b56eb2619` and previous Worker version `13643004-0686-47e9-96b1-f4d836340ccb` were recorded | The operator-local export is a temporary recovery copy and must be moved to governed encrypted backup storage; no new remote restore drill is claimed |
| Production migration and deployment | Migration `0011` applied successfully, no migration remains pending, and D1 exposes all 13 archive-safety triggers. Worker version `a9c557d5-9a23-40ab-bf80-4300eb814776` passed the authenticated lifecycle canary; copy-only version `588f0fb0-5973-44fd-9b6f-299e3aad5c51` is the final deployment. Public smoke and readiness passed with every schema check current, `archiveSafetySchema=current`, `privateStorage=unavailable`, `privateUploads=false`, `paidCheckout=false` and `acceptingPaidPlans=[]` | R2 and paid commerce remain deliberately unavailable; this release does not prove uploads, Razorpay, professional fulfillment or paid quality control |
| Production cleanup and boundary | Canary cleanup returned production to users=1, projects=1, reports=1 and AI briefs=1, with zero comparisons, selections, Family rooms/responses, orders and project files | Aggregate counts prove cleanup at the recorded boundary, not absence of every possible logical or privacy defect |
| Public read-only synthetic | The initial post-deploy [run `31816218985`](https://github.com/prakhar267/grihagrid/actions/runs/31816218985) and its failed-job rerun each hit the staging readiness request's fixed eight-second client deadline; production passed and direct staging checks remained healthy. PR `#15` added one bounded retry only for transient timeout/network errors, a 12-second attempt budget and attempt telemetry. [Run `31816895236`](https://github.com/prakhar267/grihagrid/actions/runs/31816895236) then passed staging and production in 11–12 seconds; HTTP and contract failures remain immediate | A successful bounded synthetic is availability evidence, not a substitute for continuous external multi-region monitoring |

The final version-scoped production observation ran from
`2026-08-14T15:50:25.247Z` through `2026-08-14T16:20:26.734Z` (30 minutes,
1.487 seconds) with Worker version
`588f0fb0-5973-44fd-9b6f-299e3aad5c51` at 100% traffic. All 21 sample sets
passed and all 63 health, readiness and catalog requests returned HTTP 200;
endpoint failures, invariant failures and failed sample sets were zero. Every
readiness/schema and fail-closed capability stayed at its release baseline. The
exact-version
Cloudflare `status=error` tail remained live beyond the observation end and
captured zero Worker error events.

The free feature is **GO for a controlled household cohort** with the paid
controls closed. Do not describe the wider product as enterprise-certified or
open payment acceptance until the remaining legal, recovery, monitoring,
accessibility and payment gates below are completed.

## Evidence recorded on 2026-08-13

| Evidence | Result | Limitation |
|---|---|---|
| Baseline build/test | 50/50 automated tests passed; fresh application of migrations 0001–0006 passed; production/staging Worker dry-run and post-change suite must be rerun | Point-in-time local result, not deployed Decision Compare proof |
| Dependency audit | `npm audit --audit-level=high` reported zero vulnerabilities | Does not replace supply-chain review or runtime testing |
| Production D1 pre-change export | SHA-256 `5e36b156b46a789915a054cd7ca10e7acd94b48f1dcff24e28532cf2c0aeb595`, file mode 0600, stored outside repository | Local operator storage is temporary; move to approved encrypted storage |
| Isolated local restore drill | Restored users=1, projects=1, reports=1, AI briefs=1, orders=0 | D1 `PRAGMA integrity_check` was unavailable through the authenticated path; schema and aggregate checks were used; remote staging RTO still unproven |
| Staging isolation | Dedicated Worker, D1 `grihagrid-staging-db` and KV `staging-GRIHAGRID_CACHE`; deployed hostname passed public read-only smoke at 2026-08-13T18:16Z | Decision Compare migration/redeploy, auth journey and provider test-mode journey remain unproven; Gemini intentionally has no staging secret |
| Public read-only synthetics | Production and staging homepage, health, readiness, estimate and paid-closed catalog passed at 2026-08-13T18:16Z | One-region point check; does not prove auth, webhook, fulfillment or alerts |
| GitHub controls | Strict protected `main` with required CI/conversation resolution; secret scanning and push protection, production/staging environments, vulnerability alerts, Dependabot security fixes and private vulnerability reporting configured; CodeQL default-setup run `31729695152` completed successfully | That CodeQL run predates the unpushed Decision Compare release; required pull-request review/admin enforcement and environment reviewer/branch policies were not configured at the last API check; one successful scan is not a penetration test |
| Cloudflare staging cron | Staging Worker/assets deployed; production cron remains `17 2 * * *` | Account is at the five-cron free-plan limit (Cloudflare API 10072), so staging intentionally declares `crons=[]`; exercise scheduled maintenance locally until capacity exists |
| Production usage boundary | One synthetic demo account/project/report/AI brief and zero orders at last inspection | There is no real willingness-to-pay, quality, refund, or support evidence |

## Staging deployment evidence and repeatable handoff

The paid-closed staging rehearsal above is complete. Repeat it from a reviewed
immutable commit with green CI, Cloudflare authentication to account
`41ed7bc118fad2779267d4e61988f423`, and confirmation that the target still
resolves to Worker `grihagrid-staging`, D1
`ac7ff387-c8c6-40d2-b9db-83078378c054` and KV
`f48c3f765bc84088a88376e887daf7b1`. Do not alter the checked-in staging values
`PAID_CHECKOUT_ENABLED=false`,
`DECISION_COMPARE_FULFILLMENT_ENABLED=false` or
`ENABLED_PAYMENT_PLANS=""` for this deployment.

Run the following from the immutable release checkout. Every remote D1 command
uses the `DB` binding and explicit staging environment; never substitute the
production database name.

```sh
npm ci
npm run check:migrations
npm run check
npm run check:worker
npm run check:worker:staging
npm audit --audit-level=high

npx wrangler whoami
npx wrangler d1 migrations list DB --remote --env staging
npx wrangler secret list --env staging
npx wrangler deployments status --env staging
npx wrangler d1 migrations apply DB --remote --env staging
npx wrangler d1 migrations list DB --remote --env staging
npm run deploy -- --env staging
npm run smoke -- https://grihagrid-staging.prakhargupta267.workers.dev
```

The final migration list must show 0001–0011 applied. The smoke must report
HTTP 200 for home, health, readiness, estimate and catalog, with
`freePlanning=true`, `paidCheckout=false` and no accepting catalog plan. Also
capture `/api/readiness` and confirm `checks.schema`, `checks.decisionSchema`,
`checks.paymentSchema`, `checks.familyAlignmentSchema` and
`checks.archiveSafetySchema` are all `current`, then record the new Worker
version and watch structured error logs for at least 30 minutes. Staging
declares no cron, so this deployment does not consume a sixth Cloudflare
free-plan cron.

No secret is required merely to deploy the paid-closed deterministic flow.
`GEMINI_API_KEY` is intentionally absent; add a distinct staging key only if
the AI-brief journey is in scope. `METRICS_READ_TOKEN` is needed only to test
the protected aggregate. A Razorpay staging purchase additionally requires
three **test-mode-only** staging secrets and the exact test webhook
`https://grihagrid-staging.prakhargupta267.workers.dev/api/payments/razorpay/webhook`:

```sh
npx wrangler secret put GEMINI_API_KEY --env staging
npx wrangler secret put METRICS_READ_TOKEN --env staging
npx wrangler secret put RAZORPAY_KEY_ID --env staging
npx wrangler secret put RAZORPAY_KEY_SECRET --env staging
npx wrangler secret put RAZORPAY_WEBHOOK_SECRET --env staging
```

Never copy production values. Opening a controlled Razorpay test-mode journey
is a separate reviewed staging change that sets all three commerce controls;
it is not a prerequisite for the first paid-closed deployment and must not be
carried into production. Export staging first if its synthetic evidence must be
retained, and keep the paid launch NO-GO until the remote restore, provider,
legal, monitoring and operational gates below have dated evidence.

## Blocking external and owner-supplied work

- [ ] Trademark, product/company identity and domain clearance are signed off.
- [ ] Counsel approves privacy, terms, consent, disclaimers, refund and explicit
  no-correction/reissue boundary, retention/deletion, tax wording and customer
  communications. The code currently records technical consent version
  `pilot-v1`; that constant and its exact checkbox copy must be versioned again
  if counsel changes the approved text.
- [ ] Razorpay live onboarding/KYC, restricted credentials, exact webhook
  events, GST/invoice/receipt, settlement, refund and chargeback configuration
  are complete.
- [ ] One authorised live ₹999 purchase → signed webhook → entitlement →
  receipt → settlement → full refund journey reconciles exactly with two-person
  evidence. Do not use a token ₹1 test for a server-priced ₹999 SKU.
- [ ] A transactional email domain/provider is configured with SPF, DKIM and
  DMARC; verification, recovery, receipt, refund and incident emails pass.
- [ ] A dedicated Gemini project/key replaces the shared beta credential;
  quotas, cost alerts, representative evaluation and provider failure policy
  pass. Core comparison remains deterministic when Gemini is unavailable.
- [ ] Named incident, engineering, payment, privacy/security and
  quality/professional owners plus backups accept their responsibilities.
- [ ] A suitably qualified practitioner independently checks the first ten paid
  pilot artifacts. This is internal quality control, not advertised review.

## Code, product and QA gates

- [ ] `decision_compare` is the only newly purchasable SKU and server-owned at
  `99900 INR`; legacy order values remain readable but cannot create checkout.
- [ ] Checkout requires explicit, unselected acceptance of both the current
  terms/refund links and the professional-verification boundary; stale or
  missing consent is rejected and the accepted version/time is auditable.
- [ ] Exactly two owner-scoped frozen scenarios use one estimate/rule basis;
  all area/cost/programme/risk values and deltas reconcile across API, UI,
  order snapshot and print output.
- [ ] Saved comparisons and purchase snapshots are immutable/versioned; the
  working A/B choice remains editable only until checkout atomically freezes
  it. V1 has no post-purchase correction/reissue; later input edits create an
  unpaid working version without changing purchased history.
- [ ] Cross-account comparison/artifact/selection/share/order requests return
  ownership-safe `404`; origin, CSRF, session expiry and output-encoding tests
  pass.
- [ ] Payment success, failure, timeout, retry, idempotency, bad signature,
  wrong amount/currency/reference, duplicate/different event replay, late
  payment, refund, dispute, and partial outage tests pass.
- [ ] Paid redirects never grant entitlement; only a verified webhook does.
  Refund/dispute state revokes paid sharing/fulfillment as the approved policy
  requires and remains auditable/reconcilable.
- [x] Checkout and fulfillment controls fail closed, are independently tested,
  and do not prevent receipt of already-signed payment webhooks.
- [ ] Registration/login, email verification, password recovery, session
  management, order history, receipts, account deletion and refund support work
  end to end.
- [ ] Keyboard, screen reader, 200% zoom, reduced motion, WCAG 2.2 AA contrast,
  390/768/1024/1440 layouts, slow network and A4 print/PDF pass.
- [ ] Representative supported city/finish/floor fixtures and both A/B ordering
  directions pass independent numeric and practitioner review.
- [ ] The UI and artifact state the exact exclusions; there is no floor-plan,
  municipal approval, survey, structural, construction-ready or architect-
  reviewed claim.

## SRE and security gates

- [ ] Every HTTP request emits one structured, privacy-safe completion log. The
  implemented environment/method/templated-route/status/duration, bounded
  outcome, opaque request ID/response header and Cloudflare version field pass
  static review; deployed release correlation and captured canary PII/secret
  evidence remain required.
- [ ] Independent external checks cover homepage, `/api/health`,
  `/api/readiness`, estimate and checkout-closed catalog from two regions;
  authenticated comparison and payment journey synthetics run at a safe
  cadence with cleanup.
- [ ] Paging is deliberately tested for two health failures, 5xx >2% for five
  minutes (minimum 20 requests), D1 errors >1%, webhook rejection/backlog,
  money mismatch, paid-fulfillment age, and any ownership/privacy failure.
- [ ] SLOs and dashboards separate free planning, authenticated comparison,
  checkout, webhook, fulfillment and external provider health.
- [ ] A remote encrypted backup and isolated staging restore meet RPO 24 hours
  and RTO 4 hours; row counts, schema, ownership, comparisons, immutable
  artifacts and payment ledgers reconcile.
- [ ] Restore, rollback, provider outage, webhook replay, reconciliation,
  checkout stop, fulfillment stop and secret rotation drills have dated proof.
- [ ] Security review covers dependencies, secrets/history, CSP/HSTS/TLS,
  cookie attributes, origin/CSRF, IDOR, stored/reflected XSS, brute force/rate
  limits, oversized/malformed bodies, webhook signatures and admin metrics auth.
- [ ] Load test at 2× invited-pilot peak meets p95 targets without duplicate
  orders, artifacts or decisions; Cloudflare, Gemini and Razorpay cost/quota
  alerts fire at 50/75/90%.

## DevOps and release gates

- [ ] The protected GitHub default branch requires the current CI check and
  review; secret scanning and dependency alerts are enabled.
- [ ] CI runs locked install, fresh migrations, build/all tests, operational
  config validation, production and staging Worker dry-runs, and high-severity
  dependency audit.
- [ ] Preview/staging never bind production D1/KV/secrets or Razorpay live mode.
  Staging test secrets are entered separately, including
  `npx wrangler secret put GEMINI_API_KEY --env staging`.
- [ ] Production deployment uses a least-privilege credential and immutable
  reviewed SHA; migrations are additive and applied to staging first.
- [ ] Before production migration, record an encrypted export/checksum, D1 Time
  Travel point, previous Worker version and rollback owner.
- [ ] After deployment, record the new Cloudflare version, complete public
  smoke plus synthetic auth/comparison, watch errors for 30 minutes and compare
  financial ledgers before opening checkout.
- [ ] DNS/canonical origin, TLS, HSTS, CSP, robots/sitemap, support/contact and
  privacy/terms/refund pages are correct at the sellable hostname.

## Brief Check and revision-history release gate

Brief Check is a structured-input, deterministic planning aid. It does not
approve feasibility, design, compliance, cost, structure, or construction.
Change Study may save a new source revision only after explicit impact
acceptance. This release does not open paid checkout, fulfillment or uploads.
Every box needs dated evidence from the exact release SHA and Cloudflare version;
unchecked means no-go for this feature.

- [ ] Product and API use only “Needs key facts”, “Programme under tension” and
  “Enough to explore” for customer status, with no numeric score, unconditional
  feasibility, approval, fit or construction-readiness claim. The report embeds
  the same Brief Check and professional validation boundary.
- [ ] Fresh migrations `0001`–`0012` pass, and a pre-`0012` project already at
  revision four creates exactly one truthful `migration_baseline` at four. No
  missing revisions are invented and unknown legacy input remains preserved.
- [ ] D1 contains the three immutable owner-cascading ledgers
  `project_revisions`, `project_revision_requests` and
  `project_revision_reports`; direct update/child delete is fenced while explicit
  whole-project privacy deletion removes all three without orphans.
- [ ] Project deletion is proven to remove its revision/request/report children
  while another owner's project survives. Whole-account erasure is not claimed:
  the current finance-retention schema sets project ownership to null on a raw
  user delete, so a governed account-erasure service remains a separate launch
  blocker and operators must never use direct `DELETE FROM users` as fulfillment.
- [ ] `POST /revisions/preview` proves exact-body/allowlist validation, owner,
  origin, CSRF, archive, rate-limit and stale-source boundaries. A full-table
  before/after snapshot and provider stub prove zero writes and zero Gemini calls.
- [ ] Commit golden, no-op, replay and same-key/different-request cases pass.
  Two same-base saves with distinct keys yield exactly one revision winner and
  one bounded conflict, with no partial Family/report/decision side effect.
- [ ] List, detail and historical-report routes pass exact-object drift checks,
  newest-first bounded pagination, ownership-safe `404`s, history-start truth,
  unsupported legacy-summary redaction and recursive internal-field checks.
- [ ] Current report GET is read-only; explicit POST creates schema-v2 bytes for
  exactly the current revision. Concurrent POSTs leave one immutable v2 snapshot
  with no `500` or cache corruption; editing preserves the prior report and
  invalidates currentness. Migrated v1 is historical only, never current v2.
- [ ] A revision closes active Family rooms permanently. Old comparisons,
  selection, order and purchased snapshot remain byte-for-byte immutable and
  Project Decision Home does not present any of them as current.
- [ ] Archived owners can read their history but cannot preview, save or generate;
  foreign owners receive the same safe `404` as missing. CSRF/origin, malformed
  ID/body, pagination, unknown route and oversized-body cases produce bounded
  documented errors without `500` or mutation.
- [ ] Readiness reports `checks.revisionSchema=current` and
  `capabilities.briefCheck=true` only when every required column, table, index
  and trigger exists. Logs template project/revision IDs and exclude input,
  idempotency keys, content hashes, cookies, CSRF values and legacy canaries.
- [ ] The expanded real-D1 suite, full build/tests, fresh migration check,
  production/staging Worker dry-runs, high-severity dependency audit and diff
  hygiene pass on the exact reviewed commit. Browser QA covers 390 px, 200%
  zoom/text spacing, keyboard, screen reader, reduced motion and history focus.
- [ ] Staging receives a recorded pre-migration export/checksum and Time Travel
  bookmark, migration `0012`, then the new Worker. Paid/upload controls remain
  closed. Authenticated fresh and legacy canaries, log canary, cleanup, rollback
  to the previous Worker, roll-forward and 30-minute version-scoped observation
  all pass before any production migration.
- [ ] Production uses the same ordered backup → migration → Worker procedure,
  records immutable SHA/version/operator/counts, passes public and authenticated
  paid-closed smoke, cleans synthetic data, and preserves a tested rollback owner.

## Report feedback release gate

Report feedback is a separate, structured learning record for one immutable
schema-v2 report. It must remain discoverable at the report decision boundary
without becoming a support ticket, professional approval, report mutation, or
new paid capability.

- [ ] Exact primitive request validation rejects arrays, booleans and numeric
  strings that could otherwise coerce into valid project, revision or feedback
  fields; legacy canonical stored records remain readable.
- [ ] The protected aggregate reconciles eligible schema-v2 reports, total
  responses, response rate, outcome totals, section totals and the outcome ×
  section matrix from one report-generated cohort without returning any resource
  or account identifier. Categorical breakdowns stay suppressed below five
  eligible reports and five responses.
- [ ] `needs_review` visibly stops reliance, points to licensed local review and
  explains that structured feedback does not alert support. Concurrent archive
  changes the mounted control to read-only.
- [ ] Staging and production apply migration `0013` under encrypted backup,
  old-Worker compatibility and exact synthetic-residue gates before candidate
  promotion; paid checkout, fulfillment, plan allowlist and uploads stay closed.
- [ ] The exact merged SHA passes protected CI and CodeQL, authenticated
  report/feedback canaries, public smoke, production cleanup and a 30-minute
  exact-version error-tail observation. Record the final evidence above before
  marking this gate complete.

## Project Decision Home release gate

Project Decision Home is a read-only owner command centre over existing source
records. It adds no revision ledger, edit, archive, restore, payment, upload, or
professional-fulfillment capability. The controlled paid-closed cohort above
is live. Checked items document completed technical evidence; unchecked items
remain expansion gates before a broad unattended cohort or
enterprise-certified claim.

- [x] The exact authenticated `GET /api/projects/:projectId/home` projection
  returns only `{ project, lifecycle, current, counts }`, uses `no-store`, maps
  only fixed action codes to `report`, `compare`, or `dashboard`, and returns
  ownership-safe `404` for both missing and foreign projects.
- [x] A real workerd/D1 journey covers feasibility pending → comparison
  pending → direction pending → decision ready, optional Family aggregate,
  input-change invalidation → feasibility pending → comparison stale, and the
  archived read override.
- [x] Archived project-input edits, comparison save/choice, upload, checkout,
  new share/room and public Family response calls are rejected and a full-table
  before/after snapshot proves zero D1 writes; no R2 binding is consulted for
  the blocked upload.
- [x] Migration `0011_archived_project_write_fence.sql` applies once after the
  existing chain; all 13 named triggers exist and readiness reports
  `archiveSafetySchema=current`. Direct D1 mutation canaries fail with the
  bounded archive fence while privacy deletes/revocations and paid-state
  updates retain their documented behavior.
- [x] Whole-project deletion with private-file metadata returns
  `409 project_has_files` before storage or database mutation; file-free project
  deletion and payment-history retention keep their existing contracts.
- [x] Repeated Home GETs reconcile every project/report/AI/comparison/
  selection/Family/order/snapshot/fulfillment/progress/analytics source row
  byte-for-byte with no generated report, timestamp, status, counter, progress,
  or aggregate event mutation.
- [x] Currentness is source-derived: stale historical records contribute only
  to counts; invalid/stale selection and Family state are absent; purchased
  state appears only for the exact current comparison while paid and
  non-revoked, and disappears after refund/dispute without changing finance.
- [x] Recursive response, DOM, network and log canaries prove no bearer/
  receipt/hash, individual Family row, stored JSON envelope, provider ID,
  checkout URL, reconciliation detail, AI usage or arbitrary navigation URL is
  exposed. Operational logs template `/api/projects/:projectId/home`.
- [x] Malformed and encoded IDs, non-GET methods and unknown nested API routes
  produce bounded JSON `4xx` responses rather than scanner-induced `500` or an
  HTML SPA fallback.
- [ ] Dashboard, registration handoff, report, comparison and Home links pass
  browser back/forward navigation, session expiry and slow-network recovery
  without a dead end or duplicate request that changes source state.
- [ ] The ordered four-step semantic list, stale/current/optional/complete/
  archived text, and single primary action pass keyboard-only, screen-reader,
  visible focus, contrast, 390 px, 200% zoom, text spacing and reduced-motion
  checks with no overlap or horizontal overflow.
- [x] Fresh migrations, full automated suite, production and staging Worker
  dry-runs, dependency audit, paid-closed smoke, staging authenticated journey,
  rollback compatibility, protected CI/CodeQL and a version-scoped production
  observation all pass.

Any Home read that mutates source state, leaks cross-owner or forbidden data,
labels historical work as current/purchased, or exposes an unavailable paid or
upload action is a release blocker.

## Family Alignment release gate

Family Alignment is a free feature, but it exposes a bearer-authorized public
write surface and retained household preference data. The controlled
paid-closed release above is live. The unchecked items below remain expansion
gates before calling the feature enterprise-certified or opening a broad
unattended cohort.

- [x] The full `0001` through `0010_family_alignment.sql` chain applies to an
  empty local/staging D1, migration `0010` applies once to a production-like
  `0001`–`0009` copy, and `/api/readiness` fails closed when either Family
  Alignment table/column/index contract is missing.
- [x] Real-D1 automation covers registration → project → immutable comparison
  → first room create/replay → redacted public read → five distinct receipts →
  own update at cap → sixth rejection → owner summary → separate owner choice
  → revoke/public `410`, plus expiry, retention, cross-owner and paid-isolation
  cases.
- [x] Concurrent create and receipt writers prove one room per comparison,
  five receipts maximum, replay/update idempotency, and a SQL-time closure
  fence for response-versus-revoke/expiry races.
- [x] Public response, DOM, network, source/share metadata, logs, analytics and
  error canaries prove absence of recommendation, owner selection,
  project/account identity, raw input/location/dimensions, notes/questions,
  internal IDs, individual receipts and all raw/digested bearer values.
- [x] Room and response secrets have reviewed entropy, digest-only D1 storage,
  room scoping and one-time delivery. Invocation logs remain disabled; custom
  logs template `/align/<token>` and corresponding API paths; CSP and referrer
  policy prevent third-party disclosure.
- [x] Owner create/read/revoke passes session, canonical-origin, CSRF and IDOR
  tests. Public read/write passes malformed token, abuse limit, cross-room
  token, response takeover, unknown-field, duplicate-reason, HTML/free-text,
  oversized body, expired and revoked tests.
- [x] Only server-side daily aggregate events
  `family_alignment_room_created`, `family_alignment_review_opened`,
  `family_alignment_response_submitted` and
  `family_alignment_room_revoked` are retained on `owner_compare` or
  `family_review`; failures are best-effort and do not produce false core
  errors or browser-emitted duplicates.
- [ ] Cron deletes only Family Alignment rooms whose expiry/revocation boundary
  is over 90 days old and cascades their receipts. Active/recent rooms and all
  projects, comparisons, selections, orders, purchased snapshots and finance
  evidence reconcile unchanged in a restoreable backup.
- [ ] External and authenticated synthetics cover valid public read, a
  synthetic owner create/summary/revoke journey with cleanup, `410` closure
  and a cap fixture without putting bearer URLs/tokens in monitor labels,
  dashboards, alerts, tickets or chat.
- [ ] Keyboard-only, VoiceOver/NVDA, semantic group/name/error inspection,
  status announcements, 48 px targets, contrast, 390 px/200% reflow, text
  spacing, reduced motion and print/share metadata pass on owner and reviewer
  surfaces.
- [x] Privacy/terms copy names seven-day access, the 90-day post-closure
  support/audit window, anonymous structured fields, local response-secret
  behavior, owner aggregate visibility, irrevocable revoke, and the lack of
  professional approval or paid entitlement.
- [ ] Alert failure injection pages on any token/privacy/cross-owner breach,
  cap overrun, response-after-closure, Family Alignment action changing paid
  state, persistent `5xx`, D1 write error spike, cron miss, or retention
  backlog. Named engineering and privacy responders complete the drill.

Release evidence must include an immutable SHA/version, migration output,
automated suite result, redaction/log canaries, D1 concurrency proof,
accessibility record, scheduled-retention before/after counts, rollback
compatibility check, and founder/product + engineering + privacy/quality
sign-off. No customer room is an acceptable production smoke fixture.

## Pilot go/no-go gate

When every gate above has dated evidence, invite at most 20 qualified Pune plot
owners. Open only `decision_compare`; keep uploads and legacy offers closed.
Stop rather than scale unless at least 5/20 pay, at least 60% of paid customers
complete a meaningful decision action inside seven days, at least 90% of paid
artifacts meet the published delivery promise, refunds remain at or below 10%,
and critical numeric, safety, privacy, ownership and financial defects remain
zero.

Founder/product, engineering on-call, payment owner and quality/professional
owner must all sign the launch record. Missing evidence, an unavailable owner,
or silence is a no-go.

## Incident priorities and rollback boundary

- **SEV-1:** incorrect/duplicate charge; unverified entitlement; money-ledger
  mismatch; cross-account exposure; secret leak; material data loss; or an
  unsafe comparison likely to cause harm. Stop affected checkout/fulfillment,
  preserve webhooks and evidence, page owners immediately.
- **SEV-2:** login/comparison unavailable, widespread numeric defect, paid
  fulfillment outside promise, provider degradation, or restore/cron failure.
  Stop affected new work, show honest status and recover within four hours.
- **SEV-3:** isolated retryable failure, delayed non-critical email or cosmetic
  regression. Preserve the last valid artifact and resolve through support.

Rollback the Worker to a known-good version only after checking compatibility
with the current D1 schema. Never reverse an applied migration or lose signed
webhooks. Use an additive corrective migration when schema/state changed, then
verify health, readiness, estimate, auth, comparison reads, checkout state,
webhook handling and reconciliation before declaring recovery.
