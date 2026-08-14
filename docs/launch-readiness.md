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

The final migration list must show 0001–0009 applied. The smoke must report
HTTP 200 for home, health, readiness, estimate and catalog, with
`freePlanning=true`, `paidCheckout=false` and no accepting catalog plan. Also
capture `/api/readiness` and confirm `checks.schema`, `checks.decisionSchema`
and `checks.paymentSchema` are all `current`, then record the new Worker version
and watch structured error logs for at least 30 minutes. Staging declares no
cron, so this deployment does not consume a sixth Cloudflare free-plan cron.

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

## Project Decision Home release gate

Project Decision Home is a read-only owner command centre over existing source
records. It adds no revision ledger, edit, archive, restore, payment, upload, or
professional-fulfillment capability. The release is GO only when all items
below have dated evidence from the same immutable release.

- [ ] The exact authenticated `GET /api/projects/:projectId/home` projection
  returns only `{ project, lifecycle, current, counts }`, uses `no-store`, maps
  only fixed action codes to `report`, `compare`, or `dashboard`, and returns
  ownership-safe `404` for both missing and foreign projects.
- [ ] A real workerd/D1 journey covers feasibility pending → comparison
  pending → direction pending → decision ready, optional Family aggregate,
  input-change invalidation → feasibility pending → comparison stale, and the
  archived read override.
- [ ] Archived project-input edits, comparison save/choice, upload, checkout,
  new share/room and public Family response calls are rejected and a full-table
  before/after snapshot proves zero D1 writes; no R2 binding is consulted for
  the blocked upload.
- [ ] Migration `0011_archived_project_write_fence.sql` applies once after the
  existing chain; all 13 named triggers exist and readiness reports
  `archiveSafetySchema=current`. Direct D1 mutation canaries fail with the
  bounded archive fence while privacy deletes/revocations and paid-state
  updates retain their documented behavior.
- [ ] Whole-project deletion with private-file metadata returns
  `409 project_has_files` before storage or database mutation; file-free project
  deletion and payment-history retention keep their existing contracts.
- [ ] Repeated Home GETs reconcile every project/report/AI/comparison/
  selection/Family/order/snapshot/fulfillment/progress/analytics source row
  byte-for-byte with no generated report, timestamp, status, counter, progress,
  or aggregate event mutation.
- [ ] Currentness is source-derived: stale historical records contribute only
  to counts; invalid/stale selection and Family state are absent; purchased
  state appears only for the exact current comparison while paid and
  non-revoked, and disappears after refund/dispute without changing finance.
- [ ] Recursive response, DOM, network and log canaries prove no bearer/
  receipt/hash, individual Family row, stored JSON envelope, provider ID,
  checkout URL, reconciliation detail, AI usage or arbitrary navigation URL is
  exposed. Operational logs template `/api/projects/:projectId/home`.
- [ ] Malformed and encoded IDs, non-GET methods and unknown nested API routes
  produce bounded JSON `4xx` responses rather than scanner-induced `500` or an
  HTML SPA fallback.
- [ ] Dashboard, registration handoff, report, comparison and Home links pass
  browser back/forward navigation, session expiry and slow-network recovery
  without a dead end or duplicate request that changes source state.
- [ ] The ordered four-step semantic list, stale/current/optional/complete/
  archived text, and single primary action pass keyboard-only, screen-reader,
  visible focus, contrast, 390 px, 200% zoom, text spacing and reduced-motion
  checks with no overlap or horizontal overflow.
- [ ] Fresh migrations, full automated suite, production and staging Worker
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
