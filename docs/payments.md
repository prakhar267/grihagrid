# Razorpay checkout runbook

GrihaGrid uses Razorpay **Payment Links** as an optional hosted checkout. The
Worker owns every price, creates the local D1 order first, and treats the
browser callback as navigation only. An order becomes `paid` only after a
valid, amount-matched Razorpay webhook is committed to D1.

## Product and price contract

| API plan | Customer price | Amount sent to Razorpay | Wording |
| --- | ---: | ---: | --- |
| `plan` | ₹499 | `49900` paise | Inclusive of applicable taxes |
| `site_plus` | ₹999 | `99900` paise | Inclusive of applicable taxes |
| `expert` | ₹3,499 | `349900` paise | Inclusive of applicable taxes |

Client-supplied prices are ignored. `accept_partial` is always `false`; the
webhook must report exactly the stored amount and `INR` before the order can be
paid.

## Cloudflare configuration

Apply all D1 migrations before deploying the Worker:

```sh
npx wrangler d1 migrations apply grihagrid-db --remote
```

Set the canonical HTTPS app origin as a non-secret Worker variable. It is used
to build `/checkout/return?order=<local-order-id>` and must not include a path:

```toml
[vars]
APP_ENV = "production"
APP_ORIGIN = "https://grihagrid.prakhargupta267.workers.dev"
```

Keep the existing `GRIHAGRID_CACHE` KV binding. Payment creation fails closed
with `503 payments_unavailable` when that binding is absent, because checkout
must retain its user-and-IP rate limit.

Paid plans also have a separate, fail-closed activation allowlist. The default
is **no enabled plans**, even when Razorpay secrets exist. Add only the exact
comma-separated API plans that operations can currently fulfill:

```toml
[vars]
ENABLED_PAYMENT_PLANS = "plan"
```

An omitted/empty allowlist, or a requested plan that is not listed, returns
`503 payment_plan_unavailable` before an order or provider link is created. An
unknown token in the allowlist is treated as a configuration failure. Do not
enable `site_plus` or `expert` merely because checkout works: both require the
private `FILES` R2 binding, and `expert` additionally requires an actively
staffed review queue. Checkout returns `503 fulfillment_unavailable` for either
of those plans while R2 is unavailable.

Create a Razorpay API key and a separate webhook signing secret, then upload
all credentials as encrypted Worker secrets (never place them in `wrangler.toml`
or Git):

```sh
npx wrangler secret put RAZORPAY_KEY_ID
npx wrangler secret put RAZORPAY_KEY_SECRET
npx wrangler secret put RAZORPAY_WEBHOOK_SECRET
```

Use test-mode keys until the complete payment and refund runbook has passed.
In Razorpay, configure this webhook URL:

```text
https://grihagrid.prakhargupta267.workers.dev/api/payments/razorpay/webhook
```

Subscribe at minimum to:

- `payment_link.paid`
- `payment.captured`

The configured Razorpay webhook secret must exactly match
`RAZORPAY_WEBHOOK_SECRET`. It is independent of the API key secret.

## Browser API

All browser endpoints require the secure session cookie. Writes additionally
require a trusted same-origin `Origin`, the CSRF cookie/header pair, and the KV
rate limit described in [backend-api.md](./backend-api.md).

The public read-only catalog is the source of truth for whether a paid CTA may
open today:

```http
GET /api/commerce/catalog
```

It returns the server-owned price/currency contract and an
`acceptingOrders` boolean for each plan. It never returns secret values. The
browser defaults paid actions to disabled until this endpoint explicitly says
the selected plan is accepting orders. Invalid server configuration also makes
every catalog plan fail closed.

### Create a checkout

```http
POST /api/projects/:projectId/orders
Content-Type: application/json
Idempotency-Key: <new client-generated UUID>
X-CSRF-Token: <grihagrid_csrf cookie value>

{"plan":"site_plus"}
```

`Idempotency-Key` is mandatory (8–128 URL-safe characters). It is hashed with
the authenticated user id before storage, so two accounts may safely use the
same raw UUID. Reusing a key for the same project and plan returns the original
order/link and does not create another provider checkout. Reusing it for a
different project or plan returns `409 idempotency_conflict`.

The database also permits at most one `created` or `paid` order for each
user/project/plan tuple. A different browser, cleared session storage, or a new
idempotency key therefore reuses the existing payable link. Once paid, the API
returns that order without a checkout URL so the browser cannot reopen it.
Failed or refunded attempts remain eligible for an intentional retry.

Payment Links are created with a 24-hour provider expiry. The daily maintenance
cron marks local `created` orders older than 25 hours as `failed`, records
`provider_status = 'expired'`, and removes their checkout URL. This releases the
one-active-order constraint so the customer is not stranded on a dead link;
the frozen snapshot and audit history remain retained.

Success (`201`, or `200` for a completed replay):

```json
{
  "order": {
    "id": "local-order-uuid",
    "projectId": "project-uuid",
    "plan": "site_plus",
    "planLabel": "Site Plus",
    "amountPaise": 99900,
    "currency": "INR",
    "taxInclusive": true,
    "displayPrice": "₹999",
    "status": "created",
    "checkoutUrl": "https://rzp.io/i/...",
    "providerPaymentId": null,
    "paidAt": null,
    "fulfillment": null,
    "createdAt": "2026-08-13 12:00:00",
    "updatedAt": "2026-08-13 12:00:00"
  },
  "checkoutUrl": "https://rzp.io/i/..."
}
```

Only redirect to the exact `checkoutUrl` returned by the API. A provider or
network error records the local attempt as `failed` and returns
`502 payment_provider_error`; use a new idempotency key for a deliberate retry.
The outbound Razorpay request is aborted after 10 seconds and follows the same
failed-order path, so a stalled provider cannot hold the Worker request open or
produce an ambiguous browser success.

### Poll a return or show history

```http
GET /api/orders/:orderId
GET /api/orders/:orderId/fulfillment
GET /api/orders?limit=50
GET /api/orders?limit=50&projectId=:projectId
```

Both routes are owner-scoped and return `404` for another account's order.
After Razorpay sends the user to `/checkout/return`, poll the single-order route
with bounded backoff. Show success only when its server status is `paid`.
Query parameters or provider redirect fields must never unlock a purchase.

The fulfillment route returns the persisted fulfillment state and, only when
that state is `ready`, the immutable purchased report artifact. A Plan Pack is
`ready` immediately after the verified webhook; Site Plus starts at
`awaiting_input`; Expert Review starts at `queued`. The order list and detail
routes include the same fulfillment summary. Frontends must render that state
instead of assuming every paid order is queued.

## Webhook behavior

`POST /api/payments/razorpay/webhook` is public because Razorpay calls it, but
the Worker:

1. reads at most 256 KiB and retains the exact raw bytes;
2. checks `x-razorpay-signature` with HMAC-SHA256 and
   `RAZORPAY_WEBHOOK_SECRET` using a constant-time comparison;
3. deduplicates `x-razorpay-event-id` (falling back to a body hash when the
   provider omits it);
4. locates the order from the signed Payment Link id/reference notes;
5. checks captured/paid state, payment id, exact paise amount, and `INR`;
6. requires the immutable checkout-time report snapshot;
7. stores the event, marks the order paid, and inserts the one-per-order
   fulfillment record in one D1 batch transaction.

Raw webhook bodies and customer payment details are not stored. The audit table
keeps only event id, payload hash, event type, safe provider ids, processing
result, and timestamps. Duplicate deliveries return `200` without applying a
second state change. Signed but unmatched or amount-mismatched events are
retained for investigation and acknowledged without changing the order.

## Snapshot and fulfillment boundary

Checkout freezes the current project name, normalized inputs, estimate, input
hash, report version, and complete generated report in
`purchased_report_snapshots` before Razorpay is called. Database triggers reject
updates and deletes to that table. Later project edits therefore cannot change
what was purchased.

A valid paid webhook creates one `order_fulfillments` row keyed uniquely by the
order. Event retries and distinct paid-event deliveries reuse it. Plan Pack's
frozen report is immediately readable from the owner-scoped fulfillment API.
Site Plus waits for private site materials; Expert Review enters the human
review queue. A missing snapshot causes a retryable webhook `5xx` and neither
acknowledges the event nor partially commits payment/fulfillment state.

The verified webhook and persisted `orders.status = 'paid'` remain the source
of truth. The browser callback never creates an entitlement.

Refund initiation and refund webhooks are also out of this Payment Links slice.
Until those are implemented, handle refunds in the Razorpay dashboard and
reconcile the local order operationally.

## Pre-live checklist

- Apply `0003_payments.sql` and `0004_commercial_fulfillment.sql` in staging
  and production before deploying the matching Worker.
- Verify `APP_ORIGIN` is the final HTTPS origin and not a preview URL.
- Keep `ENABLED_PAYMENT_PLANS` empty through migration and smoke testing; then
  enable one proven plan at a time.
- Confirm all three encrypted secrets exist in the target Worker environment.
- Confirm `GRIHAGRID_CACHE` is bound.
- Send a Razorpay test webhook and verify a single `payment_webhook_events` row.
- Complete one test payment for each plan and confirm exact paise amounts.
- Replay the same webhook and confirm the order remains paid once.
- Retry checkout with a different browser key and confirm the existing active
  or paid order is returned without a second Razorpay call.
- Confirm Plan Pack exposes one frozen `ready` artifact, while Site Plus and
  Expert Review expose their actual non-ready fulfillment states.
- Send a signed wrong-amount fixture and confirm the order does not change.
- Confirm a second account receives `404` for both the project checkout and
  order lookup.
- Add operational alerts for repeated `payment_provider_error`,
  `amount_mismatch`, `reference_mismatch`, and webhook `5xx` responses.
- Alert on a captured webhook for an order locally expired by maintenance; it
  is recorded as `late_payment_conflict` when a replacement order exists and
  requires provider reconciliation rather than creating a second entitlement.
- Do not switch to live keys until business/KYC, refund, invoice, tax wording,
  customer support, and privacy obligations have been reviewed by the owner.

## Provider references

- [Create a Standard Payment Link](https://razorpay.com/docs/api/payments/payment-links/create-standard/)
- [Payment Link webhook payloads](https://razorpay.com/docs/webhooks/payment-links/)
- [Validate, deduplicate, and test webhooks](https://razorpay.com/docs/webhooks/validate-test/)
