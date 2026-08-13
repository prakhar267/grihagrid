# QA test plan

The automated suite is a release gate, not the full launch proof. Every paid
pilot release also needs the dated manual, provider, security, recovery, and
accessibility evidence below. Test accounts use `example.test` addresses and
synthetic project inputs; never put customer data in fixtures or screenshots.
Test files run serially so independent Wrangler/workerd+D1 harnesses cannot
reset each other's local runtime; race and replay cases remain deliberately
interleaved within their own real-D1 fixtures.

## Critical paths

1. Home → adjust estimate → start project → complete four steps → dashboard → report.
2. Home → pricing → select plan → account route.
3. Login/register validation and demo dashboard handoff.
4. Dashboard → report → pricing upgrade.
5. Dark/light theme, mobile navigation, responsive cards and legal routes.
6. Project → create two scenarios → compare → record A/B choice → accept the
   versioned terms and professional boundary → attempt checkout → verified paid
   state → issue the exact version → recover the artifact after a new login.
7. Paid comparison → edit project inputs → create a new unpaid working
   comparison; verify the purchased snapshot/artifact is unchanged and the UI
   makes no correction or reissue promise.

## API cases

- `GET /api/health`: dependency-independent liveness returns 200.
- `GET /api/readiness`: 200 only with current D1 schema and KV; otherwise 503,
  while separately reporting AI schema/admission/config validity and optional
  upload and checkout capability.
- `POST /api/estimate`: valid result; defaults; malformed JSON; wrong content type; dimensions below/above bounds.
- `POST /api/leads`: valid email; invalid email; duplicate email; unavailable database.
- `POST /api/projects`: valid project, normalized estimate, length-limited name and invalid dimensions.
- Unknown `/api/*`: JSON 404. Unknown browser route: SPA fallback.
- Gemini brief: owner isolation; explicit 18+ consent; CSRF/origin enforcement;
  sanitized allowlisted prompt; structured validation; advisory-policy
  rejection; cached replay; refresh; atomic user/platform limits; one-project
  single flight; expired-lease recovery; unchanged-report persistence fence;
  provider timeout/retry mapping; missing/revoked configuration; no secret in
  readiness, responses, bundles, or logs.
- Decision Compare catalog: canonical `decision_compare`, server-owned `99900`
  paise/`INR`; legacy plans cannot create new checkout; unsupported client
  price fields are rejected; checkout and fulfillment flags fail closed.
- Checkout consent: both explicit booleans and the exact catalog
  `termsVersion` are required; missing consent is rejected, stale consent
  returns `checkout_terms_updated`, and the accepted version/time are stored on
  the order. No consent checkbox may be preselected. Checkout must also name a
  non-empty `decisionComparisonId`; the server never silently buys the latest
  comparison.
- Comparison validation: exactly two distinct scenarios; same owner/project;
  normalized server estimates and common rule basis; incompatible or stale
  source version rejected; length/bounds/unknown-field limits enforced.
- Comparison calculation: signed area/cost/bedroom/floor/quality deltas; zero
  delta; both ordering directions; integer boundary and INR display fixtures;
  API, UI, print output, and persisted snapshot reconcile exactly.
- Comparison lifecycle: browser working draft, save immutable version, read,
  select A, change to B before checkout, idempotent repeat, atomically lock the
  current choice with checkout snapshot, reject a post-boundary change, save a
  later comparison version, and edit project inputs after purchase. Race a
  project/choice update against checkout and require full rollback rather than
  a mismatched order/snapshot. Persisted comparison versions and sold data must
  be immutable; v1 exposes no correction or reissue operation.
- Ownership: another user receives ownership-safe `404` for comparison,
  artifact, selection, and order routes; anonymous access is denied;
  list routes cannot include foreign rows.
- Entitlement: unpaid/failed/refunded order cannot issue paid output; verified
  paid webhook issues at most one entitlement; fulfillment-disabled paid order
  remains safely recoverable; provider callback never grants access.
- Paid-cohort progress: artifact open and share creation best-effort preserve
  delivery when the milestone write fails; explicit print/handoff requires
  origin, CSRF, owner, active paid entitlement, and fulfillment; unknown fields
  and actions fail; repeats preserve the first timestamp; refund/dispute closes
  further writes. The protected aggregate reports the correct paid denominator,
  completed-within-seven-days numerator, and rate at 1/30/90-day boundaries.
- Sharing: list/replay/create/public-read all derive `active` from current paid,
  non-revoked entitlement; refund, dispute, expiry, and manual revoke close
  access. A reused share idempotency key with any different request input is a
  conflict, and a bearer token/URL is returned only on first creation.
- Project deletion: provider-backed or webhook/fulfillment/share/progress-linked
  orders force archive with `409`; a failed attempt with no provider identifier,
  link, event, fulfillment, share, or progress is purged with its unused
  snapshot and does not trap the project.
- Payment: valid ₹999 capture; invalid signature; malformed/oversized payload;
  wrong amount/currency/reference/payment ID; replay with same and different
  event IDs; provider timeout; late payment; refund; chargeback; settlement
  mismatch; kill switch; and reconciliation repair procedure. Inject a full
  refund and dispute inside the capture batch after the application pre-read;
  SQL-time reconciliation must prevent fulfillment, persist the final
  refunded/revoked state and close any refund-resolved duplicate-capture case.
- Print/artifact: exact version/title/date/rule basis/disclaimer; all two-scenario
  values visible; no clipped content at A4; meaningful monochrome output; no
  cookie/token/private API URL; user strings rendered as text; no external
  resource dependency after load.
- Operational telemetry: every HTTP invocation emits one structured completion log
  with environment, method, templated route, status, bounded outcome, opaque
  request ID, Cloudflare release/version ID and duration; the response returns
  the same request ID. Raw resource IDs, query strings, share tokens,
  secret/PII/project-content canaries never appear. Captured-log canary and
  deployed release-correlation evidence remain explicit paid-launch gates.
- Browser-event telemetry: only the seven `decision_compare_*` event names and
  documented `surface`/`outcome` values are accepted; storage is daily
  aggregate count only. Reject IDs, versions, free text, client timestamps, and
  unknown properties. The separate paid-cohort table contains only opaque
  order/snapshot keys plus four first timestamps. Metrics read requires a
  constant-time checked token and rate limit and returns no row-level cohort
  data.

## Non-functional checks

- No horizontal overflow at 390, 768, 1024 and 1440 px.
- Visible focus and semantic labels for sliders, selects, form fields, nav and disclosure widgets.
- No console errors on core routes.
- Reduced-motion preference disables transition/scroll animation.
- Generated hero remains sharp and cropped intentionally at desktop/mobile.
- API responses never echo raw secrets or entire personal-data payloads.
- At 2× forecast pilot concurrency, p95 public health/estimate stays below 500
  ms and authenticated/compare requests below 750 ms; no duplicate orders,
  issues, selections, or D1 write errors.

## Decision Compare manual acceptance matrix

| Area | Test | Required result |
|---|---|---|
| Offer | Open pricing/catalog while switches are closed | ₹999 promise is accurate; purchase action is unavailable; no dead checkout link |
| Happy path | Complete A/B comparison using two known fixtures | All values/deltas reconcile to independent calculations and version metadata |
| Responsive | Run flow and print preview at 390, 768, 1024, 1440 px and A4 | No clipped values/actions, horizontal scroll, or hidden disclaimer |
| Accessibility | Keyboard-only, screen-reader landmarks/names, 200% zoom, reduced motion, contrast | WCAG 2.2 AA checks pass; choice is not communicated by colour alone |
| Auth | Expire session between comparison, checkout return, selection and print | Re-authentication resumes safely; no data is leaked or silently lost |
| Concurrency | Double-submit create/checkout/issue/select requests | Unique constraints/idempotency return one canonical result |
| Kill switch | Close checkout, then fulfillment, with an existing paid order | New checkout stops; signed webhooks persist; paid work remains recoverable and honestly messaged |
| Provider outage | Timeout/error checkout creation and delayed webhook | No false paid state, blind retry, duplicate charge, or lost signed event |
| Security | Cross-origin/CSRF/IDOR/XSS payloads in every customer string | Writes reject invalid origin/CSRF; foreign resource stays 404; output executes no markup |
| Recovery | Restore a pre-release export into isolated D1 | Schema, counts, ownership, comparison and money invariants reconcile inside RTO |
| Rollback | Roll back Worker while retaining expanded D1 schema | Known-good code remains compatible; health, estimate, auth, compare reads and webhooks pass |

## Required release evidence

Attach to the release record, without secrets or customer data:

- commit SHA, Cloudflare version ID, applied migration list and operator;
- output of `npm ci`, `npm run check:migrations`, `npm run check`, both Worker
  dry-runs, and `npm audit --audit-level=high`;
- staging and production read-only smoke JSON with timestamp and latency;
- browser/device/accessibility matrix, screenshots of only synthetic records,
  print/PDF checksum, and independent numeric reconciliation;
- controlled Razorpay test-mode journey plus, before money is accepted, one
  authorized live purchase/refund/settlement record checked by two people;
- external monitor/alert failure-injection evidence;
- encrypted D1 backup checksum, isolated restore counts and measured RTO; and
- go/no-go sign-off from founder/product, engineering on-call, payment owner,
  and quality/professional owner.

An unavailable third party, untested manual procedure, or unchecked box is a
failed gate—not an assumed pass.
