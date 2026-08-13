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
8. Register → create project → save Decision Compare → create Family Alignment
   room → open redacted public review → create five receipts → update one
   receipt → reject a sixth → refresh owner summary → explicitly choose A/B →
   revoke → public `410`; repeat expiry, retention, and cross-owner cases.

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
- Family Alignment creation: authenticated owner, trusted origin and CSRF;
  exactly one immutable comparison version; server-owned seven-day expiry;
  idempotent retry/concurrency; no secret reissue on replay; later comparison
  version may create a different room; foreign/missing comparison is the same
  ownership-safe `404`.
- Family Alignment public read: valid active token returns only room
  ID/expiry/count/max-five and exactly two redacted A/B scenarios. Assert the
  full serialized response and rendered document contain no recommendation,
  owner selection, project/account identity, raw input, locality/dimensions,
  notes/questions, internal comparison/scenario IDs, files, orders, payment or
  entitlement fields. Malformed/missing is generic; revoked/expired is `410`.
- Family Alignment receipts: validate the exact role/preference/confidence and
  one-to-three reason allowlists; reject unknown fields, duplicate reasons,
  HTML/URL/free text, body tokens and oversized/malformed bodies. Create five
  distinct room-scoped token receipts, reject a sixth atomically, then prove an
  existing receipt can update without changing the count. Replay/concurrency
  creates no duplicate; missing/wrong/cross-room token cannot read, update, or
  take over a response.
- Family Alignment closure races: interleave receipt create/update with revoke
  and with database-time expiry; no response may commit after closure due to a
  stale application read. Revoke is idempotent, permanently closes public read
  and write, and does not mutate the comparison, owner selection, or any paid
  order/fulfillment state.
- Family Alignment owner summary: counts reconcile from zero through five;
  derived state covers `no_responses`, `split`, `leaning_a`, `leaning_b`,
  `aligned_a`, `aligned_b`, and `not_ready`. Assert no receipt rows, response
  identifiers, secrets/hashes, creation order, per-response timestamps, or
  respondent fingerprint can be reconstructed from the response.
- Family Alignment lifecycle: scheduled retention deletes only eligible
  expired/revoked rooms and receipts after the configured retention window.
  Active/recent rooms remain; project, comparison, selection, purchased
  snapshot and finance rows remain byte-for-byte unchanged. Project deletion
  or archive follows the documented ownership/retention contract without
  orphaning room data.
- Family Alignment observability: public token routes are templated and raw
  room/response tokens, token hashes, referrer, query strings, response body,
  structured choices, and private source data never reach logs. Only
  server-side daily aggregate events
  `family_alignment_room_created`, `family_alignment_review_opened`,
  `family_alignment_response_submitted`, and
  `family_alignment_room_revoked` are allowed after valid auth/token and a
  successful core action. Inject aggregate write/counter failures and prove
  room/read/response/revoke results remain truthful with no client duplicate.

## Non-functional checks

- No horizontal overflow at 390, 768, 1024 and 1440 px.
- Visible focus and semantic labels for sliders, selects, form fields, nav and disclosure widgets.
- No console errors on core routes.
- Reduced-motion preference disables transition/scroll animation.
- Generated hero remains sharp and cropped intentionally at desktop/mobile.
- API responses never echo raw secrets or entire personal-data payloads.
- Family review controls use semantic fieldsets/legends or equivalent native
  groups, minimum 48 px targets, associated error text and announced
  recorded/updated/full/expired/revoked states. Keyboard-only and screen-reader
  flows, 200% zoom/text spacing, 390 px reflow, and absolute expiry copy pass;
  print/share metadata contains no secret or project identity.
- At 2× forecast pilot concurrency, p95 public health/estimate stays below 500
  ms and authenticated/compare requests below 750 ms; no duplicate orders,
  issues, selections, Family Alignment rooms/receipts, cap overruns, or D1
  write errors.

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

## Family Alignment manual acceptance matrix

| Area | Test | Required result |
|---|---|---|
| Owner entry | Save a comparison and create a room twice | One room; seven-day expiry; secret URL appears only on first creation; clear privacy/cap copy |
| Redaction | Open the public URL and inspect DOM, network, page source and share metadata | Only neutral A/B review facts; no recommendation, selection, owner/project identity, raw input, notes or secret disclosure |
| Reviewer happy path | Submit with each input method, reload, then update from the same browser | One receipt; recorded then updated announcement; count unchanged; identity is not requested or implied |
| Capacity | Fill five slots, open from a sixth browser, then update an existing response | Sixth browser is honestly non-submittable; retained receipt can still update; count stays five |
| Closure | Keep reviewer form open while owner revokes; repeat across expiry | Submit cannot commit; stable accessible expired/revoked state; no stale private content remains |
| Owner summary | Exercise zero, split, leaning, aligned and not-ready fixtures | Counts/reasons reconcile; copy is advisory; no individual or ordering can be inferred; owner selection is separate |
| Ownership | Request create/summary/revoke from another account | Same safe `404` as missing; no existence, count, comparison, or identity leak |
| Accessibility | Keyboard, VoiceOver/NVDA, 200% zoom, increased spacing, reduced motion, high contrast, 390 px | Logical headings/groups/order, visible focus, 48 px targets, announced status/errors, no color-only meaning or overflow |
| Privacy/logs | Use canary tokens/values while capturing browser requests, Worker logs and D1 rows | Raw tokens/content absent from logs/analytics; only token digests and approved structured data retained |
| Failure injection | Fail analytics/counter writes after each core action | Core result remains correct and retriable; no false `5xx`, duplicate room/receipt, or client double-count |
| Retention | Seed active, recently revoked/expired and retention-eligible rows; invoke scheduled handler | Only eligible Family Alignment rows are removed; comparison/selection/project/payment evidence is unchanged |
| Paid isolation | Run the entire flow with paid switches closed and inspect commerce tables | No order, provider ID, entitlement, artifact or paid flag is created or changed |

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
- Family Alignment redaction diff, five-writer concurrency/cap evidence,
  cross-owner and token-log canaries, revoke/expiry race proof, scheduled
  retention proof, and keyboard/screen-reader/reflow results;
- encrypted D1 backup checksum, isolated restore counts and measured RTO; and
- go/no-go sign-off from founder/product, engineering on-call, payment owner,
  and quality/professional owner.

An unavailable third party, untested manual procedure, or unchecked box is a
failed gate—not an assumed pass.
