# QA test plan

The automated suite is a release gate, not the full launch proof. Every paid
pilot release also needs the dated manual, provider, security, recovery, and
accessibility evidence below. Test accounts use `example.test` addresses and
synthetic project inputs; never put customer data in fixtures or screenshots.
Test files run serially so independent Wrangler/workerd+D1 harnesses cannot
reset each other's local runtime; race and replay cases remain deliberately
interleaved within their own real-D1 fixtures.

## Critical paths

1. Home → adjust width, length, city, floors, and finish → receive an exact
   calculation-checked range and published rule basis → use those details → complete four
   steps → create the project → require the stored recalculation to match →
   dashboard → report.
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
9. Register → create project → open Project Decision Home → generate the
   current feasibility → save a comparison → choose a direction → collect
   optional Family input → recover the exact paid state. Repeat after a project
   input change, refund, archive, new login, and browser back/forward navigation.
10. Register → create a complete brief → open Brief Check → preview one change
    and read Change Study → explicitly accept its impact → save exactly one new
    revision → generate its report → inspect both immutable revisions. Repeat
    with a stale tab, idempotent replay, archived project, and a migrated project
    whose honest history begins above revision one.
11. Register → open Dashboard and Orders → log out from each surface. Require a
    disabled pending state, exact current-session revocation, cleared cookies and
    private browser state, sibling-tab propagation, and a public destination that
    cannot reveal cached account content through Back. Repeat offline, response-loss,
    stale-session, CSRF rejection, D1 failure, rapid repeat activation, keyboard-only,
    390 px mobile, and 200% zoom cases; never claim success while session state is
    unknown.
12. Register → create/generate an exact schema-v2 report → choose only overview,
    risks and next actions → create a 1-day Professional Handoff link → open the
    public route without account cookies → verify exact section redaction →
    revoke → public `410` → delete the project. Repeat with expiry, replay,
    cross-owner, active-link-cap, archive, source-revision and cleanup races.
13. Register with the exact optional-name schema → log in successfully → log out
    → distribute 13 wrong-password attempts across independent IP fixtures →
    require only 12 real-account reservations in one non-sliding window and the
    same generic 401 thereafter → advance beyond expiry → log in and prove the
    exact session transaction clears the fence. Repeat with unknown/deleted
    accounts, malformed credential records, failed KV/D1, password rotation,
    concurrent requests, failed batches, cleanup and old-Worker compatibility.

## API cases

- `GET /api/health`: dependency-independent liveness returns 200.
- `GET /api/readiness`: 200 only with current D1 schema, including
  `projectCreationSchema=current`, and KV; otherwise 503,
  while separately reporting AI schema/admission/config validity and optional
  upload and checkout capability. On the fully current path, assert exactly one
  read-only metadata inventory plus at most one uncached Professional Handoff
  control read—no application-row scan, D1 write, or per-object round trip.
  Remove one required table, column, index, and trigger in turn; return the
  corresponding granular `outdated` state. Malformed/duplicate/missing
  inventory rows, query failure, and an absent or malformed control row must
  fail closed without exposing schema SQL or control data.
- `POST /api/estimate`: exact five-field allowlist; primitive finite width and
  length at inclusive 10/500 boundaries; missing/null optional defaults; every
  supported city/floor/finish; malformed JSON; wrong content type; scalar type
  confusion; `NaN`/infinity at the pure boundary; dimensions below/above bounds;
  enum case/typos; arrays/objects; and unknown address/account/project fields.
  Require the exact normalized `{ input, estimate, basis }` envelope, finite
  non-negative numbers, `lowInr <= highInr`, matching enum echoes, a non-empty
  disclaimer, a real published/versioned INR directional rule, explicit
  `internal_directional_rule` status, `null` current-market calibration date, a
  bounded market warning, positive factors and rate, `lowFactor < highFactor`,
  exact tuple/basis/output arithmetic, explicit tax/fee exclusion, and one to
  eight bounded exclusions. Public browser requests must omit cookies and CSRF.
- `POST /api/leads`: valid email; invalid email; duplicate email; unavailable database.
- `POST /api/auth/register`: require only primitive-string `email` and
  `password` plus optional primitive-string `name`. Exercise every missing,
  extra, null, array, object, boolean and numeric field, malformed/non-object/
  oversized JSON, wrong media, email normalization and 254-character boundary,
  9/10/128/129-character passwords, name normalization and 2/80 boundaries.
  Structural failures are `400 invalid_registration`; value failures retain
  `invalid_email`, `invalid_password`, or `invalid_name`. Missing/failing KV is
  `503 abuse_control_unavailable`. Duplicate normalized email remains
  `409 email_in_use` and is recorded as residual registration enumeration.
- `POST /api/auth/login`: require exactly primitive-string `email` and
  `password`; missing/extra/confused fields are `400 invalid_login`, while an
  invalid email string is `400 invalid_email`. Short/long primitive passwords,
  unknown email, soft-deleted account, malformed credential record, wrong
  password and a closed D1 account fence each perform exactly one real-or-dummy
  PBKDF2 derivation and return the byte-equivalent generic
  `401 invalid_credentials` envelope. Verify behavior/call counts rather than
  treating noisy wall-clock timing as proof.
- Login admission: missing/failing KV and missing/failing/malformed D1 fence
  state return `503 abuse_control_unavailable` before PBKDF2/session mutation;
  the IP's 13th request is the separate `429 rate_limited` perimeter outcome.
  Across 13 parallel distinct-IP requests for one real account, D1 admits at
  most 12 reservations, stores only `user_id` plus canonical timestamps/count/
  limit, and does not slide `expires_at`. Unknown/deleted accounts create no
  fence row. An expired row resets atomically without waiting for cron.
- Login commit: a valid credential inserts one generation/revision/auth-state-
  fenced session and clears its fence in the same D1 batch, with the delete
  gated by that exact session. Inject batch failures and race password rotation;
  require no usable stale session and no unrelated fence clear. Successful
  password rotation clears the fence only with its exact replacement session.
  No email, IP, password-derived value, fence/account ID or password shape may
  enter logs, analytics, errors or release artifacts.
- `POST /api/auth/logout`: trusted-origin live session requires matching CSRF,
  deletes only the current D1 session, clears both cookies and returns empty `204`;
  replay and stale/expired session are idempotent `204`. Replaying the original
  session cookie makes `/api/auth/me` return `401`, while a second session remains
  valid. Cross-origin, missing/mismatched CSRF, SELECT/DELETE failure and unavailable
  D1 preserve the session and emit no false cookie-clearing success. If the POST
  response is lost after deletion, client reconciliation may complete logout only
  after `/api/auth/me` proves `401`; `200` or an unavailable check keeps the private
  UI open with an accessible retry.
- `POST /api/projects`: valid project, normalized estimate, length-limited name
  and invalid dimensions. Require exact root/nested allowlists and typed
  categorical bounds; reject hidden `soilReport`/metadata claims, fail closed
  on KV read **or** write failure, enforce isolated 20/hour account limits and
  the SQL-time 50-project ceiling. Test an absent/malformed key, first `201`,
  same-key/same-normalized-request `200`, same-key/different-request `409`, lost
  success, unique-index races, and the 49→50 trigger race. Every keyed replay
  must return one canonical project and increment estimator attribution at most
  once. Seed exactly 50 active/archived projects, require create 51 to fail
  without a partial row, and always retain the geotechnical-verification risk.
- Unknown `/api/*`: JSON 404. Unknown browser route: SPA fallback.
- Project Decision Home: `GET /api/projects/:projectId/home` is authenticated,
  owner-scoped, `no-store`, bounded to the documented `{ project, lifecycle,
  current, counts }` projection, and read-only. Exercise all active stages,
  archived override, current/stale report and comparison, valid/invalid
  selection, optional Family aggregate, exact-comparison paid entitlement,
  refund/revocation, historical counts, missing/foreign/malformed IDs, non-GET
  `405`, unknown nested routes, recursive forbidden keys, and templated logs.
  Snapshot every source table around repeated GETs and require byte-equivalent
  rows with no progress, analytics, timestamp, counter, or status mutation.
- Brief Check assessment: fixed input fixtures cover `insufficient_information`,
  `programme_tension`, and `directionally_plausible`; customer copy maps only to
  “Needs key facts”, “Programme under tension”, and “Enough to explore”. Golden
  estimate/change deltas reconcile independently, width/length swaps preserve
  area and cost, and adding a missing fact cannot invent an unrelated tension.
  No score, approval, compliance, construction-readiness, or unconditional
  feasibility claim may appear in API data, report bytes, UI, print, or logs.
- Brief Check preview: authenticated owner, trusted origin, CSRF, active project,
  exact `{ expectedInputRevision, input }` body and the 15-field allowlist are
  required. Snapshot every D1 application table and provider stub around the
  request; a successful preview performs zero writes and zero Gemini calls.
  Foreign/missing projects are ownership-safe `404`; archived, stale, malformed,
  oversized, unknown-field and abuse-control cases return the documented bounded
  error without leaking stored inputs or internal hashes.
- Brief revision commit: require exact input, `acceptedImpact: true`, a bounded
  `Idempotency-Key`, and source-revision CAS. First commit is `201`; byte-equivalent
  replay is `200` with the canonical result; same key/different request is
  `idempotency_conflict`; a no-op is `no_revision_changes`. Race two distinct keys
  from one base and require exactly one winner, one new source revision, one
  request mapping, no partial effects and a bounded loser—not a `500`.
- Brief revision history: list newest-first with default/1/50 limits and exclusive
  positive `beforeRevision`; validate the exact summary/detail/report shapes,
  ownership, `404`s, and `History begins at revision N`. A migrated
  `input_revision > 1` creates one `migration_baseline`, never fabricated earlier
  rows; unsupported legacy input remains stored but is absent from list summaries.
  Snapshot, idempotency map, and historical report rows reject direct update or
  child delete while whole-project deletion cascades them atomically.
- Report/revision binding: current `GET /report` is read-only and returns
  `report_not_found` until explicit `POST`; generation binds immutable schema-v2
  bytes to the exact current revision. A source edit preserves the earlier
  historical report while invalidating only the current cache. Race two report
  POSTs and require one immutable v2 snapshot, a safe `201` plus cached `200`
  (or documented bounded conflict), no `500`, and no cache corruption. Migrated
  v1 bytes remain available only through explicit revision history and never
  satisfy the truthful current-v2 read.
- Report feedback: exact owner/revision/schema GET starts null; PUT requires
  origin, CSRF, KV, active status and exactly one approved outcome plus one to
  three unique approved sections. Test idempotent replay, updates, historical
  binding, byte-identical report content, archived read/blocked write,
  cross-owner `404`, deletion cascade, SQL trigger bypasses, aggregate-only
  metrics (eligible denominator, response rate and outcome × section matrix)
  and templated operational routes. Reject scalar type confusion such as an
  outcome array or nested/boolean section. Seed a recent response on an old
  report and require exclusion from the report-generated cohort; concurrent
  writes must return each atomic statement's own row and must not make totals or
  breakdowns diverge. Exact categorical breakdowns remain withheld until fixed,
  non-overlapping snapshots prevent differencing across two individually safe
  windows. Schema v1 must be rejected by GET, PUT and D1, remain absent from the
  UI, and print no feedback component.
- Professional Handoff: owner list/create/revoke require session and ownership;
  writes additionally require trusted origin/CSRF, KV, exact body and bounded
  idempotency key. Test 1/7/30-day expiry, every one-to-six section combination,
  duplicate/unknown/empty/typed-confusion sections, exact replay without secret,
  conflicting reuse, five-active-link SQL cap, active-first discovery beyond 50
  historical records, current and historical schema-v2
  binding, schema-v1 rejection, archive fence, revoke/idempotent revoke, expiry,
  cross-owner `404`, malformed/missing public `404`, closed-link `410`, project
  cascade, and create/delete/revoke races. Parallel same-IP public reads must be
  capped by the strongly consistent D1 admission counter before bearer lookup,
  with only an hourly keyed pseudonym stored. Cross-origin `text/plain`, invalid
  JSON/token shapes and streamed bodies over 512 bytes must consume no admission;
  a malformed/missing HMAC key must fail closed. Repeated create/revoke churn and
  parallel distinct idempotency keys must admit at most 20 creations per account
  per 24-hour window. Public reads must omit session cookies
  and expose exactly expiry and the selected redacted
  sections—never account/project/share IDs, inputs, feedback, AI, files, orders,
  hashes or unselected fields. Logs/referrers/analytics/artifacts must contain no
  bearer token or raw URL. Disabling the D1 handoff control must block create and
  redemption while list/revoke remain available; re-enable must restore capability.
- Revision side effects: saving a revision permanently closes active Family
  rooms, while old comparisons, choices, orders and purchased snapshots remain
  byte-for-byte unchanged and are not presented as current. Paid, upload,
  checkout and fulfillment controls remain closed throughout the suite.
- Populated upgrade: apply migrations through `0011` to a fixture containing a
  real owner, non-first input revision and saved schema-v1 report, then apply
  `0012`, `0013`, `0014`, `0015`, `0016`, and `0017`. Require exact preservation of the v1 bytes and honest
  baseline, zero fabricated revisions/feedback, canonical removal of unsupported
  keys only on the next real source revision, null creation metadata on existing
  projects, the unique per-user creation-key index, an initially empty
  `login_attempt_fences` table with its exact six columns/expiry index, and
  enforcement of the 50→51 project ceiling. Canonical user/session hashes and
  every protected row count remain unchanged.
- Rollback compatibility: run the reviewed current authenticated harness in
  legacy-Worker mode against the previous Worker after migration, not a harness
  copied from the previous commit. Triggers must capture an honest revision with
  nullable derived facts, close stale Family/report cache state, and let the new
  Worker recompute/read current schema-v2 history without mutating the preserved
  v1 artifact. Automatic rollback is eligible only after this rehearsal and its
  exact canary-ID query prove zero `projects`, `project_revisions`, `reports`,
  `project_revision_reports`, and `report_feedback` residue, including after a
  failed rehearsal. After `0017`, explicitly record that the old Worker ignores
  the additive login-fence table and therefore loses distributed per-account
  admission and exact login/rotation clearing: compatibility may permit an
  emergency rollback, but its security downgrade requires a quiet bounded
  incident window, closed commerce/uploads and prompt roll-forward.
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
- Browser-event telemetry: only the two `project_home_*` and seven
  `decision_compare_*` event names plus documented `surface`/`outcome` values
  are accepted; storage is daily
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
  ID/expiry/count/max-five and exactly two redacted A/B scenarios. Assert one
  admitted read increments the access counter exactly once and records its
  access time. The full serialized response contains no recommendation,
  owner selection, project/account identity, raw input, locality/dimensions,
  notes/questions, internal comparison/scenario IDs, files, orders, payment or
  entitlement fields. Malformed/missing is generic; revoked/expired/archived is
  `410`. Inject a final D1 admission failure and prove it returns `503` with no
  projection, access increment, private database error, or successful-open
  event. Impossible calendar dates and non-canonical stored expiry formats must
  also fail closed without disclosure. Rendered-DOM privacy remains a manual
  acceptance check below. The client maps admission/dependency failure to an
  announced temporary-private state and retries the same bearer link without
  requesting an impossible replacement link.
- Family Alignment receipts: validate the exact role/preference/confidence and
  one-to-three reason allowlists; reject unknown fields, duplicate reasons,
  HTML/URL/free text, body tokens and oversized/malformed bodies. Create five
  distinct room-scoped token receipts, reject a sixth atomically, then prove an
  existing receipt can update without changing the count. Replay/concurrency
  creates no duplicate; missing/wrong/cross-room token cannot read, update, or
  take over a response.
- Family Alignment closure races: interleave public read and receipt
  create/update with revoke, project archive, and database-time expiry. The
  final read admission and write fence must be authoritative: no comparison
  may be disclosed and no response may commit after closure wins due to a stale
  application pre-read. If read admission wins it increments once and may
  complete, but every later read is closed. Revoke is idempotent, permanently
  closes public read and write, and does not mutate the comparison, owner
  selection, or any paid order/fulfillment state.
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
  successful core action. Inject aggregate analytics-write failures and prove
  room/response/revoke results remain truthful with no client duplicate. Inject
  an authoritative public-read counter failure separately and require `503`
  with no projection or successful-open event.

## Non-functional checks

- No horizontal overflow at 390, 768, 1024 and 1440 px.
- Visible focus and semantic labels for sliders, selects, form fields, nav and disclosure widgets.
- No console errors on core routes.
- Reduced-motion preference disables transition/scroll animation.
- Generated hero remains sharp and cropped intentionally at desktop/mobile.
- API responses never echo raw secrets or entire personal-data payloads.
- Report print output excludes the complete feedback component, including its
  explanatory boundary and status text. Historical schema-v1 print/UI output is
  composed only from persisted v1 fields and never inherits recomputed Brief
  Check, current inputs, fallback costs, risks, or actions.
- Family review controls use semantic fieldsets/legends or equivalent native
  groups, minimum 48 px targets, associated error text and announced
  recorded/updated/full/expired/revoked states. Keyboard-only and screen-reader
  flows, 200% zoom/text spacing, 390 px reflow, and absolute expiry copy pass;
  print/share metadata contains no secret or project identity.
- Project Decision Home is one ordered semantic progress list with visible text
  for current, optional, stale, complete, and archived states. Its one primary
  next action has a stable accessible name and fixed same-origin target; the
  complete page works at 390 px, 200% zoom, increased text spacing, reduced
  motion, slow network, keyboard-only, and browser back/forward navigation.
- At 2× forecast pilot concurrency, p95 public health/estimate stays below 500
  ms and authenticated/compare requests below 750 ms; no duplicate orders,
  issues, selections, Family Alignment rooms/receipts, cap overruns, or D1
  write errors.

## Public estimator manual acceptance matrix

| Area | Test | Required result |
|---|---|---|
| Happy path | Change each of width, length, city, floors, and finish independently, then use the confirmed details to create a project | Every change reaches the Worker; displayed and created-project plot area, built-up area, low/high INR, normalized tuple, and rule basis reconcile exactly |
| Bounds and types | Enter 10, 500, 9.99, 500.01, blank/intermediate values, normal typed/pasted numbers, exponent notation, `NaN`/infinity through the pure boundary, and type-confused API JSON | Values that normalize to primitive finite numbers inside inclusive bounds pass; every unsupported value has associated text, makes no valid API request, and never produces or transfers a confirmed range |
| Enums and allowlist | Exercise every supported city/floor/finish; send typos, case variants, arrays/objects, and address/account/project/price fields | Supported choices return their exact normalized tuple; every unsupported/unknown field is bounded `400 invalid_estimate_request` with no echo or coercion |
| Race | Delay request A, change controls to B, let B resolve, then deliver A; repeat with abort during rapid edits | Only B can become confirmed; A is ignored and cannot overwrite the range, basis, stored tuple, or status. Valid B remains eligible for handoff independently of A |
| Loading | Throttle the estimate request on initial load and after a valid edit, then continue before it resolves | The pending state is announced without focus theft; no stale range is labelled current; the five-field valid tuple is carried forward and successful project creation recalculates it on the Worker |
| Unavailable | Inject timeout, offline, network reset, 5xx, non-JSON success, missing disclaimer, inverted/negative/non-finite output, stale input, and malformed/extra/missing basis fields, then continue with the valid tuple | Inputs remain editable and recoverable; the state is announced; no browser-price fallback, partial render, false confirmation, or estimate transfer occurs; project handoff remains available and creation recalculates the tuple on the Worker |
| Basis and boundary | Open the methodology disclosure for Essential/Signature/Premium/Luxury and representative cities | Rule version/publication date, internal-benchmark status, absent current-market calibration date, market-change warning, directional confidence, methods, selected factors/rate, band, INR, tax/fee treatment, exclusions, and professional boundary are accurate and keyboard-readable |
| Storage and navigation privacy | Seed session storage with valid fields plus address, account/project IDs, nested tokens, malformed JSON, incomplete tuples, and wrong scalar types; then make storage reads/writes throw through estimator → start → register. Explicitly abandon to Home, then perform an unrelated login | Estimator recovery restores only five tuple fields. Auth continuation carries only the documented full-draft allowlist, source marker, and opaque retry key in same-tab state/session storage; every arbitrary extra is discarded, no URL/estimate/identity/credential is added, blocked storage still works, and abandonment prevents later silent creation |
| Anonymous transport | Use the estimator while logged out and while a valid account session/CSRF cookie exists; inspect request headers and Worker logs | Both requests use `credentials: omit`, send no cookie/CSRF, and log only the templated route/bounded outcome without tuple or private values |
| Server-tied leading KPI | Create projects after confirmed, loading, unavailable, storage-backed, and navigation-fallback estimator handoffs; replay a lost `201` with the same key; race duplicate/conflicting bodies; repeat with invalid/unauthorized/rejected/direct-start requests, a direct generic event submission, and injected aggregate-write failure | The first-party client sends exact attribution plus matching `Idempotency-Key` only for its continuation. One insert and one aggregate result; exact retries return canonical `200`, conflicts return `409`, and all rejected/direct cases record none. Generic submission is `400 invalid_event`; aggregate failure preserves the project and `201`. The aggregate row contains no tuple, identity, resource ID, or client timestamp |
| Accessibility | Complete per-field invalid → loading → confirmed → unavailable → retry → recovered flows using keyboard and VoiceOver/NVDA at 390 px, 200% zoom/text spacing, high contrast, and reduced motion; change the tuple during one retry | Width/length errors are individually associated and other errors are announced; labels/status/disclosure are programmatic; retry focus stays stable on pending/failure, moves to status only after success for the unchanged tuple, and is cancelled for a changed tuple; text—not colour—communicates state, targets reflow, and no horizontal overflow occurs |
| Guardrail | Compare public and create-project responses across representative city/floor/finish fixtures and both dimension boundaries | Exact mismatch count is zero for normalized tuple, rule version, plot/built-up area, and low/high INR; any mismatch blocks promotion |

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
| Closure | Keep reviewer form open while owner revokes; repeat across expiry | Submit cannot commit; stable accessible closed state; no stale private content remains |
| Owner summary | Exercise zero, split, leaning, aligned and not-ready fixtures | Counts/reasons reconcile; copy is advisory; no individual or ordering can be inferred; owner selection is separate |
| Ownership | Request create/summary/revoke from another account | Same safe `404` as missing; no existence, count, comparison, or identity leak |
| Accessibility | Keyboard, VoiceOver/NVDA, 200% zoom, increased spacing, reduced motion, high contrast, 390 px | Logical headings/groups/order, visible focus, 48 px targets, announced status/errors, no color-only meaning or overflow |
| Privacy/logs | Use canary tokens/values while capturing browser requests, Worker logs and D1 rows | Raw tokens/content absent from logs/analytics; only token digests and approved structured data retained |
| Failure injection | Fail ancillary analytics after each core action, then fail authoritative public-read admission | Core writes remain correct with no false `5xx` or duplicates; failed read admission returns `503` with no comparison disclosure or double-count |
| Retention | Seed active, recently revoked/expired and retention-eligible rows; invoke scheduled handler | Only eligible Family Alignment rows are removed; comparison/selection/project/payment evidence is unchanged |
| Paid isolation | Run the entire flow with paid switches closed and inspect commerce tables | No order, provider ID, entitlement, artifact or paid flag is created or changed |

## Project Decision Home manual acceptance matrix

| Area | Test | Required result |
|---|---|---|
| Resume path | Open a new, feasible, compared, selected, Family-active, stale and archived project | Exactly one truthful stage and next action; Family remains optional; archived state offers no planning/content mutation, while separately governed privacy deletion remains visually isolated |
| Archive fence | After archiving, attempt project edits, comparison save/choice, upload, checkout, new Decision share, new Family room, and public Family response | Every planning/content write fails closed with no D1/R2 mutation; archiving closes bearer rooms; explicit privacy deletion and revocation retain their documented scope |
| File deletion containment | Seed private-file metadata and request whole-project deletion without an R2 binding | `409 project_has_files` is returned before any R2 or D1 mutation; after explicit file deletion, the normal file-free project delete remains atomic |
| Currentness | Create old reports/comparisons/selections/rooms and a paid artifact, then change the project | Historical counts remain, but only exact current source facts receive current/purchased badges |
| Read purity | Compare D1 rows before and after repeated authenticated Home reads | No source, timestamp, count, progress, analytics, lifecycle or payment row changes |
| Ownership | Request a real project as another account and a missing project as its owner | Both return the same ownership-safe `404`; anonymous access is `401` |
| Privacy | Inspect response, DOM, network, logs and error output with synthetic canaries | No bearer/receipt/hash, individual Family row, raw stored JSON, provider identifier, checkout URL or arbitrary navigation URL appears |
| Routing | Exercise malformed/encoded IDs, non-GET methods, unknown nested routes and browser history | No scanner-induced `500` or SPA fallback for API routes; logs use `/api/projects/:projectId/home`; back/forward state is coherent |
| Accessibility | Run keyboard, screen reader, 200% zoom, text spacing, reduced motion and 390 px | Ordered stage semantics, visible non-colour status, one named primary action, no overlap/overflow, and stable focus |
| Paid containment | Capture and refund the exact selected comparison with checkout closed | Home exposes only active exact-comparison entitlement, removes it after refund/revocation, and never changes financial evidence |

## Brief Check and Change Study manual acceptance matrix

| Area | Test | Required result |
|---|---|---|
| Truthful assessment | Exercise missing, tense and complete fixtures, then inspect page, API and print | Only the three approved labels and professional-boundary copy appear; no score or feasibility/approval guarantee |
| Preview purity | Preview several edits while capturing D1 and provider traffic | Exact deltas and consequences render; every table is byte-equivalent and Gemini is never called |
| Save and replay | Accept impact, double-submit, retry after a network timeout, then reuse the key for different input | One canonical revision; replay returns it; conflicting reuse is rejected without mutation |
| Two-tab conflict | Preview the same base in two tabs and save both | Exactly one save wins; the loser is told to reload and no side effect from it persists |
| History | Paginate, open detail/report, and use a migrated revision-four fixture | Newest-first bounded pages; immutable prior facts; visible “History begins at revision 4”; no fabricated revisions or restore control |
| Report binding | Generate v2 twice concurrently, edit, then read current and prior report routes | One immutable v2 snapshot per revision; current GET never auto-generates or serves v1/stale bytes; prior explicit history remains readable |
| Side effects | Save with an active Family room, old comparison/choice and purchased snapshot | Family link closes; old decision/payment evidence is unchanged and clearly historical, never current |
| Archive and ownership | Read archived history, attempt every write, and repeat as another account | Archived owner can read history only; all writes fail closed; foreign/missing resources share safe `404` behavior |
| Accessibility | Keyboard, screen reader, 200% zoom, text spacing, reduced motion, high contrast and 390 px | Logical edit/review/history order, announced errors/status, non-colour change cues, stable focus and no overflow |
| Operations | Inspect readiness, populated `0011`→`0014` migration, backup and current-harness old-Worker rehearsal | `revisionSchema=current`, `projectCreationSchema=current`, `briefCheck=true`; existing project/report values remain unchanged; no ID/input/key in logs; rollback is gated on compatibility and exact-ID cleanup |

## Report feedback manual acceptance matrix

| Area | Test | Required result |
|---|---|---|
| Exact binding | Save on current revision, create a new revision/report, then reopen both | Each report has its own response; neither response follows the mutable project pointer |
| Immutability | Capture report JSON/checksum before save, update and replay | Report bytes/checksum never change; only feedback timestamps/outcome/sections may change |
| Vocabulary | Try unknown, duplicate, empty and four-section payloads, `overall` with another section, and array/boolean scalar confusion | Every invalid shape is rejected by API and D1; no free text can persist |
| Ownership and lifecycle | Repeat GET/PUT as another owner, archive, restore and delete, including archive/delete races after the initial read | Foreign resources are safe `404`; archived GET remains readable and PUT is `409`; only a confirmed archive returns `project_archived`, deletion races return bounded conflict, and deletion cascades |
| Legacy boundary | Open and print a populated saved schema-v1 report; call feedback GET/PUT and bypass the API in D1 | Only persisted v1 fields render; no modern facts or feedback UI print; API and SQL reject feedback |
| Accessibility | Keyboard, screen reader, 200% zoom, text spacing, reduced motion and 390 px | Native fieldsets announce labels/status/errors, the three-section limit is understandable, and print excludes the complete feedback component |
| Measurement | Query protected adjacent windows after multiple eligible reports, including two windows whose corresponding cells are six and five, plus a recent response on an old report | Old-report response is excluded; one statement reconciles denominator, total and rate; exact categorical arrays stay empty for both individually above-threshold windows until fixed non-overlapping snapshots exist, without returning identity or resource keys |
| Operations | Inspect strict preflight, mode-0600 evidence cleanup, readiness, failed/successful canary cleanup and old-Worker rehearsal | `reportFeedbackSchema=current`, capability true, exact canary IDs have zero residue, templated logs, and rollback is compatibility-gated |

## Authentication and Account Security manual acceptance matrix

| Area | Test | Required result |
|---|---|---|
| Registration boundary | Submit exact two/three-field bodies, then missing/extra/confused-type/value-boundary variants and duplicate normalized email | Only primitive email/password plus optional primitive name are accepted; structural/value codes stay distinct; duplicate email remains the documented enumeration risk |
| Login indistinguishability | Exercise short/long password, unknown, deleted, malformed-record, wrong-password and account-fenced fixtures while instrumenting PBKDF2 | Each makes exactly one real-or-dummy derivation and returns the identical generic `401 invalid_credentials` envelope; logs expose no differentiating value |
| Distributed account fence | Send 13 concurrent requests for one user from distinct IP fixtures, inspect the row, wait/advance past expiry, and repeat | At most 12 are admitted; request 13 is generic 401 with dummy work; one `user_id`-only canonical row exists; expiry never slides and resets atomically |
| Abuse-control failure | Remove/fail KV; remove/fail/corrupt the D1 fence query/state; exhaust only the IP window | Missing/unhealthy authority is `503` before PBKDF2/session mutation; IP exhaustion is `429`; no fail-open or account-state leak occurs |
| Exact login commit | Seed a fence, log in correctly, then inject session-batch failure and race password rotation | Only an exact committed session clears its fence; a failure/stale race leaves no usable session and cannot clear another fence; exact rotation clears atomically |
| Password rotation | Change from a valid current password to a different valid password, then try both credentials | The old password fails, the new password logs in, and the current response carries one working replacement session/CSRF pair |
| Session revocation | Create two sessions before the change, retain both bearer cookies, then rotate through one | Both retained cookies return `401`; only the returned replacement session works |
| Strict boundary | Try wrong current password, same password, 9/129-character values, non-string values, missing/extra fields, malformed JSON and oversized bodies | Each returns the documented bounded error with zero user/session mutation and no password material in response/logs |
| Browser defences | Repeat without origin, from a foreign origin, without matching CSRF and with missing/failing KV or D1 admission | Origin/CSRF/abuse checks fail closed before PBKDF2 or credential mutation |
| Concurrency | Race 20 password guesses through deliberately non-atomic KV, race two different changes, and pause a login after old-password verification while a change wins | Exactly five guesses reach verification and 15 are D1-limited; one change commits; the loser cannot delete the winner's session; the stale login inserts no usable session |
| Atomicity | Inject failure at credential update, old-session delete and replacement-session insert | The D1 batch rolls back completely: either old credentials/sessions work or only the new credentials/replacement works |
| Migration, cleanup and rollback | Upgrade populated 0014 data through 0017, inspect defaults/guards/fence inventory, run cron and the prior Worker, then restore the new Worker | Existing credentials/sessions survive; the first fence table is empty, expiry cleanup is exact and retention-only, protected hashes/counts do not change; old Worker is schema-compatible but explicitly loses the account fence, and roll-forward restores it |
| Accessibility | Exercise keyboard, screen reader, 390 px, 200% zoom/text spacing, high contrast, reduced motion and print | Persistent labels/autocomplete, visible focus, announced validation/result states, no overlap/overflow, and no credential form in print |
| Privacy | Search URL, history, storage, analytics, API response, custom logs and D1 outside credential/session columns | No current/new password, bearer/CSRF token, password hash/salt, generation or session ID is exposed; route logging remains templated |
| Paid containment | Inspect catalog/readiness and order/upload paths before and after change | Checkout, fulfillment and uploads remain closed; project/report/order/payment bytes are unchanged |

## Professional Handoff manual acceptance matrix

| Area | Test | Required result |
|---|---|---|
| Exact source | Share current and historical schema-v2 reports, then change the project | Each link remains pinned to its original immutable revision/content hash; v1 and nonexistent reports are rejected |
| Redaction | Select every allowed subset and inspect API, page, print, network and browser storage | Only selected public sections appear; no account/project/share identity, input, feedback, AI, file, order, hash or unselected section leaks |
| Secret lifecycle | Create, replay, copy, refresh, print, revoke and revisit after closure | Fragment URL appears only on first `201`, never on replay/list; no HTTP/referrer/NEL/print URL contains the token; revoked/expired POSTs are `410`; malformed/missing values are indistinguishable `404` |
| Ownership and abuse | Repeat as another owner, from foreign/missing origin/CSRF, with wrong MIME/oversize body, missing/failing KV/HMAC, 121 concurrent same-IP reads, 21 create/revoke cycles, six active links, and more than 50 closed history rows | Invalid public requests consume no admission; owner routes are isolation-safe; D1 admits exactly 120 reads and 20 creates; SQL prevents a sixth active link; every active link remains listed and revocable |
| Kill switch | Disable, list/revoke, attempt create/read, re-enable and read readiness throughout | Create/read fail closed while disabled; list/revoke remain safe; capability flips false/true without a deploy |
| Retention | Seed active, recent closed and over-90-day expired/revoked rows plus old read/create counters, then run scheduled maintenance and inspect the query plan | Only retention-eligible rows are removed; cleanup uses expiry and partial revoked indexes; active/recent links and source projects/reports remain unchanged |
| Accessibility | Keyboard, screen reader, 390 px, 200% zoom/text spacing, high contrast, reduced motion and print | Section/expiry controls, one-time secret warning, status/errors and revoke action are named, announced, focused and overflow-free |
| Operations | Inspect `0016`, readiness, HMAC key state, default-disabled propagation, bounded trap-protected activation, current/legacy canaries, final restoration, counts, raw logs and D1 residue | Four tables, five indexes, five triggers and one disabled control exist; the exact Worker propagates with `reportHandoff=false`; the canary EXIT trap re-closes on success/failure; residue and public `503` pass while closed; only final restoration produces `reportHandoff=true`; token-free templated logs and compatibility-gated rollback remain intact |

## Required release evidence

Attach to the release record, without secrets or customer data:

- commit SHA, Cloudflare version ID, applied migration list and operator;
- both exact-version 20-sample readiness latency artifacts with 20/20 contract
  success and nearest-rank p95 strictly below 500 ms; for a no-migration
  release, the pre-deploy lists must also prove zero unexpected remote pending
  migrations;
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
- Project Decision Home lifecycle fixtures, pre/post read-only D1 snapshots,
  forbidden-key/log canaries, stale/exact-purchase evidence, and
  keyboard/history/reflow results;
- Brief Check golden/metamorphic fixtures, zero-write preview snapshot, stale
  save and report-generation race evidence, immutable-history/legacy-baseline
  reconciliation, rollback-trigger rehearsal, log canary, and
  keyboard/screen-reader/reflow results;
- Report feedback outcome/section fixtures, exact-version immutability hashes,
  schema-v1 API/UI/D1 rejection, archived/ownership/CSRF/KV-failure/rate-limit
  evidence, the exact 60→61 feedback limit and 50→51 project cap, concurrent
  atomic-write and archive/delete-race evidence, D1 guard bypasses, aggregate redaction,
  populated `0011`→`0015` upgrade, project-create replay/race proof,
  public-to-created estimate equality, failed/successful exact-ID canary cleanup,
  print exclusion and keyboard/screen-reader/reflow results;
- Professional Handoff exact-report/section fixtures, one-time-secret replay,
  owner/CSRF/origin/KV/cap/race evidence, public redaction diff, revoke/expiry
  `410`, token/referrer/log canaries, 90-day scheduled-retention proof,
  `0016` four-table/five-index/five-trigger/default-disabled inventory,
  closed exact-version propagation, trap-protected current canary and legacy
  canary evidence, closed-state `503`, exact-ID `report_shares` cleanup, final
  verified activation, and keyboard/screen-reader/reflow/print results;
- account-security strict-schema/origin/CSRF/KV fixtures, old-password and
  pre-change-bearer rejection, concurrent-change and stale-login race evidence,
  D1 rollback injection, populated migration/old-Worker compatibility, bounded
  route logs, and keyboard/screen-reader/reflow/print results;
- strict registration/login schema matrices; PBKDF2 call-count proof for
  unknown/wrong/deleted/malformed/short/long/fenced states; 12→13 distributed
  account admission and fixed-expiry proof; KV/D1 fail-closed injection; exact
  session/rotation fence clears; `0017` empty-first-apply inventory, expiry cron,
  additive rollback security-downgrade record, aggregate-only monitoring and
  registration-enumeration/targeted-lockout residual-risk sign-off;
- encrypted D1 backup checksum, isolated restore counts and measured RTO; and
- go/no-go sign-off from founder/product, engineering on-call, payment owner,
  and quality/professional owner.

An unavailable third party, untested manual procedure, or unchecked box is a
failed gate—not an assumed pass.
