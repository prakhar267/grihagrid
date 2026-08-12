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
  ├─ order + webhook service
  ├─ signed file-access service
  └─ health/observability
      │        │        │
      ▼        ▼        ▼
     D1       R2       KV
  records   uploads   rate limits / idempotency
      │
      ▼
 Cloudflare Queue → report-generation worker → R2 PDF + D1 state

External boundaries: email provider, Razorpay, AI generation provider, architect operations.
```

## Design decisions

- A single Worker keeps the first deployment cheap and removes cross-service network hops. Split generation into a queue consumer once AI/PDF work exceeds request CPU limits.
- D1 is the source of truth for users, projects, orders and state transitions. KV is never the source of truth for money or entitlements.
- R2 holds private site photos and report artifacts. Object keys use opaque project IDs; the public bucket URL stays disabled.
- The frontend can calculate estimates optimistically, but the server recomputes and persists every paid/reportable result.
- All purchase and generation commands require idempotency keys. Payment webhooks are verified, replay-safe and recorded before fulfillment.
- Report versions are immutable. A revision creates a new version with its own assumption snapshot.

## Security and privacy controls

- Magic-link/session tokens are random, one-time or hashed at rest, rotated after use, `HttpOnly`, `Secure` and `SameSite=Lax`.
- Per-IP and per-account rate limits on login, project creation, uploads and checkout.
- File type is verified by signature, not extension; size/count limits are applied before R2 persistence.
- Strict CSP, HSTS, `X-Content-Type-Options`, `Referrer-Policy` and frame protections at the edge.
- Webhook signatures use constant-time comparison and a bounded replay window.
- Logs exclude request bodies, tokens, addresses, photos and provider payload secrets.
- User deletion is a workflow: revoke sessions, tombstone identity, delete R2 objects, retain only legally required financial records.
- Quarterly dependency review, secret rotation and restore exercise.

## Environments

Separate `dev`, `staging` and `production` D1/R2/KV resources and secrets. Production deployments come from protected GitHub branches; database migrations run before traffic promotion. Preview deployments use synthetic data only.

## Reliability targets

- Public calculator availability: 99.9% monthly.
- Paid order creation: 99.9%; no duplicate fulfillment.
- Report pipeline: 99% completed within plan SLA; p95 queue age under 5 minutes for instant plans.
- RPO: 24 hours at launch, moving to 1 hour with scheduled D1 exports. RTO: 4 hours.
- Error-budget response: pause risky releases when 50% of the monthly budget is consumed in seven days.

## Scale path

At higher volume, add Queues for generation, Durable Objects for per-project orchestration, Analytics Engine for product events, Turnstile for abuse prevention, and regional provider fallbacks. Keep the public Worker stateless and preserve D1 as the entitlement ledger until write volume requires a dedicated relational database.
