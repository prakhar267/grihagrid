# Server-authoritative public estimator

## Product decision

The landing-page estimator is the first quantitative promise GrihaGrid makes.
It must therefore use the same Worker-owned rules as project creation, make its
published calculation basis and calibration limit visible, and never present a
browser-only calculation or an unverified market rate as confirmed.

The release addresses three concrete problems in the earlier prototype:

- finish level was fixed to Signature even though finish is a major cost driver;
- browser constants could drift from the values saved with a project; and
- values outside the supported 10–500 ft range could still produce a plausible-
  looking browser result.

The estimator remains an indicative concept-stage planning aid. It is not a
quotation, feasibility approval, cost guarantee, tax calculation, or substitute
for measured site information and licensed local professionals.

DISC-07 adds a share action for the same five-field scenario. The resulting
link is deliberately a recipe for a new calculation, not a saved estimate or
quote. It creates no anonymous server record, capability token, browser
identity, or new pricing authority.

## Customer journey

1. The visitor starts with a 30 × 50 ft, Bengaluru, G+1, Signature scenario.
2. Width, length, city, floors, and finish are explicit controls. The browser
   validates the complete five-field tuple before sending anything.
3. A valid change requests `POST /api/estimate` without cookies or CSRF material.
4. The Worker normalizes the tuple, calculates the range, and returns the exact
   input, numeric output, and dated rule basis in one envelope.
5. The browser accepts the response only if its input tuple still matches the
   latest request and every output/basis invariant passes. A late response for an
   earlier scenario is discarded.
6. When a range is confirmed, the visitor can inspect how it was derived and
   what is excluded. Any browser-valid tuple can continue into the four-step
   private-project journey while the range is loading or unavailable too; only
   an invalid tuple blocks handoff. The estimator-to-start transition carries
   only the five safe scenario fields, a fixed source marker, and an opaque
   project-creation retry key.
7. Any valid tuple can also become a canonical `/estimate?...` link. A recipient
   sees the five inputs and a fresh credential-free Worker calculation. The URL
   carries no displayed range, basis, name, address, account, project, token, or
   arbitrary metadata. Editing and re-sharing creates a new canonical tuple.
8. Once the visitor first saves or edits the full private brief, its strict
   allowlist moves into one versioned local browser envelope and the estimator
   tuple is consumed from navigation/session state. The existing v1 envelope
   remains byte-shape compatible with the rollback target: shared attribution is
   held in a separate exact-key/expiry-bound source-only record that contains no
   tuple or browser identity. Authentication navigation then carries only a
   continuation marker, project retry key, expected write UUID/revision, and
   bounded source marker—never the brief payload or a URL value. A true
   memory-only fallback is same-tab only; any branch descended from shared
   storage must be revalidated before it can continue. Stored tuples are accepted
   only for their matching retry key. Choosing an older saved brief first
   consumes any different pending estimator handoff and never rebinds its tuple
   or source to the recovered key. Explicit Home/Exit abandons the handoff, and
   a later unrelated start or login cannot resurrect the scenario or draft.
9. The first-party client adds either the fixed `public_estimator` or
   `shared_estimate` entry point only to the matching attributed project-create
   request and sends the retry key as
   `Idempotency-Key`. Project creation validates the full brief, recalculates the
   estimate, and inserts the project before the Worker attempts the aggregate
   measurement. Within the same account, a lost success can replay the same
   project without a duplicate row or aggregate. The browser result is never
   accepted as a stored estimate.

## Shareable scenario contract

The canonical version-one link is:

```text
/estimate?v=1&width=30&length=50&city=Pune&floors=G%2B1&quality=Signature
```

The parser requires one and only one instance of each of `v`, `width`,
`length`, `city`, `floors`, and `quality`, and rejects every missing, duplicate,
unknown, malformed, unsupported, or out-of-range value. Version must be `1`.
Dimensions use canonical finite decimal strings and the same inclusive 10–500
ft bounds as the estimator. There is no partial merge and no defaulting on this
route: one invalid field makes the complete shared scenario unavailable and no
estimate request is sent. A valid alternate parameter order is replaced in
browser history with the canonical ordering and empty navigation state. An
invalid query or fragment is replaced with value-free `/estimate` after the
fail-closed state is selected, so rejected private or malformed values do not
remain on that history entry.

The document performs no account bootstrap request. Its calculation uses the
existing credential-free `POST /api/estimate`, whose response is still treated
as untrusted and arithmetically reconciled by the browser. Copy explains that
the result is recalculated against the current published rule and can therefore
change; it never calls the link a frozen price or quote. Native Web Share is
used when available, with copy-to-clipboard fallback, explicit success, a
bounded accessible failure, and no scenario mutation on cancellation/failure.

`GET` and `HEAD` return the normal SPA document with `Cache-Control: no-store`,
`X-Robots-Tag: noindex,nofollow,noarchive`, `Referrer-Policy: no-referrer`, and
the static production-root canonical link. `robots.txt` also disallows
`/estimate`. These controls reduce search/referrer exposure but cannot guarantee
de-indexing when a crawler honors `robots.txt` without fetching the response's
`noindex` directive. They are not an access-control claim because the tuple is
intentionally public.

## Public API contract

`POST /api/estimate` is public and stateless. It requires
`Content-Type: application/json` and accepts only these five root fields:

```json
{
  "width": 30,
  "length": 50,
  "floors": "G+1",
  "quality": "Signature",
  "city": "Pune"
}
```

| Field | Contract | API default when omitted or `null` |
|---|---|---|
| `width` | Primitive finite JSON number, 10–500 inclusive, feet | None; required |
| `length` | Primitive finite JSON number, 10–500 inclusive, feet | None; required |
| `floors` | `G`, `G+1`, or `G+2` | `G+1` |
| `quality` | `Essential`, `Signature`, `Premium`, or `Luxury` | `Signature` |
| `city` | `Pune`, `Bengaluru`, `Mumbai`, `Delhi`, `Hyderabad`, `Chennai`, `Jaipur`, or `Other` | `Other` |

Strings such as `"30"`, booleans, arrays, objects, enum spelling/case variants,
unknown fields, and dimensions outside the inclusive bounds return
`400 invalid_estimate_request` (or `400 invalid_dimensions` for a dimension that
passes the request-shape check but is outside the calculation bounds). There is
no coercion of public numeric input. The browser always sends all five fields;
the API defaults exist for explicit backward-compatible calls and are returned
in normalized `input`.

A confirmed Pune response has this exact public shape:

```json
{
  "input": {
    "width": 30,
    "length": 50,
    "floors": "G+1",
    "quality": "Signature",
    "city": "Pune"
  },
  "estimate": {
    "plotSqft": 1500,
    "builtUpSqft": 1830,
    "lowInr": 3703920,
    "highInr": 4428600,
    "floors": "G+1",
    "quality": "Signature",
    "city": "Pune",
    "disclaimer": "Indicative concept-stage estimate; not a contractor quote."
  },
  "basis": {
    "ruleVersion": 1,
    "rulePublishedDate": "2026-08-16",
    "benchmarkStatus": "internal_directional_rule",
    "marketBenchmarkAsOf": null,
    "marketWarning": "Internal planning assumptions are not independently calibrated to current local quotes. Rates vary with specification, contractor, availability, and market conditions; verify current local quotations before decisions.",
    "currency": "INR",
    "confidence": "directional",
    "areaMethod": "Plot area × floor-programme factor",
    "costMethod": "Likely built-up area × internal finish benchmark × city factor",
    "floorFactor": 1.22,
    "finishRateInrPerSqft": 2200,
    "cityFactor": 1,
    "lowFactor": 0.92,
    "highFactor": 1.1,
    "taxesAndStatutoryFees": "excluded",
    "exclusions": [
      "Land purchase and finance costs",
      "Taxes, statutory fees, utility connections, and municipal charges",
      "Abnormal ground, retaining, foundation, demolition, and external works",
      "Loose furniture, appliances, and owner-specific upgrades"
    ]
  }
}
```

`rulePublishedDate` dates publication of the calculation contract. It is not a
market-data freshness claim. `marketBenchmarkAsOf` is deliberately `null`
because the inherited internal rate assumptions do not yet have independently
verified current-local-quote calibration.

The browser treats the envelope as untrusted. It requires exact root and input
allowlists; an exact match to the latest request tuple; non-negative finite
`plotSqft`, `builtUpSqft`, `lowInr`, and `highInr`; `lowInr <= highInr`; enum
echoes matching `input`; and a bounded non-empty disclaimer. The basis must have
exactly the documented fields, a positive integer rule version, a real
`YYYY-MM-DD` basis date, `INR`, `directional`, non-empty bounded methods,
`internal_directional_rule` benchmark status, a `null` market calibration date,
a bounded market-change warning, positive finite factors/rate,
`lowFactor < highFactor`, explicitly excluded taxes/statutory fees, and one to
eight bounded non-empty exclusions. It then independently reconciles plot area,
rounded built-up area, midpoint, and rounded low/high values from the returned
tuple and basis; any mismatch makes the range unavailable.

## UI state contract

| State | Customer-visible behavior | Safety rule |
|---|---|---|
| Loading / updating | Announce that GrihaGrid is checking the current scenario; preserve the visitor's controls and offer **Continue with these details** without disruptive focus movement | Do not label a prior range as current. A browser-valid tuple may continue because project creation validates and recalculates it on the Worker |
| Invalid | Show the field-specific width/length or choice error next to the control and announce a concise summary | Do not call the API, show an invalid tuple as a current range, or allow handoff |
| Unavailable | Keep the entered scenario, explain that no live range is available, and offer **Continue without a range** | Do not fall back to duplicated browser pricing rules or transfer an estimate. A browser-valid tuple may continue for authoritative project creation |
| Confirmed | Show the range, likely built-up area, selected finish, rule publication date, internal-benchmark/current-market limitation, calculation method, exclusions, market warning, and concept-stage disclaimer; offer **Use calculation-checked details** | Render only the arithmetically reconciled response whose exact request key matches the current controls. Handoff still transfers only the tuple, never the estimate |

An aborted request and a late A response after the controls have moved to B do
not become an error or confirmed result for B. They are ignored. A malformed
`200` envelope is handled as unavailable, never partially rendered. Loading and
unavailable are estimate-display states, not project-creation trust states: a
valid tuple may continue, and the create-project endpoint recalculates it from
the Worker-owned rules. Invalid tuples remain blocked.

## Privacy and security

- The public request contains only width, length, city, floors, and finish. It
  must never contain an address, project/account identifier, name, contact
  detail, upload, browser token, or arbitrary metadata.
- Public estimator fetches use `credentials: "omit"` and attach neither the
  session cookie nor the CSRF token, including when an authenticated customer
  happens to use the landing page.
- Stored estimator recovery parses an allowlist and returns only the five public
  fields. Corrupt, incomplete, or type-confused data is discarded rather than
  merged into a request.
- Handoff stores one allowlisted `public_estimator` or `shared_estimate` source
  marker and an opaque,
  bounded project-creation idempotency key. Neither is an authentication token,
  project identifier, or user identity. The first local draft envelope consumes
  the estimator tuple/source/key from transient handoff state while retaining
  the bounded source and key inside the envelope; successful creation clears the
  remaining attribution state.
- The estimator-to-start transition carries only the validated five-field tuple,
  marker, and retry key. After the visitor first saves or edits the full brief,
  that private structured payload lives only in the strict local envelope. Auth
  navigation carries only the continuation marker, key, expected write
  UUID/revision, and bounded source marker. It never carries a dedicated address,
  contact, or account field, upload, browser estimate, arbitrary nested value,
  session credential, CSRF token, or full brief. User-entered name and style may
  themselves contain identifying content, so they remain confined to the local
  envelope and authenticated project request. Explicit abandonment clears the
  exact draft, key, and attribution marker.
- `x-grihagrid-entry-point` is measurement metadata on the authenticated project
  creation request, not an authorization or calculation-trust signal. It cannot
  change the normalized project, estimate, ownership, or response.
- Worker completion logs use the templated route and bounded outcome; request
  bodies and scenario values are not operational log fields.
- The response carries methodology, not a source register or internal secret.
  It exposes no database, customer, project, provider, or credential state.

## Accessibility and responsive behavior

- Every input has a persistent programmatic label, and validity is communicated
  with text rather than colour alone.
- Width and length each expose their own visible error through `aria-invalid`
  and `aria-describedby`; any non-field scenario error is announced in the
  invalid-state alert.
- Native number semantics are supplemented by JavaScript validation because an
  HTML `min`/`max` attribute alone does not prevent every invalid edit.
- Loading, confirmed, invalid, and unavailable changes are announced through a
  restrained live region. Routine recalculation does not steal focus.
- A retry keeps focus stable while pending or unsuccessful. Only a successful
  retry for the unchanged request moves focus, without scrolling, to the updated
  status; editing the tuple cancels that deferred focus move.
- The finish selector and basis disclosure are keyboard-operable, preserve
  visible focus, and expose their expanded/collapsed state where applicable.
- The complete instrument must reflow without horizontal overflow at 390 px and
  remain usable at 200% zoom, increased text spacing, high contrast, and reduced
  motion. Pending state is never conveyed by animation alone.

## Acceptance criteria

1. Width, length, city, floors, and finish all change the exact server request;
   the displayed result is derived only from an accepted Worker envelope.
2. Bounds, scalar types, enum values, and unknown request fields fail closed on
   both browser and Worker boundaries; inclusive 10 ft and 500 ft fixtures pass.
3. A stale A response cannot overwrite B, a malformed success cannot render,
   and a timeout/network/5xx leaves no falsely confirmed range. A valid tuple
   can still continue; an invalid tuple cannot.
4. Essential, Signature, Premium, and Luxury results reconcile to independent
   fixtures and to project creation for the same public tuple.
5. The visible basis includes rule version/publication date, internal-benchmark
   status, absent current-market calibration date, market warning, directional
   confidence, area/cost methods, selected factors/rate, band factors, tax/fee
   treatment, exclusions, and the professional boundary.
6. Estimator-to-start handoff stores and transfers only the five allowlisted tuple
   fields, fixed marker, and opaque retry key. It is available for a valid current
   tuple in loading, unavailable, and confirmed states, and unavailable for every
   invalid tuple. After the visitor edits the private brief, the exact full-draft
   allowlist moves to the sole versioned local draft envelope. Auth navigation
   carries only a continuation marker, the same key, expected write UUID and
   revision, and fixed source marker. No browser estimate is transferred or
   trusted by project creation.
7. Anonymous estimate requests omit credentials and CSRF material. Browser
   state contains no dedicated account/contact/address field, upload, bearer
   credential, arbitrary nested value, or browser estimate; the local private
   draft can contain identifying text entered as its project name. Operational
   logs contain neither tuple nor draft. Blocked storage still reaches the
   start/auth journey through a same-tab in-memory copy, and an abandoned
   continuation cannot be recovered by an unrelated login.
8. Only an attributed project-creation request carries the exact entry-point
   header. Invalid, unauthorized, failed, and direct-start project requests do
   not increment the estimator aggregate, and measurement failure cannot change
   a successfully inserted project's response.
9. Keyboard, screen-reader announcements, 390 px, 200% zoom/text spacing,
   reduced motion, no-horizontal-overflow, console, and network checks pass.
10. A valid shared link performs a fresh credential-free server calculation;
    missing, duplicate, unknown, malformed, unsupported, hashed, or out-of-range
    inputs show one value-free invalid state and perform no estimate request.
    The document is no-store/noindex/no-referrer and does not bootstrap auth.
11. Native share, copy fallback, cancellation, and copy failure preserve the
    tuple and expose clear accessible state. Continue carries only the tuple,
    `shared_estimate` marker, and retry key into the existing exact-draft flow.

## Measurement and guardrails

The shipped leading KPI is **daily attributed brief starts**. Landing-page
handoffs increment `public_estimator_brief_started / public_estimator / success`;
shared-link handoffs increment
`shared_estimate_brief_started / shared_estimate / success`. Neither is a
generic client event. The first-party client adds only the matching fixed entry
point to the authenticated create request, and the Worker attempts one aggregate
increment only after the validated project row has been inserted successfully.

The primary DISC-07 readout is first-created projects attributed to
`shared_estimate` over 7 and 30 days, plus their share of all estimator-attributed
first creates. It is not labelled an anonymous conversion rate: no stable
visitor/share identifier or denominator exists, and adding one requires a
separate privacy review.

Invalid or unauthorized creation attempts never reach measurement. Direct-start
creation sends no attribution header and records no estimator start. The event
name is not accepted by generic `POST /api/events`, so a client cannot record it
separately from project creation. The aggregate write is best effort: failure is
operationally logged without changing the successful `201` project response or
the stored project. The header is a bounded attribution hint, not proof of an
anonymous person's identity or a security decision.

D1 stores this as an aggregate count only. The aggregate contains no estimator
tuple, account identity, project or revision identifier, IP address, free text,
or client timestamp. This count is a useful leading indicator, not an anonymous
conversion rate: a true anonymous estimator-to-project conversion rate would
need a privacy-preserving denominator and cross-auth attribution design and
remains a separately reviewed future measure.

The correctness guardrail is **zero public-to-project estimate mismatches** for
the same normalized width, length, city, floors, quality, rule version, and
calculation basis. API fixtures, the authenticated canary, and smoke evidence
must compare `plotSqft`, `builtUpSqft`, `lowInr`, and `highInr` exactly. Any
mismatch blocks promotion and requires the public estimator to be treated as
unavailable until corrected.

## Persistence and migration boundary

The public calculation itself remains stateless: it reads no account or project
row and writes no D1 or KV record. Migration
`0014_project_creation_idempotency.sql` supports the subsequent authenticated
create boundary. It adds nullable `creation_key_hash` and
`creation_request_hash` columns plus a unique partial index on
`(user_id, creation_key_hash)`. Existing rows are not backfilled, and the
previous Worker remains compatible because its explicit insert ignores the new
nullable columns. Readiness is not current until both columns and the index are
present.

The browser retains the safe scenario tuple, fixed source marker, and opaque
retry key for the immediate start journey. Once the visitor begins editing the
full brief, one strict local envelope becomes the only persisted payload source.
Navigation into authentication retains only the explicit continuation marker,
matching retry key, expected write UUID/revision, and bounded source marker; it
never mirrors the full brief into history or session storage. Project creation's
existing aggregate table receives only a best-effort daily counter update after
the first attributed insert; idempotent replay never increments it again.
DISC-07 therefore warrants no `0018` migration: no shared scenario, token,
anonymous visit, or browser identity is stored in D1 or KV.

Project creation already validates the full request and calls the Worker-owned
estimate calculation again before storing `input_json`, `estimate_json`, the
input hash, and rule version. It does not trust or persist the public response.
Existing project values, revisions, and reports therefore remain unchanged;
a future rule change must advance the rule version and follow the existing
immutable-revision and release process rather than rewriting history.

## Methodology governance boundary

This release formalizes and makes consistent an inherited internal concept-rule
set; it does not represent a new market-data study. Founder/Product owns the
rule until a cost-methodology owner, licensed-practitioner review, source
register, update cadence, regional calibration, and change approval process are
recorded. Until then, `marketBenchmarkAsOf` remains `null`, the UI names the
benchmark as internal and directional, and the market warning requires current
local quotations before decisions. Paid cost claims or freshness language stay
out of scope. Any future calibration must publish its evidence, advance the rule
version when outputs change, update fixtures, and pass the same staged release.
