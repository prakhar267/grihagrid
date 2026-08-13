# GrihaGrid backend API

The Cloudflare Worker exposes a same-origin JSON API backed by D1. Authenticated
browser sessions use secure cookies; project files are private R2 objects and
are only streamed after a D1 ownership check.

## Deployment prerequisites

1. Apply every checked-in D1 migration, in order. Use the binding name so the
   same command shape works with isolated environments:

   ```sh
   npx wrangler d1 migrations apply DB --remote --env=""
   npx wrangler d1 migrations apply DB --remote --env staging
   ```

2. Keep the existing `DB` D1 and `GRIHAGRID_CACHE` KV bindings.
3. Create the R2 bucket and enable its Worker binding before using file APIs:

   ```toml
   [[r2_buckets]]
   binding = "FILES"
   bucket_name = "grihagrid-files"
   ```

   Project, auth, estimate, report, and file-metadata listing routes remain
   usable without R2. Upload/download/delete routes return `503
   storage_unavailable` until `FILES` exists.
4. Optionally set `APP_ORIGIN` or comma-separated `ALLOWED_ORIGINS`. The request
   URL's origin is always trusted. Production should normally serve the UI and
   API from the same origin.

Decision Compare does not require R2. Paid checkout additionally requires
Razorpay key ID/secret, webhook secret, KV, an exact HTTPS `APP_ORIGIN`, and all
three fail-closed controls: `PAID_CHECKOUT_ENABLED=true`,
`DECISION_COMPARE_FULFILLMENT_ENABLED=true`, and
`ENABLED_PAYMENT_PLANS=decision_compare`. The webhook route remains active
when either kill switch closes so already-created payments are not lost.

Do not place secrets in Worker variables or source control. No application
secret is needed for the session design: D1 stores SHA-256 hashes of random
256-bit session and CSRF values rather than their bearer values.

## Browser authentication contract

Successful registration/login sets two cookies:

- `__Host-grihagrid_session`: `HttpOnly; Secure; SameSite=Lax; Path=/`; expires
  after 30 days.
- `grihagrid_csrf`: readable by the same-origin frontend, `Secure;
  SameSite=Strict; Path=/`; expires with the session.

Registration and login return the CSRF value as `csrfToken` as well. For every
authenticated `POST`, `PUT`, `PATCH`, or `DELETE`, send the value from
`grihagrid_csrf` in `x-csrf-token`. The server checks the header against both
the cookie and the session's hash in D1. Logout also requires CSRF.

Example helper:

```js
function cookie(name) {
  return document.cookie
    .split("; ")
    .find((part) => part.startsWith(`${name}=`))
    ?.split("=").slice(1).join("=");
}

async function api(path, options = {}) {
  const method = options.method || "GET";
  const headers = new Headers(options.headers);
  if (!["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())) {
    headers.set("x-csrf-token", decodeURIComponent(cookie("grihagrid_csrf") || ""));
  }
  const response = await fetch(path, { ...options, method, headers, credentials: "same-origin" });
  if (!response.ok) throw await response.json();
  return response.status === 204 ? null : response.json();
}
```

The Worker rejects cross-origin writes unless their origin was explicitly
configured. Authenticated responses never use wildcard CORS. Login attempts
(12 per IP per 15 minutes) and registrations (8 per IP per 15 minutes) receive
best-effort KV rate limiting when `GRIHAGRID_CACHE` is configured.

## Error shape

JSON failures have a stable shape:

```json
{ "error": "human-readable message", "code": "machine_readable_code" }
```

Common statuses are `400` validation, `401` unauthenticated/invalid login,
`403` origin or CSRF rejection, `404` owned resource not found, `409` conflict,
`413` payload too large, `415` unsupported media, `429` rate limit, and `503`
missing/unhealthy binding. Ownership failures intentionally return `404`, so
one account cannot use the response to discover another account's IDs.

## Public endpoints

### `GET /api/health`

Dependency-independent liveness probe. Returns `200` when the Worker can
execute; it intentionally does not claim that D1 or another capability is
ready.

### `GET /api/readiness`

Free-product readiness probe. Returns `200 status=ready` only when D1 is
reachable, the required schema is present, and the KV abuse-control binding
exists. The response separately reports Gemini planning, private upload, and
paid-checkout capabilities, including `decisionSchema` and `paymentSchema`;
unavailable optional capabilities do not
make the free product unready. Returns `503 status=not_ready` if a required
free-product dependency is absent or unhealthy.

### `POST /api/estimate`

Public, no session required. Body:

```json
{
  "width": 30,
  "length": 50,
  "floors": "G+1",
  "quality": "Signature",
  "city": "Pune"
}
```

Dimensions are feet, each between 10 and 500. Supported floors are `G`, `G+1`,
`G+2`; qualities are `Essential`, `Signature`, `Premium`, `Luxury`; cities are
`Pune`, `Bengaluru`, `Mumbai`, `Delhi`, `Hyderabad`, `Chennai`, `Jaipur`, and
`Other`. Unknown choice values retain the prototype's safe defaults.

### `POST /api/leads`

Same-origin write. Accepts `{ "email": "...", "source": "website" }` and is
idempotent by normalized email.

### `GET /api/commerce/catalog`

Returns the public, server-priced catalog. The only SKU exposed for new sales
is `decision_compare`, `99900` paise, `INR`, tax inclusive. Its response also
includes the current `termsVersion` and `acceptingOrders`. The latter is `true`
only when the allowlist, both kill switches, KV, payment credentials, webhook
secret, and origin configuration agree. Invalid or missing configuration is
reported as closed, never optimistically open. Historical SKUs remain readable
on old orders but never appear as accepting new orders.

## Auth endpoints

### `POST /api/auth/register`

No prior session or CSRF required, but origin validation applies.

```json
{
  "name": "Ananya Rao",
  "email": "ananya@example.com",
  "password": "at-least-10-characters"
}
```

Passwords support 10–128 characters and are stored as independently salted
PBKDF2-SHA256 records (100,000 iterations, the current Workers Web Crypto
limit). Response `201`:

```json
{
  "user": {
    "id": "uuid",
    "email": "ananya@example.com",
    "name": "Ananya Rao",
    "createdAt": "2026-08-13 12:00:00"
  },
  "csrfToken": "random-token"
}
```

### `POST /api/auth/login`

Body `{ "email": "...", "password": "..." }`. Invalid accounts and invalid
passwords share `401 invalid_credentials`. Successful login rotates to a new
session and returns `{ user, csrfToken }`.

### `POST /api/auth/logout`

Requires session, same-origin request, CSRF cookie, and header. Deletes the D1
session and clears both cookies. Returns `204`.

### `GET /api/auth/me`

Requires session. Returns `{ user, csrfToken }`; use this to restore frontend
auth state after reload. Expired/deleted sessions return `401`.

## Project endpoints

Every project endpoint requires a session. Every project query is scoped by
both `project_id` and the current `user_id`.

### `POST /api/projects`

Requires CSRF. Preferred body:

```json
{
  "name": "Rao residence",
  "input": {
    "width": 30,
    "length": 50,
    "floors": "G+1",
    "quality": "Signature",
    "city": "Pune",
    "bedrooms": 3,
    "bathrooms": 3,
    "parking": true
  }
}
```

For backward compatibility, estimate fields may be at the body root. Returns
`201 { project }` with normalized input, estimate, timestamps, status
`feasibility_ready`, `inputRevision: 1`, and `reportAvailable: false`.

### `GET /api/projects?limit=50&offset=0`

Lists only the current user's projects, newest first. `limit` is 1–100.

```json
{
  "projects": [],
  "pagination": { "limit": 50, "offset": 0, "hasMore": false }
}
```

### `GET /api/projects/:projectId`

Returns `{ project }` or ownership-safe `404 project_not_found`.

### `PATCH /api/projects/:projectId`

Requires CSRF. Accepts `name`, a partial `input`, direct legacy input fields,
and/or a client-selectable status of `draft`, `feasibility_ready`, or
`archived`. An actual input/estimate change recomputes the estimate, invalidates
the prior report, and increments monotonic `inputRevision`; a rename or
status-only update preserves the revision. Server-managed report statuses
cannot be forged by the client.

### `DELETE /api/projects/:projectId`

Requires CSRF. A project with payment evidence returns `409
project_has_orders` and must be archived instead; it is not deleted. Payment
evidence includes any provider identifier or checkout URL, webhook event,
immutable terminal payment fact, reconciliation case, fulfillment, share, or
fulfillment-progress row. A failed checkout that never received any of that
evidence is an abandoned attempt, not financial history; its unused purchase
snapshot and order are removed atomically before the project is permanently
deleted. A project without payment evidence cascades its report/file metadata;
associated private R2 objects are removed first.
Returns `204` only after that preflight succeeds.

## Decision and Family Alignment endpoints

All owner endpoints below require a session and use ownership-safe `404`s.
Writes additionally require same-origin and CSRF validation. Decision Compare
accepts structured JSON only; there is no upload or arbitrary HTML/URL field.

## Family Alignment endpoints

Family Alignment is a free, structured review of one immutable Decision
Compare version. It requires D1 schema `0010_family_alignment.sql` and the KV
abuse-control binding, but no payment, email, AI, or R2 credential. It never
changes the owner's selected scenario or grants a paid entitlement.

### `GET|POST /api/projects/:projectId/family-alignment`

`GET` requires the owner session and returns the newest room plus bounded
history so an older still-active room remains discoverable and revocable:

```json
{
  "room": { "id": "uuid", "comparisonId": "uuid", "comparisonVersion": 2, "createdAt": "...", "expiresAt": "...", "revokedAt": null, "responseCount": 2, "maxResponses": 5, "active": true, "summary": {} },
  "summary": {},
  "rooms": []
}
```

`rooms` contains at most the 20 newest owner-scoped rooms. Every summary is
aggregate-only: `status`, `totalResponses`, A/B/not-ready preference counts,
high/medium/low confidence counts, and counts for the six allowlisted reasons.
It never returns a response row, response ID/digest, participant timestamp, or
room bearer token.

`POST` requires trusted origin, session, CSRF, KV and an `Idempotency-Key`
header. The exact body is `{ "comparisonId": "uuid" }`. The comparison must be
the project's explicit latest saved version and must still match the current
project input revision. Exactly one room may exist per comparison. First
creation returns `201` and the bearer URL exactly once:

```json
{
  "room": {
    "id": "uuid",
    "comparisonId": "uuid",
    "comparisonVersion": 2,
    "createdAt": "...",
    "expiresAt": "...",
    "revokedAt": null,
    "responseCount": 0,
    "maxResponses": 5,
    "active": true,
    "url": "https://app.example/align/secret"
  }
}
```

The expiry is exactly seven days after the server creation time. A same-key,
same-request replay returns `200` metadata without `url`; a changed request is
`409 idempotency_conflict`. A second key for the same comparison is `409
family_alignment_room_exists`. Stale or concurrently superseded input is `409
family_alignment_comparison_stale` and leaves no room behind.

### `DELETE /api/projects/:projectId/family-alignment/:roomId`

Requires trusted origin, owner session and CSRF. Revocation is idempotent and
returns `204`. Missing or foreign rooms use ownership-safe `404
family_alignment_not_found`. Revocation closes public reads and writes but
does not delete or alter the immutable comparison.

### `GET /api/family-alignment/:token`

Requires KV and a valid high-entropy room bearer. It returns only an opaque
room ID, comparison version, creation/expiry, response count/cap, generic
assumptions/disclaimer, and two neutral `Option A`/`Option B` projections. Each
projection is an allowlist of floors, bedrooms, parking, quality, derived
estimate/programme, constraints and trade-offs. It omits the project/account
identity, plot/location, comparison/scenario IDs and labels, raw inputs/notes,
scenario assumptions, hashes, recommendation, owner choice, questions,
responses, aggregates, orders and entitlement state. Review-open counters and
aggregate telemetry are best effort and cannot fail an otherwise valid read.

Malformed or unknown tokens are `404 family_alignment_not_found`; known
revoked rooms are `410 family_alignment_unavailable`; expired rooms are `410
family_alignment_expired`.

### `PUT /api/family-alignment/:token/response`

Requires KV, same-origin request, and a 40–128 character high-entropy
`x-family-response-token` header generated and retained by the browser. The
exact JSON body is:

```json
{
  "role": "spouse",
  "preference": "A",
  "confidence": "high",
  "reasons": ["space", "future_expansion"]
}
```

Roles are `spouse`, `parent`, `sibling`, `advisor`, `other`; preferences are
literal `A`, `B`, `not_ready`; confidence is `high`, `medium`, `low`; reasons
contain one to three distinct values from `budget`, `space`, `parking`,
`accessibility`, `future_expansion`, `construction_complexity`. No free text or
unknown property is accepted.

The first receipt returns `201 { response, saved: true, updated: false }`. The
same browser token updates that room-scoped receipt and returns `200 {
response, saved: true, updated: true }`, including under a concurrent retry.
Five distinct receipts is an atomic hard cap; a sixth is `409
family_alignment_full`, while an existing receipt may still update. SQL-time
expiry/revocation prevents a racing create or update and returns `410`. The
response contains only the caller's normalized response, never the group
summary. Submission telemetry is best effort.

Closed-room data is removed by the scheduled job after the expiry or
revocation boundary has been older than 90 days; response rows cascade with
the room while comparisons, projects, orders and payment ledgers remain
untouched.

## Decision Compare endpoints

### `GET|PUT /api/projects/:projectId/decision-compare`

`GET` returns the newest saved comparison plus its current selection and an
entitlement only when that exact comparison version has a non-revoked paid
order. A project with no comparison returns `404 decision_compare_not_found`.

`PUT` creates or idempotently returns an immutable version. The exact body is:

```json
{
  "priority": "balanced",
  "scenarios": [
    {
      "label": "Courtyard calm",
      "floors": "G+1",
      "bedrooms": 3,
      "parking": true,
      "quality": "Signature",
      "notes": "Protect daylight and a quiet centre."
    },
    {
      "label": "Upper-floor room",
      "floors": "G+2",
      "bedrooms": 4,
      "parking": true,
      "quality": "Premium",
      "notes": "Keep more garden at ground level."
    }
  ]
}
```

Priority is `balanced`, `budget`, `space`, or `speed`; floor and quality values
use the same server-owned allowlists shown above. Exactly two distinctly named,
materially different scenarios are required. Unknown fields, control text,
invalid bounds, and a stale/project-incompatible basis are rejected. The
server derives both estimates, recommendation, trade-offs, architect
questions, content hash, monotonically increasing version, and authoritative
`projectInputRevision` captured from the source project. A GET or choice against
a comparison whose source hash or revision no longer matches returns
`decision_compare_stale`.

### `POST /api/projects/:projectId/decision-compare/choice`

Body `{ "scenarioId": "server-scenario-id" }` selects A or B on the newest
saved comparison. Repeating the same choice is idempotent. The owner may change
A to B (or back) while no checkout/purchase snapshot exists. Checkout
atomically stamps `lockedAt` and freezes the then-current scenario with the
purchase snapshot; a later change returns `409 selection_locked`. A concurrent
choice/input change cannot produce an order for a mismatched snapshot: the D1
checkout batch checks the monotonic project/comparison revisions and rolls back
the selection lock, order, and snapshot together; the client receives `409
decision_checkout_conflict` and must reload.

### `POST /api/projects/:projectId/orders`

Requires `Idempotency-Key` (8–128 safe characters). Decision Compare accepts
only this exact JSON contract:

```json
{
  "plan": "decision_compare",
  "decisionComparisonId": "comparison-uuid",
  "acceptedTerms": true,
  "acceptedProfessionalBoundary": true,
  "termsVersion": "pilot-v1"
}
```

The catalog is authoritative for `termsVersion`; a stale value returns `409
checkout_terms_updated`. Missing acceptance returns `400
checkout_terms_required`; a missing or blank `decisionComparisonId` returns
`400 decision_comparison_required`; and an extra field (including a client
price) returns `400 invalid_checkout`. The server freezes that explicitly
identified chosen comparison, stores the accepted version/time and a canonical
SHA-256 request hash over product, price, currency, comparison and consent,
persists
`orders.product_code=decision_compare` with the historical compatible
`orders.plan=plan`, and creates a Razorpay Payment Link for exactly `99900
INR`. Same-key replay returns the canonical order only when the request hash
matches. Another active order for that project/product is reused only for the
same hash; a different comparison or consent version returns `409
active_checkout_conflict`. Browser redirects never mark an order paid.

### Order reads and purchased artifact

- `GET /api/orders?projectId=:id&limit=50` lists only the current owner.
- `GET /api/orders/:orderId` returns one owner-scoped order.
- `GET /api/orders/:orderId/artifact` returns the immutable purchased Decision
  Compare snapshot only for a paid, non-revoked entitlement while fulfillment
  is enabled. Unpaid/failed is `409`; refunded or otherwise revoked is `410`;
  paused fulfillment is `503`. A successful read also returns `progress` and
  best-effort stamps its first-opened time; failure of that ancillary stamp does
  not block artifact delivery and yields `progress: null` for that response.
- `POST /api/orders/:orderId/progress` requires origin, CSRF, owner scope, paid
  non-revoked Decision Compare entitlement, and enabled fulfillment. Its exact
  body is `{ "action": "printed" }` or `{ "action":
  "professional_handoff" }`. Unknown fields/actions are `400`; foreign orders
  are `404`; unpaid is `409`; refunded/revoked is `410`; paused fulfillment is
  `503`. Repeats preserve the first milestone timestamp.
- `GET /api/orders/:orderId/fulfillment` remains the backward-compatible
  artifact endpoint for historical products.

### Owner and public sharing

- `GET /api/projects/:projectId/decision-compare/shares` lists at most 50
  owner-scoped records and never returns token hashes, bearer tokens, or URLs.
- `POST /api/projects/:projectId/decision-compare/shares` requires an
  `Idempotency-Key` and body `{ "orderId": "...", "expiresInDays": 7 }`, where
  expiry is 1, 7, or 30 days. Only a paid, non-revoked Decision Compare order
  may create a link. The bearer token and URL are returned once; an idempotent
  replay returns metadata without the secret. New share creation best-effort
  stamps the first-shared milestone; an ancillary measurement failure cannot
  turn an otherwise successful secure-share creation into a false `5xx`.
- `DELETE /api/projects/:projectId/decision-compare/shares/:shareId` revokes the
  owned link idempotently.
- Public `GET /api/shared/decision-compare/:token` returns only the frozen
  artifact and expiry. Invalid/missing tokens are `404`; expired, manually
  revoked, refunded, disputed, or otherwise revoked entitlements are `410`.
  Public reads are rate-limited and increment an aggregate access count.

### `POST /api/payments/razorpay/webhook`

The Worker verifies `x-razorpay-signature` over the exact bounded raw body,
deduplicates `x-razorpay-event-id` against the payload hash, resolves consistent
provider references, and accepts paid state only after exact `99900 INR`
matching and an existing immutable snapshot. Supported state-changing events
are `payment_link.paid`, `payment.captured`, `refund.processed`,
`payment.dispute.created`, and `payment.dispute.lost`. Full processed refunds
and cumulative unique processed partial refunds that cover the charge set the
order to `refunded`; accepted disputes revoke entitlement while retaining the
paid financial record. Durable terminal facts are keyed by provider object,
event and payment IDs, so refunds/disputes delivered before capture are applied
before entitlement. The capture batch re-evaluates those terminal facts at SQL
execution time and inserts fulfillment only from the resulting paid,
non-revoked row, closing the concurrent terminal-event/capture ordering as well.
A late capture supersedes only an unpaid replacement; a paid sibling creates an
open duplicate-capture reconciliation case and no second entitlement. Both
refund and dispute outcomes make artifact/share access fail closed. Closing
fulfillment does not block signed webhook persistence.

### Product event aggregates

`POST /api/events` accepts only these event names:
`decision_compare_opened`, `decision_compare_saved`,
`decision_compare_option_chosen`, `decision_compare_checkout_started`,
`decision_compare_artifact_downloaded`, `decision_compare_share_created`, and
`decision_compare_share_revoked`. Properties may contain only allowlisted
`surface` and `outcome`. D1 stores daily name/surface/outcome counts—never an
event stream, identity, resource ID, version, IP, free text, or client
timestamp.

`GET /api/events/aggregate?days=30` is an operator endpoint. It returns `404`
unless a constant-time checked `METRICS_READ_TOKEN` bearer value is present and
is rate-limited; `days` is an integer from 1 to 90. Alongside the aggregate
event rows it returns `paidDecisionCohort` with `paidOrders`,
`completedWithin7Days`, and `completionRate`. A paid order is complete when its
first print, share, or explicit professional handoff occurs no later than seven
days after payment. No order/snapshot key or individual milestone is returned.

## Report endpoints

### `GET /api/projects/:projectId/report`

Returns the persisted report. If no current report exists, GET deterministically
generates and persists one from normalized project input, then returns it with
`autoGenerated: true`. Repeated calls return the same report and
`cached: true`. This makes direct dashboard/report links useful without a
separate warm-up call.

### `POST /api/projects/:projectId/report`

Requires CSRF and explicitly generates/regenerates the current report. An
unchanged input hash returns the persisted report with `cached: true`; changed
inputs produce a new version and set project status to `report_ready`.

Report contents include feasibility summary, area program, itemized cost range,
delivery phases, project-sensitive risks, next actions, an input hash, and the
concept-stage disclaimer. It is intentionally deterministic product logic, not
a statutory drawing, engineering design, contractor quote, or permit approval.

## Gemini planning-brief endpoints

These owner-scoped endpoints provide an optional advisory reading of the
current deterministic report. Gemini never replaces the estimate or report,
and a provider failure does not affect either one. The complete privacy and
operations boundary is documented in `docs/gemini-ai.md`.

### `GET /api/projects/:projectId/ai-brief`

Returns `{ aiBrief, cached: true }` for the current report, model, schema, and
prompt versions. A missing or stale brief returns `404 ai_brief_not_found`
rather than silently calling Google from a read request.

### `POST /api/projects/:projectId/ai-brief`

Requires same-origin, authentication, project ownership, CSRF, atomic D1
admission control, and `Content-Type: application/json`. The exact request body is
`{ "acceptedAiTerms": true, "refresh": false }`; `refresh` is optional. Missing
adult/Google-processing acknowledgement returns `400 ai_terms_required`.

A new generation returns `201 { aiBrief, cached: false }`. A current cache hit
or successful refresh returns `200`. Expected provider-side failures are
fail-closed as `503 ai_unavailable`, `503 ai_capacity_unavailable`, or
`502 ai_provider_error`; no provider body or credential is returned.
Concurrent work for the same project returns `409 ai_generation_in_progress`;
an exhausted per-user or platform allowance returns `429 ai_rate_limited`.
Cache hits consume no strict generation allowance; refreshes do.

## Private file endpoints

Files are limited to 10 MiB. Allowed MIME types are PDF, JPEG, PNG, and WebP.
Declared PDF and image signatures are checked. Files
are never exposed through a public R2 hostname; download is an authenticated
Worker stream with `Content-Disposition: attachment`, `nosniff`, and
`private, no-store`.

### `POST /api/projects/:projectId/files`

Requires CSRF and R2. Send `multipart/form-data` with:

- `file` (required)
- `kind`: `site-plan`, `survey`, `reference`, `inspiration`, `document`, or
  `other`

Raw-body uploads are also accepted with `Content-Type`, `x-file-name`, and
optional `x-file-kind`. Returns `201 { file }` including SHA-256 checksum.

### `GET /api/projects/:projectId/files`

Returns `{ files }` metadata for the owned project.

### `GET|HEAD /api/projects/:projectId/files/:fileId`

Streams/downloads the owned object. The R2 key is not revealed. A missing R2
object is a distinct `404 file_content_not_found` operational signal.

### `DELETE /api/projects/:projectId/files/:fileId`

Requires CSRF. Removes the private R2 object and its D1 metadata. Returns `204`.

## Operations and known external dependencies

The configured daily cron deletes expired D1 sessions, expires stale checkout
links, removes expired AI generation leases, prunes old AI counters, removes
shares 90 days after expiry/revocation, and removes product-event aggregates
older than 400 days. The Worker applies CSP, HSTS, frame denial, MIME sniffing
protection, referrer policy, permissions policy, and no-store JSON defaults to
every API response.

The free backend is functional without a payment or email vendor. Razorpay
checkout, signature verification, idempotent paid state, refund and dispute
containment are implemented, but production sales remain fail-closed until
live account/KYC, tax/receipt, settlement and reconciliation evidence exists.
External work still required includes:

- Razorpay live credentials/webhook registration, invoices/GST receipts,
  settlement reconciliation, and a controlled live purchase/refund proof;
- transactional email for verification, password reset, receipts, and report
  delivery (sending domain/provider credentials required).

Before selling, also add email verification/password reset, legal-copy review,
alerting on 5xx/D1/payment errors, remote backup/restore drills, and a
malware-scanning workflow before any future product accepts files from
untrusted third parties.
