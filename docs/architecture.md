# GrihaGrid technical architecture

## System shape

```text
Browser / PWA
  ├─ static React application (Cloudflare Worker assets)
  ├─ one strict, seven-day local anonymous brief (same browser only)
  └─ /api/* requests
          │
          ▼
Cloudflare Worker API
  ├─ auth/session boundary
  ├─ estimate + project services
  ├─ sanitized Gemini planning-brief service
  ├─ order + webhook service
  ├─ signed file-access service
  └─ health/observability
      │        │        │
      ▼        ▼        ▼
     D1       R2       KV
 records +  deferred  fail-closed login IP
 strict       uploads  perimeter + abuse brakes
 fences
      │
      ▼
 Cloudflare Queue → report-generation worker → R2 PDF + D1 state

External boundaries: Google Gemini, email provider, Razorpay, and architect operations.
```

## Design decisions

- A single Worker keeps the first deployment cheap and removes cross-service network hops. Split generation into a queue consumer once AI/PDF work exceeds request CPU limits.
- D1 is the source of truth for users, projects, orders and state transitions.
  It provides strongly consistent per-account login admission; KV provides the
  fail-closed per-IP login perimeter but is never the source of truth for money
  or entitlements.
- Optional R2 holds only normalized private static images in this release.
  Object keys use opaque project/user/file IDs, public bucket access stays
  disabled, and readiness keeps uploads false when the binding is absent.
- The frontend can calculate estimates optimistically, but the server recomputes and persists every paid/reportable result.
- Before authentication, one versioned and strictly allowlisted brief may live
  in browser storage for seven days after the last actual edit. It is the only
  persisted full-payload copy; navigation and session state carry no draft.
  Resume is explicit, reads do not extend retention, and one same-origin
  exclusive Web Lock spans the planner through explicit auth continuation before
  any shared-storage access. Contending tabs remain value-free; unsupported or
  blocked storage falls back only to the open tab. Exact write identity and
  revision fence the auth handoff. No anonymous API or D1 record exists.
- Purchase creation uses idempotency keys. AI generation uses an atomic D1
  admission counter and an expiring per-project lease so concurrent requests
  cannot duplicate provider work. Payment webhooks are verified, replay-safe,
  and recorded before fulfillment.
- Report versions are immutable. A revision creates a new version with its own assumption snapshot.
- Gemini only explains an allowlisted deterministic report snapshot. Its output is
  structured, validated, versioned, cached in D1, and never becomes the source of
  truth for estimates, compliance, payments, or entitlements.

## Security and privacy controls

- Magic-link/session tokens are random, one-time or hashed at rest, rotated after use, `HttpOnly`, `Secure` and `SameSite=Lax`.
- Password changes require the current password, advance an account authentication
  generation plus opaque revision, and replace every earlier session atomically.
  A login verified against stale authentication state cannot insert a surviving
  session.
- Session review is a bounded, read-only projection of the current session plus
  at most the 20 newest other matching sessions. It includes only a current flag,
  start time, expiry time and top-level truncation signal; D1 session/account
  identifiers, UA/browser/device fingerprints, IP, location and last-active
  state never cross the API boundary.
- Password-confirmed bulk revocation uses the same generation/revision fence but
  performs a generation-only transition: conditionally bump user auth state,
  delete every existing session and insert one replacement in one D1 batch.
  It preserves the complete password record, `password_changed_at` and the
  login-attempt fence. A copied bearer therefore closes even when review shows
  only the current row, while the unchanged password may create a later login.
- Registration accepts only email/password/optional-name primitive fields;
  login accepts exactly primitive email/password fields. Unsupported or
  confused-type fields fail before account lookup.
- Login requires healthy KV for a fixed 12-attempt per-IP window, then reserves
  one of 12 fixed, non-sliding 15-minute D1 slots for a real `user_id` before
  PBKDF2. Unknown, wrong-password, deleted, malformed-record, invalid-password-
  length and account-fenced requests each perform one real-or-dummy derivation
  and return the same `401 invalid_credentials`.
- The D1 login fence stores only `user_id`, timestamps, count and limit—never an
  email, IP, password-derived value or free text. A generation/opaque-revision-
  fenced session insert and its fence clear commit in one batch; password
  rotation clears the fence through its exact replacement-session batch.
- Per-account D1 controls supplement per-IP abuse controls on password change,
  session bulk revocation, project creation, public shares and provider spend.
  Password change and session revocation share one five-check-per-account fixed
  15-minute admission boundary. Checkout abuse KV remains a brake rather than a
  money or entitlement ledger.
- Ordinary JSON request bodies are limited while their raw bytes stream: the
  Worker accepts at most 65,536 bytes, decodes UTF-8 fatally, and only then
  parses an object. A present `Content-Length` must be decimal and can reject
  early, but absent, zero, leading-zero, or understated values never replace
  actual byte counting. Oversize, framing, reader, and media failures cancel
  unread input best-effort before any post-admission domain work.
- Anonymous report and Family capabilities retain their smaller 512/1,536-byte
  envelopes and generic misses. Razorpay webhooks retain the exact bounded raw
  bytes for HMAC verification at 256 KiB before fatal UTF-8 JSON parsing.
- Static image type is verified by signature and structure, not extension;
  dimensions, exact termination, metadata stripping, and size/count limits are
  enforced before a ready D1 record is exposed.
- Strict CSP, HSTS, `X-Content-Type-Options`, `Referrer-Policy` and frame protections at the edge.
- Webhook signatures use constant-time comparison and a bounded replay window.
- Logs exclude request bodies, tokens, addresses, photos and provider payload secrets.
- Anonymous browser drafts have no dedicated fields for files, filenames,
  addresses, coordinates, account or project identifiers, credentials, sessions,
  estimates, reports, AI output, or server responses. The user-entered project
  name may itself contain identifying text; recovery copy names that boundary,
  browser-profile exposure, and early browser eviction. Discard targets only the
  exact named record.
- Authentication logs also exclude email, IP, account/fence identifiers,
  password shape and every password-derived value; monitoring is aggregate by
  templated route, bounded outcome/status, release and latency.
- Session-review and revocation monitoring likewise remains aggregate. It does
  not add device telemetry, persist a viewed session list, or emit a product
  event with session times. Verification and recovery mail stores only bounded
  delivery evidence and is unavailable without provider configuration.
- Gemini requests use a Worker secret, `store: false`, provider core-harm protection,
  adult consent, and sanitized inputs that exclude identity, project names,
  precise addresses, coordinates, payments, and uploads.
- Generated text is rejected unless it stays inside the advisory boundary; D1
  enforces per-user and platform spend ceilings, while KV remains a best-effort
  brake for authentication and checkout abuse.
- User deletion is password-confirmed and transactional for ordinary customer
  accounts. It refuses governed financial-retention and professional-offboarding
  cases rather than silently deleting required evidence.
- Registration's `email_in_use` response remains an enumeration surface. A
  known email can be deliberately fenced for the remainder of one fixed window,
  and an attacker can repeat that denial in later windows. The login fence does
  not claim to solve either risk.
- Quarterly dependency review, secret rotation and restore exercise.

## Environments

Separate `dev`, `staging` and `production` D1/R2/KV resources and secrets. Production deployments come from protected GitHub branches; database migrations run before traffic promotion. Preview deployments use synthetic data only.

The ID-06 session-review cut adds no schema migration. It reuses migration
0015's explicitly permitted generation-only transition and migration 0017's
existing login fence. Release preflight must report no unexpected pending
migration. Worker rollback removes the UI/routes but cannot and must not undo a
completed generation bump or resurrect deleted sessions.

The Family Alignment privacy-transport cut also adds no migration. New room
capabilities live in `/align` fragments and cross the network only inside
strict JSON bodies sent to constant anonymous API paths. The Worker serves the
document through a clean credential-free `/index.html` asset request and keeps
the existing D1 digest, admission, receipt-cap, closure and retention model.
Legacy token paths remain templated and compatible only for their seven-day
drain window. Rolling back to the prior client is data-safe but temporarily
cannot render newly issued fragment links; roll forward restores them.

The bounded request-admission cut adds no migration or stored state. Rolling
back is data-compatible but restores pre-buffer request handling, so an
availability or compatibility incident should prefer a corrected roll-forward.
Upload multipart/raw-body admission remains a separate closed-capability
follow-up.

## Reliability targets

- Public calculator availability: 99.9% monthly.
- Health, readiness, and deterministic estimate p95: under 500 ms. Readiness
  folds the exact table/column/object contract and normalized dynamic handoff
  switch into one uncached, read-only D1 snapshot. Releases
  retain 20 serial exact-version samples per environment and block before the
  authenticated canary unless nearest-rank readiness p95 is strictly below the
  target with every capability/closure assertion intact.
- Paid order creation: 99.9%; no duplicate fulfillment.
- Report pipeline: 99% completed within plan SLA; p95 queue age under 5 minutes for instant plans.
- RPO: 24 hours at launch, moving to 1 hour with scheduled D1 exports. RTO: 4 hours.
- Error-budget response: pause risky releases when 50% of the monthly budget is consumed in seven days.

## Scale path

At higher volume, add Queues for generation, Durable Objects for per-project orchestration, Analytics Engine for product events, Turnstile for abuse prevention, and regional provider fallbacks. Keep the public Worker stateless and preserve D1 as the entitlement ledger until write volume requires a dedicated relational database.
