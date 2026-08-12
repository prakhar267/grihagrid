# GrihaGrid backend API

The Cloudflare Worker exposes a same-origin JSON API backed by D1. Authenticated
browser sessions use secure cookies; project files are private R2 objects and
are only streamed after a D1 ownership check.

## Deployment prerequisites

1. Apply every checked-in D1 migration, in order:

   ```sh
   npx wrangler d1 migrations apply grihagrid-db --remote
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
paid-checkout capabilities; unavailable optional capabilities do not
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
`feasibility_ready`, and `reportAvailable: false`.

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
`archived`. Input changes recompute the estimate and invalidate the prior
report. Server-managed report statuses cannot be forged by the client.

### `DELETE /api/projects/:projectId`

Requires CSRF. Permanently deletes the project and cascades its report/file
metadata; any associated private R2 objects are removed first. Returns `204`.

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

Files are limited to 10 MiB. Allowed MIME types are PDF, JPEG, PNG, WebP, ZIP,
DOCX, XLSX, DWG, and DXF. PDF and supported image signatures are checked. Files
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
links, removes expired AI generation leases, and prunes old AI counters. The Worker applies CSP,
HSTS, frame denial, MIME sniffing protection, referrer policy, permissions
policy, and no-store JSON defaults to every API response.

The backend is functional without a payment or email vendor. Production sales
still need two separate integrations that are intentionally not faked here:

- payment order creation, verified provider webhooks, refunds, invoices, and
  reconciliation (provider credentials/business account required);
- transactional email for verification, password reset, receipts, and report
  delivery (sending domain/provider credentials required).

Before selling, also add email verification/password reset, legal-copy review,
provider-backed payments, alerting on 5xx/D1/R2 errors, backup/restore drills,
and a malware-scanning workflow if customers may upload files from untrusted
third parties.
