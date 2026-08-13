# Decision Compare product and operating contract

## Status and evidence boundary

Decision Compare is the first paid learning wedge for GrihaGrid. It is not a
broad public-sales launch. The production database contained no non-synthetic
customers or orders when this scope was approved on 2026-08-13, so the price,
conversion gate, and delivery expectations below are hypotheses to validate
with a small invited Pune cohort.

The canonical SKU is `decision_compare`, priced by the server at **₹999**
(`99900` paise, `INR`, inclusive of applicable taxes). Browser-supplied prices
are ignored. Earlier SKUs remain readable for historical orders but are not
eligible for new checkout.

Both production kill switches remain closed until every launch gate in
`docs/launch-readiness.md` has dated evidence:

```toml
PAID_CHECKOUT_ENABLED = "false"
DECISION_COMPARE_FULFILLMENT_ENABLED = "false"
ENABLED_PAYMENT_PLANS = ""
```

Opening checkout requires all three controls: set
`PAID_CHECKOUT_ENABLED="true"`, set
`DECISION_COMPARE_FULFILLMENT_ENABLED="true"`, and permit only
`decision_compare` in `ENABLED_PAYMENT_PLANS`. The controls still have separate
incident semantics: closing checkout prevents new payable links, while closing
fulfillment blocks artifact and share access. Already-created, signed Razorpay
webhooks remain ingestible under either containment action. Never disable
webhook verification to stop sales.

## Customer promise

Decision Compare answers one question: **which of two realistic options should
this family take forward for professional review?**

One purchase includes:

- one owner-scoped project and exactly two frozen scenarios in one saved
  comparison version;
- a side-by-side comparison of programme, estimated built-up area, indicative
  cost band, assumptions, constraints, risks, and sacrifices;
- a transparent, non-professional recommendation with the reason and the
  decisive trade-off;
- an explicit customer selection of option A or B;
- one versioned, print-ready comparison artifact.

It does **not** include a floor plan, measured survey, site inspection,
municipal or Vastu approval, structural/geotechnical advice, sanction or
construction drawings, architect approval, uploads, or unlimited revisions.
Every screen and artifact must say that a suitably licensed professional must
verify dimensions, costs, structure, services, title, and local approvals.
Before checkout, the owner must explicitly accept the current terms and this
professional boundary. The technical consent version is currently `pilot-v1`;
it is not approved launch copy until counsel signs the exact terms, refund
policy, and checkbox language. The accepted version and timestamp are stored
on the order.

Version 1 includes **no post-purchase correction or reissue**. The purchased
artifact is immutable. An owner may correct inputs and create a new unpaid
working comparison, but it does not alter or replace what was purchased. A
governed correction-request, operator-review and linked-reissue workflow is an
explicit post-pilot backlog item; it must not be promised in pricing, support,
checkout, receipt, artifact, or refund copy until implemented and tested.

R2 is deliberately out of scope. The wedge accepts structured inputs only and
does not need customer uploads or an R2-backed PDF object to prove value. A
print-optimized, versioned HTML artifact is acceptable for the invited pilot if
browser PDF export is explicitly labelled and its numeric content is identical
to the persisted comparison. Do not advertise a hosted PDF download until a
server-created artifact is actually stored and recoverable.

## Invariants

These are release-blocking, not aspirational:

1. A comparison belongs to one user and one project. Every authenticated query
   scopes by both resource ID and `user_id`; another account receives the same
   ownership-safe `404` as a missing resource.
2. Exactly two scenarios are compared. Both are normalized and recomputed on
   the server under the same estimate/rule version. A client estimate is never
   authoritative.
3. Every persisted comparison version is immutable. Editing inputs creates a
   browser working draft and then a new saved version; it cannot mutate the
   order snapshot or a purchased customer artifact.
4. All displayed deltas are derived from the two frozen snapshots. Cost, area,
   bedroom, floor, quality, and confidence values must reconcile across API,
   screen, print/PDF, order snapshot, and operational view.
5. The recommendation cannot claim legal compliance, professional approval,
   structural adequacy, exact price, or readiness to construct. Gemini may
   improve wording only from allowlisted deterministic facts; it cannot invent
   or change numeric values and it is not required for core fulfillment.
6. Only a verified, amount- and currency-matched Razorpay webhook can mark an
   order paid. Redirects, browser callbacks, screenshots, and staff assertions
   never grant entitlement.
7. Payment webhook replay and artifact-generation retry are idempotent. One
   order creates at most one immutable purchase snapshot and one entitlement.
   Capture re-evaluates immutable refund/dispute facts inside its D1 batch so a
   terminal event racing the application pre-read cannot expose fulfillment.
8. A working selection records the comparison version, selected scenario,
   actor, and timestamp and may change before checkout. Checkout atomically
   freezes the then-current choice with its immutable purchase snapshot. Each
   real project-input change advances a D1-enforced monotonic revision; checkout
   commits only if that revision still equals the saved comparison's captured
   source revision. A concurrent input/choice race rolls the lock, order, and
   snapshot back together; later edits cannot rewrite a purchased decision.
9. Operational logs contain only the bounded completion fields and fixed,
   payload-free failure markers documented in the runbook. Browser event analytics is daily aggregate data only: event
   name, surface, outcome, count, day, and update time. Paid-cohort progression
   separately stores only the first opened, printed, shared, and explicit
   professional-handoff timestamps against the already-retained opaque order
   and snapshot keys. Neither surface may contain email, address, dimensions,
   free text, cookies, CSRF tokens, provider payloads, share tokens, or report
   content.
10. Checkout and fulfillment default closed when any flag or required
    configuration is missing, malformed, or contradictory.

## Lifecycle

```text
project draft
  -> browser working draft for scenario A + scenario B
  -> immutable comparison version saved
  -> customer selects A or B for that exact version
  -> customer accepts versioned terms and professional boundary
  -> checkout created
  -> signed Razorpay event verified
  -> order paid
  -> fulfillment permitted
  -> immutable comparison issued
  -> customer opens / prints / shares the chosen comparison
  -> fulfilled or refunded
```

Provider failure before verified payment leaves no entitlement. If payment is
verified while fulfillment is disabled or degraded, preserve `paid` and place
fulfillment in an honest recoverable state; never refund or charge again
automatically. Refund and chargeback transitions must remain reconcilable to
the provider and must not delete the immutable financial/audit record.

## API and persistence acceptance contract

The definitive routes and schema live in `docs/backend-api.md` and migrations.
Regardless of naming, QA must be able to prove:

- create/read immutable comparison versions under an authenticated owner; a
  later save creates a new version rather than updating an existing row;
- reject missing, duplicate, cross-project, or incompatible scenario inputs;
- freeze both normalized server-side inputs and rule versions before checkout;
- let the owner revise A/B idempotently before checkout, then atomically lock
  the current selection and retain its source version at the purchase boundary;
- require explicit acceptance of the exact versioned terms and professional
  boundary before creating a payable link;
- create a `decision_compare` order with an idempotency key and server-owned
  `99900 INR` price;
- issue/read a comparison only after paid entitlement and while fulfillment is
  enabled;
- record paid-cohort first-open/print/share/handoff milestones under the same
  owner, paid-entitlement, CSRF, and fulfillment boundaries without allowing a
  measurement-write failure to block artifact or share delivery;
- recover the paid artifact from dashboard/order history after a new session;
- preserve old paid output when a project draft changes; and
- return bounded, stable error codes without leaking the resource's existence.

No endpoint may accept arbitrary HTML, executable templates, external URLs, or
file bodies for this wedge. Render customer strings as text. Print output must
not embed session tokens or reveal authenticated API responses in the URL.

## Pilot and product analytics

The implemented browser-event telemetry is deliberately aggregate-only. D1 stores
`event_day`, an allowlisted `event_name`, allowlisted `surface` and `outcome`,
`event_count`, and `updated_at`. It does not store an event stream, user,
project, order, comparison or artifact IDs, versions, IP addresses, free text,
or client timestamps. Payment and refund outcomes come from the separate
immutable payment ledger, not the product-event endpoint.

| Event | Required meaning |
|---|---|
| `decision_compare_opened` | Owner opens the comparison workspace |
| `decision_compare_saved` | Server accepts and persists a two-option version |
| `decision_compare_option_chosen` | Owner records A or B for the current version |
| `decision_compare_checkout_started` | Browser receives a checkout-start response for `decision_compare` |
| `decision_compare_artifact_downloaded` | Owner invokes download/print for the purchased artifact |
| `decision_compare_share_created` | Owner creates an expiring share |
| `decision_compare_share_revoked` | Owner revokes a share |

The accepted `surface` values are `owner_compare`, `checkout`, `orders`,
`artifact`, `public_share`, and `unknown`; accepted `outcome` values are
`success`, `failure`, `saved`, `preview`, `cancelled`, and `unknown`. Any other
property is rejected instead of being retained.

Paid-cohort measurement is intentionally narrower than a general event stream.
`decision_progress` is keyed to the already-retained order and immutable
snapshot and stores only first-opened, first-printed, first-shared, explicit
professional-handoff, and update timestamps. Artifact reads and share creation
stamp their milestones best-effort: a measurement failure is logged but cannot
deny a paid artifact or a successfully created secure share. The owner may
explicitly record only `printed` or `professional_handoff`; those writes require
origin, CSRF, active paid entitlement, owner scope, and enabled fulfillment.
Repeated actions preserve the first timestamp. There is no per-customer
analytics read API; the metrics endpoint returns only paid cohort counts and a
completion rate for the requested window. These opaque keys remain linked
records, not anonymous data, and therefore follow the approved privacy and
retention policy.

The invited pilot is capped at 20 qualified owners. Do not scale acquisition
unless at least 5 of 20 pay; at least 60% of paid customers select, print/share,
or mark professional handoff within seven days; at least 90% of paid artifacts
are issued within the promised time; refunds are at or below 10%; and there are
zero critical numeric, safety, privacy, authorization, or financial defects.
These thresholds are experiment gates, not market benchmarks.

## Operational ownership

- Product owner approves promise, exclusions, no-correction boundary, and pilot
  admission.
- Engineering on-call owns API, D1, deployment, rollback, and fulfillment
  recovery.
- Payment owner owns Razorpay, settlement, refunds, chargebacks, receipts, and
  daily reconciliation.
- Quality/professional owner reviews the first ten paid artifacts and can stop
  fulfillment for misleading or unsafe output.
- Incident commander alone reopens a capability after a SEV-1/SEV-2 incident,
  with payment-owner approval for money incidents.

The first paid artifact must not be issued until all named owners and backups
are recorded outside this repository.
