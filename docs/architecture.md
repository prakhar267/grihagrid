# GrihaGrid technical architecture

## System shape

```text
Browser / PWA
  ├─ static React application (Cloudflare Worker assets)
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
- R2 holds private site photos and report artifacts. Object keys use opaque project IDs; the public bucket URL stays disabled.
- The frontend can calculate estimates optimistically, but the server recomputes and persists every paid/reportable result.
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
  project creation, public shares and provider spend. Checkout abuse KV remains
  a brake rather than a money or entitlement ledger.
- File type is verified by signature, not extension; size/count limits are applied before R2 persistence.
- Strict CSP, HSTS, `X-Content-Type-Options`, `Referrer-Policy` and frame protections at the edge.
- Webhook signatures use constant-time comparison and a bounded replay window.
- Logs exclude request bodies, tokens, addresses, photos and provider payload secrets.
- Authentication logs also exclude email, IP, account/fence identifiers,
  password shape and every password-derived value; monitoring is aggregate by
  templated route, bounded outcome/status, release and latency.
- Gemini requests use a Worker secret, `store: false`, provider core-harm protection,
  adult consent, and sanitized inputs that exclude identity, project names,
  precise addresses, coordinates, payments, and uploads.
- Generated text is rejected unless it stays inside the advisory boundary; D1
  enforces per-user and platform spend ceilings, while KV remains a best-effort
  brake for authentication and checkout abuse.
- User deletion is a workflow: revoke sessions, tombstone identity, delete R2 objects, retain only legally required financial records.
- Registration's `email_in_use` response remains an enumeration surface. A
  known email can be deliberately fenced for the remainder of one fixed window,
  and an attacker can repeat that denial in later windows. The login fence does
  not claim to solve either risk.
- Quarterly dependency review, secret rotation and restore exercise.

## Environments

Separate `dev`, `staging` and `production` D1/R2/KV resources and secrets. Production deployments come from protected GitHub branches; database migrations run before traffic promotion. Preview deployments use synthetic data only.

## Reliability targets

- Public calculator availability: 99.9% monthly.
- Health, readiness, and deterministic estimate p95: under 500 ms. Readiness
  folds the exact table/column/object contract into one metadata inventory and
  keeps only the dynamic handoff switch as a second uncached D1 read. Releases
  retain 20 serial exact-version samples per environment and block before the
  authenticated canary unless nearest-rank readiness p95 is strictly below the
  target with every capability/closure assertion intact.
- Paid order creation: 99.9%; no duplicate fulfillment.
- Report pipeline: 99% completed within plan SLA; p95 queue age under 5 minutes for instant plans.
- RPO: 24 hours at launch, moving to 1 hour with scheduled D1 exports. RTO: 4 hours.
- Error-budget response: pause risky releases when 50% of the monthly budget is consumed in seven days.

## Scale path

At higher volume, add Queues for generation, Durable Objects for per-project orchestration, Analytics Engine for product events, Turnstile for abuse prevention, and regional provider fallbacks. Keep the public Worker stateless and preserve D1 as the entitlement ledger until write volume requires a dedicated relational database.
