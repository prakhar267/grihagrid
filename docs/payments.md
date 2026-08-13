# Razorpay checkout and reconciliation runbook

GrihaGrid uses Razorpay Payment Links for the invited Decision Compare pilot.
The Worker owns the price, creates an immutable local purchase boundary before
contacting Razorpay, and treats every browser return as navigation only. Only a
valid, amount-matched signed webhook may change payment state.

This document is an operational companion to
[`decision-compare.md`](./decision-compare.md),
[`backend-api.md`](./backend-api.md), and
[`operations-runbook.md`](./operations-runbook.md). If a provider dashboard or
old release note disagrees with the checked-in code and those contracts, keep
checkout closed and reconcile the discrepancy before proceeding.

## Sellable product and price

| API SKU | Customer price | Provider amount | New checkout |
|---|---:|---:|---|
| `decision_compare` | ₹999 | `99900 INR` paise | Only pilot SKU |
| `plan` | Historical | Historical | Never newly sellable |
| `site_plus` | Historical | Historical | Never newly sellable |
| `expert` | Historical | Historical | Never newly sellable |

The server rejects browser-supplied price, amount, currency, tax, URL, or other
unsupported checkout fields. Partial payment is disabled. Historical SKUs stay
readable and webhook-compatible solely so old records are not stranded.

Decision Compare accepts structured inputs and needs no R2 binding. Do not
interpret that exception as permission to sell an upload or hosted-file
promise.

## Fail-closed activation

Version-controlled production and staging defaults must remain:

```toml
PAID_CHECKOUT_ENABLED = "false"
DECISION_COMPARE_FULFILLMENT_ENABLED = "false"
ENABLED_PAYMENT_PLANS = ""
```

A new payable link requires all three controls to be valid: checkout `true`,
fulfillment `true`, and the allowlist exactly `decision_compare`. It also
requires D1, KV, a canonical HTTPS `APP_ORIGIN`, Razorpay key ID/secret, and the
webhook secret. Missing or contradictory configuration fails before a provider
call.

The controls have separate incident meanings:

- close checkout to stop new Payment Links;
- close fulfillment to stop artifact reads, progress writes, share creation,
  and public share reads;
- keep the signed webhook route active under both controls so already-created
  payments, refunds, and disputes still reconcile into D1.

Never delete or disable webhook verification as a sales kill switch.

## Environment setup

Apply migrations by binding name and target the environment explicitly:

```sh
npx wrangler d1 migrations apply DB --remote --env staging
npx wrangler d1 migrations apply DB --remote --env=""
```

Enter credentials interactively; never put their values in Git, shell scripts,
Wrangler variables, screenshots, tickets, or chat:

```sh
# Production
npx wrangler secret put RAZORPAY_KEY_ID --env=""
npx wrangler secret put RAZORPAY_KEY_SECRET --env=""
npx wrangler secret put RAZORPAY_WEBHOOK_SECRET --env=""
npx wrangler secret list --env=""

# Staging uses distinct Razorpay test-mode values
npx wrangler secret put RAZORPAY_KEY_ID --env staging
npx wrangler secret put RAZORPAY_KEY_SECRET --env staging
npx wrangler secret put RAZORPAY_WEBHOOK_SECRET --env staging
npx wrangler secret list --env staging
```

Register the exact production webhook URL:

```text
https://grihagrid.prakhargupta267.workers.dev/api/payments/razorpay/webhook
```

Subscribe to the state-changing events implemented and tested by the Worker:

- `payment_link.paid`
- `payment.captured`
- `refund.processed`
- `payment.dispute.created`
- `payment.dispute.lost`

The webhook signing secret is independent from the Razorpay API key secret.
Coordinate rotations so the provider and Worker remain compatible; preserve
the old secret until in-flight delivery has been accounted for.

## Checkout contract

The public catalog is authoritative for price, consent version, and whether the
CTA may open:

```http
GET /api/commerce/catalog
```

The only Decision Compare checkout request is:

```http
POST /api/projects/:projectId/orders
Content-Type: application/json
Idempotency-Key: <new client-generated UUID>
X-CSRF-Token: <grihagrid_csrf cookie value>

{
  "plan": "decision_compare",
  "decisionComparisonId": "comparison-uuid",
  "acceptedTerms": true,
  "acceptedProfessionalBoundary": true,
  "termsVersion": "pilot-v1"
}
```

The owner must already have a working selection for that explicit immutable
comparison. The server atomically locks its then-current value in the same D1
batch that creates the order and purchase snapshot. A monotonic project-input
revision must still equal the comparison's captured source revision inside
that batch; a concurrent input/choice race rolls back the lock, order, and
snapshot together and returns `409 decision_checkout_conflict`. The server rejects a
missing/blank comparison ID, missing consent,
stale terms version, stale project basis, foreign project, archived project,
and any extra field. `pilot-v1` is only a technical placeholder until counsel
approves and versions the exact terms/refund/professional-boundary copy.

`Idempotency-Key` is mandatory and user-scoped. Same-key/same-request replay
returns the canonical order; reuse for different input returns `409`. The
Worker persists `orders.request_hash`, a SHA-256 identity of the project,
server-owned product/price/currency, explicit comparison ID, accepted terms
version and both consent booleans. A second browser or new key may reuse an
existing `created` or `paid` order only when that full hash matches. A changed
comparison or consent contract returns `409 active_checkout_conflict`; a failed
attempt requires a new key.

Before the provider call, D1 atomically stores:

- `orders.product_code=decision_compare` and compatible `orders.plan=plan`;
- server-owned `99900 INR`;
- canonical request hash plus accepted terms version/time; and
- one immutable purchased Decision Compare snapshot containing the exact two
  scenarios and selection frozen at checkout.

The returned `checkoutUrl` must be HTTPS on Razorpay's trusted host. The browser
may navigate only to that server-returned URL. A 10-second provider timeout,
invalid provider response, or untrusted URL marks the local attempt failed and
returns no payable result.

Payment Links expire at the provider after 24 hours. Daily maintenance marks
local `created` attempts older than 25 hours failed and removes their URL. A
late authentic capture is reconciled atomically. If its only sibling is an
unpaid `created` replacement, that replacement is failed and its URL is removed
before the captured order becomes paid. If a sibling is already paid, the late
order remains non-entitled, records the second provider payment, and opens an
explicit `duplicate_late_capture` finance case. Owner order reads expose that
the charge requires action; the system never labels it resolved or issues a
second artifact. A processed full refund closes that case.

A failed order with no provider ID/link, webhook, terminal payment fact,
reconciliation case, fulfillment, share, or progress is an abandoned local
attempt. It and its unused snapshot may be purged atomically when the owner
deletes the project. Any durable payment evidence forces archive instead.

## Browser return and entitlement

After Razorpay returns the browser, poll owner-scoped state:

```http
GET /api/orders/:orderId
GET /api/orders/:orderId/artifact
GET /api/orders?projectId=:projectId&limit=50
```

Query parameters, redirects, screenshots, support claims, and client state
never grant access. Show paid only when D1 says `paid`; show the artifact only
when entitlement is paid/non-revoked and fulfillment is enabled.

The Decision Compare artifact is the frozen checkout snapshot. It is not
regenerated from current project inputs and has no included correction/reissue
in v1. A later input correction creates a new unpaid working comparison.

## Webhook state machine

`POST /api/payments/razorpay/webhook`:

1. bounds the exact raw body to 256 KiB;
2. verifies `x-razorpay-signature` using HMAC-SHA256 and constant-time compare;
3. deduplicates provider event ID against a body hash;
4. resolves mutually consistent local, Payment Link, provider-order, and
   payment references;
5. validates captured/paid state, exact stored amount, and `INR`;
6. requires the immutable purchase snapshot before acknowledging paid; and
7. re-evaluates terminal refund/dispute facts at SQL time before conditional
   fulfillment, then commits event evidence and final state in one D1 batch.

Raw provider payloads are not stored. The webhook ledger retains bounded event
type, event ID, payload hash, safe provider IDs, result, and timestamps.
Identical replay returns `200` without another transition; the same event ID
with different bytes returns `409`. Signed unmatched/mismatched events are
retained for investigation but do not grant entitlement. A missing snapshot
returns `5xx` so Razorpay retries rather than receiving a false acknowledgement.

Processed refunds and accepted disputes also write immutable
`payment_terminal_records`, keyed by provider object, provider event and
payment IDs. This second ledger is independent of arrival order: refund or
dispute evidence received before capture is found by the later payment ID and
reconciled before the paid transition can expose an entitlement. The same
refund delivered under another event ID is not counted twice.

Capture and terminal-event batches re-evaluate that ledger at SQL execution
time, after their state writes. Fulfillment and Expert project advancement use
conditional SQL against the resulting paid, non-revoked row, and the webhook
result is derived from that final state. Consequently, a refund or dispute
committed between the Worker's initial lookup and its capture batch cannot
create even a transient durable entitlement.

A verified payment always persists even while fulfillment is paused. Unique
processed partial refunds accumulate by payment ID and currency; once their
sum reaches the stored order amount, the order becomes `refunded` and access is
revoked. An impossible sum above the charge is labeled explicitly for finance
review but still revokes access. Accepted dispute events retain the paid
financial state but set entitlement revocation. Both immediately make artifact
and share access `410`. A partial total remains paid/non-revoked under the v1
policy, while invalid currency, object conflicts and mismatched references are
preserved for manual reconciliation.

## Daily reconciliation

Razorpay is the money-movement authority; D1 is the product order/event ledger.
Reconcile by Payment Link ID, payment ID, exact INR paise, state, and timestamp:

```sh
npx wrangler d1 execute DB --remote --env="" --command \
  "SELECT status,COUNT(*) AS count,SUM(amount_paise) AS paise FROM orders GROUP BY status ORDER BY status;"

npx wrangler d1 execute DB --remote --env="" --command \
  "SELECT id,provider_order_id,provider_payment_id,status,provider_status,created_at,paid_at FROM orders WHERE COALESCE(product_code,plan)='decision_compare' ORDER BY created_at DESC;"

npx wrangler d1 execute DB --remote --env="" --command \
  "SELECT provider_event_id,event_type,order_id,provider_payment_id,processing_result,received_at FROM payment_webhook_events ORDER BY received_at DESC LIMIT 100;"

npx wrangler d1 execute DB --remote --env="" --command \
  "SELECT record_type,provider_object_id,provider_payment_id,amount_paise,currency,provider_state,observed_at FROM payment_terminal_records ORDER BY observed_at DESC LIMIT 100;"

npx wrangler d1 execute DB --remote --env="" --command \
  "SELECT order_id,conflicting_order_id,provider_payment_id,reason,status,created_at,resolved_at FROM payment_reconciliation_cases WHERE status='open' ORDER BY created_at;"
```

Never repair a mismatch by editing an amount, currency, provider reference, or
webhook row to make it balance. Close checkout and fulfillment for any
incorrect charge, D1/provider disagreement, duplicate entitlement, or amount/
reference mismatch; preserve evidence and follow the incident runbook.

## Mandatory paid-pilot evidence

- All migrations apply to isolated staging and readiness reports current.
- Production and staging use different provider modes/secrets and data stores.
- Catalog exposes only `decision_compare` at `99900 INR`; all switches fail
  closed and signed webhooks still reconcile during containment.
- Consent, explicit comparison ID, owner/CSRF boundaries, idempotency, provider
  timeout, replay conflict, missing snapshot, wrong amount/currency/reference,
  refund/dispute-before-capture, cumulative unique partial refunds, both late
  payment branches, and entitlement revocation tests pass.
- One controlled Razorpay test-mode journey passes in staging.
- Before public money, one authorised live ₹999 payment → webhook → immutable
  artifact → receipt/settlement → full refund is checked by two people.
- GST/invoice/receipt, refund/chargeback, legal copy, support, reconciliation,
  monitoring, restore, and incident ownership have dated approval.

Keep production checkout closed until every item above and
[`launch-readiness.md`](./launch-readiness.md) is signed. Do not substitute a ₹1
charge for the exact server-priced ₹999 live proof.
