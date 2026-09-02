# Readiness completion plan

## Decision

Complete the remaining technical and operational readiness work while keeping
paid checkout/fulfillment closed and making no legal-policy decisions. The
release remains a free, concept-stage planning service throughout this work.

## Customer problem

A household can already create and share a planning record, but it cannot yet
recover a lost account, verify its contact channel, export or close the whole
account, attach private evidence, or enter a governed professional-review
workflow. Those gaps prevent the free product from being a complete, supportable
long-lived service even without accepting payment.

## Journeys and acceptance criteria

1. **Account lifecycle:** a customer can verify an email, request and complete a
   non-enumerating password reset, export an allowlisted portable account record,
   and request deletion that immediately closes sessions, removes private data,
   and preserves only explicitly governed financial evidence.
2. **Private evidence:** an authenticated project owner can upload, list, open,
   and delete bounded static JPEG/PNG/WebP evidence through an R2 binding. Content
   signatures, ownership, project state, byte/count limits, opaque keys,
   metadata minimization, abandoned-object cleanup, and unavailable-storage
   behavior are enforced and tested.
3. **Professional review:** an owner can request review of one immutable report
   version and a pre-verified reviewer can exclusively claim it. The reviewer
   receives least-privilege access, can ask traced clarifications and submit a
   bounded completion note; the owner can answer and read the fixed outcome.
   Assignment, concurrency, audit, and quality states are explicit and never
   imply approval.
4. **Operations and quality:** restore evidence, external monitoring, load and
   security checks, accessibility checks, and incident ownership are runnable,
   privacy-bounded, and fail closed. Automated evidence is never represented as
   independent human certification.
5. **Performance and documentation:** production bundle splitting keeps every
   JavaScript chunk below the configured warning boundary without breaking
   navigation. Canonical
   readiness documentation matches live controls and distinguishes implemented,
   enabled, independently verified, and human-sign-off states.

## KPI

The technical completion KPI is a green exact-SHA release candidate with all
new lifecycle journeys covered by real local Worker/D1/R2-style tests, zero
high-severity dependency advisories, no initial JavaScript chunk above 500 kB,
current migrations and dry-run bundles for both environments, and checkout,
fulfillment, and the paid-plan allowlist still closed.

## Guardrails

- Do not enable Razorpay, paid fulfillment, a paid-plan allowlist, or make legal
  policy/copy decisions.
- Do not create a claim of architect approval, feasibility, compliance,
  construction readiness, or independent penetration/accessibility review.
- Do not expose email addresses, reset/verification/reviewer tokens, private
  object keys, file contents, report capabilities, provider payloads, or raw
  account/project identifiers in logs or public responses.
- Keep all writes owner- or role-scoped, same-origin/CSRF protected where a
  browser session is used, idempotent where retries are plausible, and fenced
  in D1 at the final state transition.
- Use forward-only migrations and keep production/staging resources isolated.
- Treat unavailable email, R2, monitoring, or human reviewers as explicit
  fail-closed operational states rather than silently claiming completion.
