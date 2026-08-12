# GrihaGrid product blueprint

**Document purpose:** the operating brief for product, design, engineering, QA, operations, and go-to-market. It defines the product GrihaGrid should become; implementation status must be tracked separately.

## 1. Executive decision

GrihaGrid should be the **India-first decision platform for families planning a home on their own plot**. A user describes the plot, household, priorities, and budget once. GrihaGrid turns that brief into a transparent feasibility assessment, an indicative construction range, a concept-stage planning report, and—when needed—a clean handoff to a licensed professional.

The valuable outcome is not an AI picture or an instant floor plan. It is **confidence before the family commits to drawings, contractors, or construction**.

The launch promise is:

> **Know what fits. Know what it may cost. Know what to do next.**

The product must never claim to replace an architect, structural engineer, soil investigation, quantity surveyor, contractor quotation, or municipal approval. Its role is to make the first expensive decisions more informed and the first professional conversation more productive.

### Product principles

1. **Decision utility over visual theatre.** Every output should answer a decision or reveal an assumption.
2. **Ranges over false precision.** Cost, area, and timeline estimates show bands, basis dates, exclusions, and confidence.
3. **One brief, progressively enriched.** A customer should never re-enter the same project for a paid report or expert review.
4. **Automation explores; professionals validate.** Safety, permission, and construction decisions stay with qualified people.
5. **Private by default.** Plot details, family needs, addresses, and site photographs are sensitive even when they are not legally classified as such.
6. **India is product context, not decoration.** Plot units, family patterns, parking, Vastu preferences, city cost factors, climate, and local approval uncertainty shape the experience.
7. **A calm premium service.** The interface should feel like a trusted architectural monograph: considered, legible, and restrained—not like an AI novelty tool.

## 2. Founder thesis and market wedge

### The problem

Plot owners usually enter home construction with fragmented inputs: a family wish list, a plot deed or hand sketch, online inspiration, broad per-square-foot claims, and advice from people with different incentives. They are asked to commission drawings or engage a contractor before they can answer basic feasibility and budget questions. Rework begins early, confidence stays low, and apparent precision disguises assumptions.

### The initial wedge

GrihaGrid owns the **pre-commissioning decision moment**:

- Will the desired programme plausibly fit?
- What trade-offs are already visible?
- What is a defensible planning range for this city and finish level?
- Which information is missing?
- What should the family take to a licensed architect or contractor?

This is narrower, safer, and more valuable than promising generative architecture. It also creates a structured data asset: the normalized brief, assumption history, cost response, revision behaviour, and expert corrections.

### Why this can compound

1. Each completed brief improves understanding of Indian plot and household patterns.
2. Expert corrections can become a governed evaluation set, not automatically training data.
3. Regional cost benchmarks and observed variance improve estimate usefulness.
4. The project workspace becomes the handoff layer across family, architect, and execution partners.
5. Trust compounds through transparent assumptions, version history, and reliable professional escalation.

### Defensible position

GrihaGrid should be neither a generic image generator nor an architect marketplace. Its defensibility should come from a structured India-specific intake model, decision-quality reports, calibrated cost ranges, traceable revisions, professional review operations, and accumulated evaluation evidence.

## 3. Brand and naming

### Selected name: GrihaGrid

**Griha** makes the category emotionally and culturally legible: the product is about a home, not generic real estate. **Grid** signals measurement, order, constraints, and a repeatable planning system. Together, the name balances warmth with technical credibility and can stretch from a consumer feasibility product to professional collaboration software.

Recommended brand hierarchy:

- Company/product: **GrihaGrid**
- Descriptor: **Home-planning intelligence for Indian plots**
- Brand line: **Know what fits. Know what it may cost.**
- Primary action: **Plan my home**
- Free output: **Feasibility brief**
- Paid output: **Planning report**
- Premium service: **Architect review**

### Naming guardrails

- Avoid product names containing “architect,” “approved,” “sanction,” “construction-ready,” or “guaranteed.” They imply professional or regulatory authority the software does not have.
- Avoid overusing “AI” in the brand. AI is an enabling method and may change; confidence and traceability are the customer promise.
- Use plain, translatable output names. A customer should understand the difference between a brief, report, and review without reading a comparison chart.
- Secure trademark, company-name, social-handle, and domain clearance before material paid acquisition. Product naming analysis is not legal clearance.

### Rejected directions

| Direction | Why it loses to GrihaGrid |
|---|---|
| “HomeForge” derivatives | Strong creation metaphor, but crowded and easy to confuse with builders, tools, or the reference product. |
| Vastu-led names | Narrow the audience and can imply guarantees. Vastu should be an optional preference layer. |
| AI-prefixed names | Trend-dependent, visually generic, and centre the implementation rather than the customer outcome. |
| Plan/drawing-led names | Undersell cost and decision support while increasing the risk of “construction-ready” interpretation. |

## 4. Customer definition, personas, and jobs

### Beachhead customer

An Indian or NRI household that owns, is buying, or is evaluating a residential plot; expects to build within roughly 3–24 months; and wants clarity before commissioning detailed work. The economic buyer is often one family member, while the decision group includes a spouse, parents, and sometimes siblings abroad.

### Personas

| Persona | Situation | Core job to be done | Anxiety | Product success signal |
|---|---|---|---|---|
| First-time plot owner | Has dimensions and a family wish list but no planning literacy | “Help me learn whether our home is plausible before I spend heavily.” | Being misled or overlooking a constraint | Completes a brief, understands trade-offs, saves the project |
| Budget steward | Responsible for keeping a family build affordable | “Give me a range I can explain and adjust.” | Cost escalation and hidden exclusions | Changes scope/finish and sees traceable estimate impact |
| NRI coordinator | Manages planning remotely with family in India | “Give us one version of the truth we can discuss asynchronously.” | Conflicting updates and low visibility | Shares a versioned report and records decisions |
| Design-led upgrader | Has references and cares about façade/material language | “Translate my taste into a useful professional brief.” | Generic or impractical concepts | Purchases site-informed report and retains design direction |
| Licensed architect reviewer | Receives inconsistent client inputs | “Give me a structured intake I can validate efficiently.” | Implied endorsement or poor-quality automation | Reviews assumptions, marks limits, returns clear notes |
| Support/operations lead | Owns orders and customer outcomes | “Show me failures and commitments before customers chase us.” | Silent generation or payment failures | Resolves from an auditable queue within SLA |
| Finance/admin | Reconciles payments, refunds, and entitlements | “Keep money state correct even when providers retry.” | Duplicate fulfillment or incorrect refunds | Reconciliation has zero unexplained exceptions |

### Jobs hierarchy

**Functional:** test plot fit; construct a room programme; compare scope options; understand budget drivers; create a professional handoff; obtain human review.

**Emotional:** reduce fear of making an irreversible mistake; feel competent in a technical conversation; build family alignment; replace vague claims with a calm plan.

**Social:** explain the decision to parents or a spouse; demonstrate diligence to an overseas family member; approach a professional with a serious brief.

## 5. Product scope and information architecture

### Customer lifecycle

```text
Discover → Explore calculator → Complete brief → Save project
    → Review free feasibility → Select confidence level → Pay once
    → Generate versioned report → Share/download → Optional architect review
    → Revise assumptions → Archive/export/delete
```

### Primary product surfaces

1. **Marketing:** promise, interactive estimator, methodology, sample report, pricing, trust boundaries, FAQ.
2. **Brief builder:** plot, context, household programme, preferences, budget/finish, evidence, review.
3. **Private workspace:** projects, status, estimates, reports, uploads, orders, revisions.
4. **Decision report:** executive readout, fit, assumptions, programme, cost, trade-offs, risks, next steps.
5. **Checkout and entitlement:** plan selection, order state, payment, invoice/refund status.
6. **Expert review:** assignment, clarification, annotations, professional identity, version/revision.
7. **Operations console:** customers, projects, generation queue, payments, reviews, incidents, audit trail.

### The report as the core artifact

Every report version should contain:

- project identity and version timestamp;
- inputs and missing information;
- scope and confidence statement;
- plot/building programme summary;
- likely area allocation and fit commentary;
- major trade-offs and unresolved decisions;
- indicative city- and finish-adjusted cost band;
- estimate assumptions, inclusions, exclusions, basis date, and sensitivity;
- directional planning/elevation/material guidance appropriate to the purchased tier;
- optional preference commentary, including Vastu, explicitly separated from safety/compliance;
- risk and professional-validation checklist;
- recommended next actions;
- visible disclaimer on every exported artifact.

Reports are immutable after issue. Editing a project creates a new input snapshot and a new report version; historical links remain attributable to their version.

## 6. Prioritized functional use cases

Priority definitions: **P0** is required to sell responsibly; **P1** improves conversion, trust, or operations immediately after launch; **P2** is a scale or expansion capability. “Done” means the happy path, authorization, error path, telemetry, and accessibility behaviour are all implemented.

### A. Discovery and evaluation

| ID | Pri | Actor and use case | Required outcome / acceptance condition |
|---|---:|---|---|
| DISC-01 | P0 | Visitor understands the offer | Hero names the customer, artifact, and limitation; primary CTA begins a brief; no “construction-ready” claim. |
| DISC-02 | P0 | Visitor adjusts an instant estimate | Width, length, floors, city, and finish update a range without reload; invalid values are bounded and explained; basis is linked. |
| DISC-03 | P0 | Visitor inspects a representative sample | Sample includes assumptions, trade-offs, estimate basis, exclusions, and disclaimer—not only attractive imagery. |
| DISC-04 | P0 | Visitor compares tiers | Each tier states artifact, turnaround, revision rights, professional involvement, and refund boundary in plain language. |
| DISC-05 | P0 | Visitor verifies trust and contact details | Methodology summary, privacy/terms/refund pages, support contact, and professional boundary are reachable before account creation. |
| DISC-06 | P1 | Returning visitor resumes an unfinished anonymous brief | Draft is restored locally with explicit expiry/clear control; sensitive uploads are never stored anonymously. |
| DISC-07 | P1 | Visitor shares a non-personal estimate scenario | Link encodes only safe scenario inputs, not address, account, or private project identifiers. |
| DISC-08 | P2 | Visitor switches language/units | Core flows support selected Indian languages and ft/m without changing canonical stored units. |

### B. Identity, session, and consent

| ID | Pri | Actor and use case | Required outcome / acceptance condition |
|---|---:|---|---|
| ID-01 | P0 | Customer registers | Unique normalized email, strong password handling, generic error messages, rate limiting, and a secure session are created. |
| ID-02 | P0 | Customer signs in/out | Session rotates on authentication; logout revokes server state; cookies are HttpOnly, Secure, and appropriately SameSite. |
| ID-03 | P0 | Customer recovers account access | One-time, expiring reset flow avoids account enumeration and revokes old sessions after password reset. |
| ID-04 | P0 | System protects mutating requests | CSRF defence, origin validation, request-size limits, and per-account/IP abuse controls are enforced. |
| ID-05 | P1 | Customer verifies email | Verification status is visible and required before paid fulfillment or external sharing. |
| ID-06 | P1 | Customer sees active sessions | User can revoke other sessions; important security events are notified. |
| ID-07 | P1 | Customer records communication consent | Transactional and marketing purposes are separate, timestamped, revocable, and not preselected. |
| ID-08 | P2 | Customer adds another family collaborator | Invite is scoped to one project, role-limited, expiring, revocable, and fully audited. |

### C. Project and brief management

| ID | Pri | Actor and use case | Required outcome / acceptance condition |
|---|---:|---|---|
| PROJ-01 | P0 | Customer creates a project | Project receives an opaque ID, owner, draft state, created/updated timestamps, and private-by-default access. |
| PROJ-02 | P0 | Customer records plot facts | Width, depth, road edge, facing, city/state, unit, and known irregularity are validated; unknown is a valid explicit answer. |
| PROJ-03 | P0 | Customer defines building programme | Floors, rooms, parking, household needs, accessibility, rental/dual-use needs, and future expansion are captured as structured fields. |
| PROJ-04 | P0 | Customer records preferences and constraints | Finish, style direction, budget, timeline, and optional Vastu preferences remain distinguishable from factual constraints. |
| PROJ-05 | P0 | Customer reviews before generation | A human-readable assumption summary shows missing/contradictory fields and requires confirmation. |
| PROJ-06 | P0 | Customer edits, archives, or deletes own project | Authorization is ownership-based; deletion explains effects on files, reports, and legally retained order records. |
| PROJ-07 | P0 | Customer sees project state | Draft, feasibility ready, generating, report ready, needs clarification, expert review, failed, and archived states have meaningful next actions. |
| PROJ-08 | P1 | Customer creates a revision | Existing project remains immutable as a prior version; changed inputs and resulting estimate deltas are visible. |
| PROJ-09 | P1 | System checks input quality | Implausible dimension/unit combinations, extreme ratios, missing access, and budget/programme conflict generate non-blocking or blocking guidance. |
| PROJ-10 | P1 | Customer adds site address | Address is optional until operationally required, encrypted or minimized where practical, and never shown in public links. |
| PROJ-11 | P2 | Customer imports a survey/document | Extracted facts require explicit human confirmation and retain provenance to page/source. |

### D. Feasibility, estimate, and report generation

| ID | Pri | Actor and use case | Required outcome / acceptance condition |
|---|---:|---|---|
| CALC-01 | P0 | System computes indicative built-up area and cost | Server uses versioned rules/factors, canonical units, bounded inputs, deterministic rounding, and records model/basis version. |
| CALC-02 | P0 | Customer understands the estimate | Low/high band, major inclusions/exclusions, city/finish factor, area basis, taxes/fees treatment, and basis date are visible. |
| CALC-03 | P0 | Customer changes a driver | Cost and fit response identify what changed; a paid/reportable estimate is recomputed server-side rather than trusted from the browser. |
| CALC-04 | P0 | Customer generates free feasibility | One idempotent request yields a stable input snapshot, estimate, fit result, constraints, and next steps or an actionable failure. |
| RPT-01 | P0 | Entitled customer requests paid report | Entitlement, current input hash, generation state, and idempotency key are verified before work starts. |
| RPT-02 | P0 | System generates a report | Every factual/quantitative output has a traceable input, rule, or evidence source; unsafe unsupported claims are rejected. |
| RPT-03 | P0 | Customer sees progress and failure | Status survives refresh; time expectations are honest; retries do not duplicate charges or concurrent versions. |
| RPT-04 | P0 | Customer views/downloads a versioned artifact | HTML and PDF identify project/version/date and carry disclaimers; download is authorized and expires when link-based. |
| RPT-05 | P0 | System quality-gates report output | Schema validation, missing-section check, numeric reconciliation, prohibited-claim check, and render verification pass before “ready.” |
| RPT-06 | P1 | Customer compares scenarios | Two project revisions show programme, area, estimate, and risk differences using the same basis version or clearly note version change. |
| RPT-07 | P1 | Customer provides report feedback | Accuracy/usefulness feedback is linked to version and section without silently changing the artifact. |
| RPT-08 | P2 | Operations reprocesses a failed job | Privileged retry is idempotent, reason-coded, audited, and does not bypass quality gates. |

### E. Files and evidence

| ID | Pri | Actor and use case | Required outcome / acceptance condition |
|---|---:|---|---|
| FILE-01 | P0 | Entitled customer uploads a site photograph | Type is verified by content signature, size/count limited, malware policy enforced, object stored privately, and metadata linked to owner/project. |
| FILE-02 | P0 | Customer views/downloads/deletes own file | Every request rechecks project access; short-lived access does not reveal permanent bucket URLs. |
| FILE-03 | P0 | System handles abandoned/partial uploads | Uncommitted objects expire automatically; retries cannot orphan untracked objects. |
| FILE-04 | P1 | Customer labels evidence | Direction, location, capture date, and note can be added; inference is not presented as user-provided fact. |
| FILE-05 | P1 | System removes unnecessary image metadata | EXIF/GPS is stripped unless explicitly required and consented to for the service. |
| FILE-06 | P2 | Customer uploads drawing/survey files | File preview is sandboxed; extracted dimensions require confirmation; original remains immutable. |

### F. Purchase, payment, and entitlement

| ID | Pri | Actor and use case | Required outcome / acceptance condition |
|---|---:|---|---|
| PAY-01 | P0 | Customer selects a paid tier for a project | Server determines SKU, price, tax treatment, currency, entitlement, and refund rule; browser-supplied price is ignored. |
| PAY-02 | P0 | Customer creates checkout | Order creation is idempotent; abandoned, failed, and expired orders are distinguishable; no entitlement is granted from redirect alone. |
| PAY-03 | P0 | Payment provider reports outcome | Signature and replay window are verified; raw event ID is unique; state transition is atomic and replay-safe. |
| PAY-04 | P0 | Customer receives entitlement | Only verified paid state grants generation/review; duplicate webhooks cannot duplicate work. |
| PAY-05 | P0 | Customer sees receipt/order history | Amount, tax/invoice status, provider reference, purchased scope, and support path are visible without exposing provider secrets. |
| PAY-06 | P0 | Support issues permitted refund | Policy eligibility, approver, reason, provider result, entitlement effect, and customer notification are audited. |
| PAY-07 | P0 | Finance reconciles provider and ledger | Daily process flags missing/duplicate/mismatched orders; exceptions have owner and resolution state. |
| PAY-08 | P1 | Checkout is temporarily unsafe | Kill switch blocks new checkout while preserving existing project/report access and displays honest service status. |
| PAY-09 | P2 | Customer buys a revision/add-on | Prior entitlement remains intact; add-on scope and expiry are explicit; price is server-owned. |

### G. Architect review

| ID | Pri | Actor and use case | Required outcome / acceptance condition |
|---|---:|---|---|
| REV-01 | P0 for premium | Operations assigns a qualified reviewer | Identity, jurisdiction/relevance, declared conflicts, SLA, and accepted scope are recorded. |
| REV-02 | P0 for premium | Reviewer opens a sanitized project pack | Least-privilege access expires after assignment; customer contact and unrelated projects remain hidden. |
| REV-03 | P0 for premium | Reviewer requests clarification | Customer receives specific questions; SLA pauses/resumes by policy; all messages are retained against the version. |
| REV-04 | P0 for premium | Reviewer submits notes | Notes distinguish observed issue, recommendation, required local validation, and limits; reviewer identity/date/version are fixed. |
| REV-05 | P0 for premium | Customer uses included revision | Revision scope and deadline are enforced; old and new outputs remain accessible and attributable. |
| REV-06 | P1 | Customer rates the review | Rating and issue categories feed reviewer QA; complaints trigger an independent escalation path. |
| REV-07 | P1 | Operations audits review quality | Sampled reviews use a rubric; unsafe or templated output can suspend assignment eligibility. |
| REV-08 | P2 | Reviewer collaborates in structured annotations | Section-level comments and disposition states replace free-form document exchange. |

### H. Sharing, support, privacy, and administration

| ID | Pri | Actor and use case | Required outcome / acceptance condition |
|---|---:|---|---|
| OPS-01 | P0 | Customer downloads their data | Export covers profile, project inputs, versions, report metadata, orders, and user-authored communications in a readable format. |
| OPS-02 | P0 | Customer requests account deletion | Sessions are revoked immediately; deletion/tombstone and R2 cleanup are tracked; legally required financial retention is explained. |
| OPS-03 | P0 | Support finds a case safely | Search uses opaque IDs or exact verified identifiers; role permissions and access are audited; no sensitive request bodies enter logs. |
| OPS-04 | P0 | Support resolves generation/payment issue | Timeline shows state changes, provider references, safe error code, retry/refund eligibility, and customer communication. |
| OPS-05 | P0 | Admin changes cost rules/content | Versioned change requires preview, approver, effective date, rollback path, and audit entry; prior reports do not mutate. |
| OPS-06 | P0 | Operator sees service health | Dashboard covers API errors/latency, auth failures, checkout/webhooks, generation queue, file errors, review SLA, and synthetic journeys. |
| OPS-07 | P0 | System performs scheduled hygiene | Expired sessions, abandoned uploads, stale orders, and deletion jobs are processed idempotently with outcome metrics. |
| OPS-08 | P1 | Customer shares a report | Recipient gets a revocable, expiring, version-specific link; sensitive sections default off; access is logged. |
| OPS-09 | P1 | Operations manages feature/kill switches | Checkout, new generation, uploads, and external sharing can be independently disabled without redeploy. |
| OPS-10 | P1 | Analyst measures funnel safely | Events use pseudonymous IDs, documented schemas, consent boundaries, and no raw address/photo/report text. |
| OPS-11 | P2 | Business manages organizations/professional teams | Tenant isolation, role-based access, seat lifecycle, and audit export are explicit. |

## 7. Business rules and state machines

### Project state

```text
draft → feasibility_ready → generating → report_ready → expert_review → archived
                            ↘ failed ↗
```

- A state change is server-owned and append-only in an audit/event record.
- “Failed” must preserve the last valid artifact and show a retry/support action.
- Editing a `report_ready` project creates a new revision; it does not alter the issued artifact.

### Order state

```text
created → pending_payment → paid → fulfilled
    ↘ expired/failed       ↘ refund_pending → refunded
```

- Provider redirect is advisory; only a verified webhook or verified server-to-server fetch confirms payment.
- State transitions are monotonic except for explicit refund/dispute paths.
- Money is stored in integer paise; SKU/price/tax snapshots are stored with the order.

### Review state

```text
queued → assigned → in_review ↔ needs_clarification → submitted → revision_open → complete
                     ↘ escalated
```

An assignment has an SLA clock, reviewer, scope version, and access expiry. Reassignment and escalation preserve the full history.

## 8. Non-functional requirements

### Reliability and performance

| Area | Launch requirement |
|---|---|
| Public availability | 99.9% monthly for marketing, calculator, and project read paths. |
| Transaction correctness | No duplicate charge-triggered fulfillment; all payment and generation commands idempotent. |
| API latency | p95 under 500 ms for normal reads/writes excluding third-party/generation work. |
| Page performance | p75 mobile LCP under 2.5 s, INP under 200 ms, CLS under 0.1 on target Indian network/device profile. |
| Report pipeline | 99% completes within the promised tier SLA; progress persists independently of a browser session. |
| Recovery | Launch target RPO 24 h and RTO 4 h; rehearse restore quarterly, then reduce RPO as paid volume grows. |
| Graceful degradation | Calculator and existing reports remain available when AI, email, payment, or review providers are impaired where safe. |

### Security and privacy

- OWASP-style threat model before payment activation and after every new trust boundary.
- Password derivation uses a modern, versioned, resource-appropriate algorithm; credentials and session/CSRF tokens are never logged or stored in plaintext.
- Authorization is deny-by-default and verified on every project, report, file, order, review, and admin operation.
- Strict CSP, HSTS, content-type sniffing prevention, frame protection, safe referrer policy, and dependency scanning are release gates.
- Rate limits cover registration, login, recovery, project creation, generation, upload, sharing, checkout, and webhooks.
- Provider secrets live only in environment secret stores and rotate without data migration.
- Sensitive fields are minimized; retention periods are documented by data class; production data is never copied into preview/staging.
- Audit events are immutable enough for incident reconstruction but exclude passwords, tokens, file contents, full addresses, and payment payload secrets.

### Accessibility and product quality

- WCAG 2.2 AA is the release target for core flows.
- Entire journey works by keyboard with visible focus, semantic headings/labels, useful error announcements, 200% zoom, and reduced motion.
- Minimum supported viewport is 320 CSS px with no horizontal page overflow.
- Critical states never rely on colour alone; all imagery has meaningful alternative text or is decorative.
- Calculator/report numeric fixtures reconcile client, server, PDF, and admin display exactly.
- Browser support policy is documented and tested against current mainstream Chrome, Safari, Edge, and Firefox plus representative Android/iOS devices.

### Operability and maintainability

- Structured logs include request ID, route template, latency, actor class, safe outcome/error code, and deployment version.
- Metrics distinguish product rejection from system failure; SLO alerts are symptom-based and actionable.
- Schema changes are additive/expand-contract; deployment never depends on rolling back an irreversible migration.
- All state-changing provider callbacks have replay fixtures. Critical services have contract tests and synthetic production journeys.
- Infrastructure and bindings are declared in version control; environments use distinct databases, buckets, namespaces, secrets, and analytics.

## 9. Target system architecture

```text
Browser / responsive web app
  ├── Static product experience and client-side estimate preview
  └── Same-origin /api requests
              │
              ▼
Cloudflare Worker: public API and policy boundary
  ├── identity, session, CSRF, authorization, rate limits
  ├── project/version and deterministic estimate services
  ├── order, entitlement, webhook, and refund orchestration
  ├── report command/status and private file access
  └── health, audit events, feature/kill switches
       │                │                 │
       ▼                ▼                 ▼
      D1               R2                KV
  source of truth   private files    rate windows, safe caches,
  and ledger        and artifacts    idempotency acceleration
       │
       ├── Cloudflare Queue → report generation/validation → R2 artifact + D1 state
       └── scheduled Worker → expiry, reconciliation, deletion, SLA checks

External trust boundaries
  payment provider · transactional email · model/provider · licensed reviewer operations
```

### Architecture decisions

1. **One edge application first.** A single Worker and D1 keep launch operations understandable. Long-running report work moves behind a queue; request handlers stay short and retry-safe.
2. **D1 is authoritative.** Users, ownership, input versions, estimate/report metadata, orders, payment events, entitlements, and review state live in relational records. KV is never authoritative for money or access.
3. **R2 remains private.** Object keys are opaque and scoped by project/version. Access passes through authorization or a short-lived signed mechanism; listing is never public.
4. **Estimates are deterministic.** The client previews, but server recomputation with a versioned rule set becomes the artifact/order record.
5. **Generation is an asynchronous command.** Persist command and input hash before enqueueing. A retry reuses the same key/version unless the input changed.
6. **Model output is untrusted input.** It must satisfy a schema, numeric checks, prohibited-claim checks, and render QA before publication. Important claims must be grounded in project input or maintained rule/evidence data.
7. **Payments use a ledger mindset.** Provider events are recorded uniquely, transitions are atomic, and entitlement follows verified payment state.
8. **Separate environments.** Development, preview, staging, and production must not share customer data, provider modes, D1, R2, or KV.
9. **Scale only at measured pressure.** Add Durable Objects for single-project orchestration or a larger relational store only when observed contention/volume justifies it.

### Service boundaries

| Service | Owns | Must not own |
|---|---|---|
| Identity | users, credentials, sessions, verification, consent | project business rules or order value |
| Project | brief, versions, ownership, state | provider payment state |
| Estimate | normalized inputs, rule version, deterministic result | client-trusted totals |
| Commerce | SKU/price snapshots, orders, events, entitlements, refunds | raw card details |
| Report | generation command, status, validation, artifact metadata | silently mutable issued output |
| File | upload policy, metadata, private object lifecycle | public permanent URLs |
| Review | assignment, SLA, clarification, notes, revision | implied regulatory approval |
| Operations | audited support actions, health, feature switches | unrestricted database access from the UI |

## 10. Data model overview

The launch schema already establishes users, sessions, projects, reports, project files, orders, and leads. The production model should converge on the following explicit relationships and immutable records.

| Entity | Purpose and key relationships |
|---|---|
| `users` | Account identity, verified contact state, deletion/tombstone state; one-to-many sessions/projects/orders. |
| `credentials` or versioned user fields | Password hash parameters separated enough to upgrade algorithms safely. |
| `sessions` | Hashed session and CSRF secrets, user, expiry, last-seen, revocation context. |
| `consents` | Purpose, policy version, action, timestamp, source; append-only. |
| `projects` | Owner, display name, current state/current version, lifecycle timestamps. |
| `project_versions` | Immutable normalized input JSON, schema version, created-by, prior version, input hash. |
| `estimates` | Project version, rule/basis version, area and cost bands, component breakdown, exclusions, confidence. |
| `reports` | Project/version, generation state, content schema version, quality result, artifact pointer, issued timestamp. |
| `project_files` | Owner/project/version, opaque R2 key, safe name, verified MIME, size, checksum, evidence kind, retention state. |
| `orders` | Project, user, SKU/price/tax snapshot, integer amount/currency, idempotency key, state. |
| `payment_events` | Provider event ID, verified status, safe normalized payload, order, processing outcome; unique and replay-safe. |
| `entitlements` | Order/customer/project, capability, start/end/revocation, remaining revision allowance. |
| `reviews` | Report version, assigned reviewer, state/SLA, scope, submitted notes, revision allowance. |
| `review_messages` | Review-scoped clarification and response with author, timestamp, attachments. |
| `share_links` | Hashed token, report version, audience scope, expiry/revocation, access count. |
| `audit_events` | Actor, action, subject type/ID, outcome, request/deployment ID, safe metadata, timestamp. |
| `leads` | Minimal pre-account contact/consent/source; merged or expired by policy. |
| `deletion_jobs` | Requested scope, required retention exception, object/record progress, completion evidence. |

Key invariants:

- All externally exposed IDs are high-entropy and non-sequential.
- Monetary values are integer minor units; dimensions/areas have canonical units.
- Issued reports point to immutable project and estimate versions.
- One provider event can affect at most one order transition.
- Deleting a project removes private files and generated artifacts while preserving only records legally/operationally required and appropriately minimized.
- Every rule/model/content version used in a customer artifact is recoverable from metadata.

## 11. Monetization and packaging

Pricing is a hypothesis to validate, not evidence of willingness to pay. Launch with one free acquisition artifact and three progressively stronger confidence products:

| Offer | Proposed launch price | Customer outcome | Cost/risk control |
|---|---:|---|---|
| Feasibility brief | Free | Plot-fit signal, room programme, indicative range, constraints | Rate-limited; no sensitive uploads; clear scope |
| Planning report | ₹499 one-time | Versioned decision report, phase budget, material direction, PDF | Automated quality gates; one generated version |
| Site-informed | ₹999 one-time | Planning report plus photo-informed observations and added risk checklist | Upload limits; no survey/inspection claim |
| Architect reviewed | ₹3,499 one-time | Qualified review, up to five questions, one bounded revision | Reviewer eligibility, capacity, SLA, and unit-economics gate |

### Packaging rules

- Sell **confidence and service depth**, not more pages or more “AI.”
- One-time pricing fits an episodic consumer journey. Do not force a subscription before recurring value exists.
- Show exact scope, turnaround, revision window, and refund boundary before checkout.
- A paid tier attaches to a project version. Major brief changes are a new version/add-on, not silently included unlimited work.
- Never use perpetual fake discounts, countdown pressure, or ambiguous crossed-out pricing; this is a trust-sensitive purchase.

### Unit economics targets

Before scaling paid acquisition, measure contribution margin by tier including payment fee, model/render compute, storage/egress, support minutes, refund loss, and reviewer cost. Suggested gates:

- automated tiers: at least 75% contribution margin after direct variable cost;
- reviewed tier: at least 40% contribution margin while meeting reviewer quality/SLA;
- payment success above 95% of valid checkout attempts;
- refund/chargeback below 5% with reasons classified;
- support burden below 0.25 contacts per paid order after the first 100 orders.

If these fail, fix scope/quality/operations before increasing acquisition. Do not solve negative reviewer economics by reducing professional diligence.

## 12. Trust, safety, legal, and professional boundaries

### What GrihaGrid may say

- “Concept-stage feasibility”
- “Indicative planning range”
- “Directional layout/programme guidance”
- “Preference alignment”
- “Reviewed by [named qualified professional] within the stated scope”

### What GrihaGrid must not say without the relevant licensed deliverable

- construction-ready, approved, sanction-ready, structurally safe, code-compliant, exact cost, guaranteed Vastu, or guaranteed completion date;
- that a site photograph is an inspection;
- that an automated output is an architect’s work or professional certification;
- that a reviewer’s limited review approves the project for construction.

### Required customer-facing controls

1. Scope statement before purchase, at report start, and on every exported page/footer.
2. Assumption and missing-data register; unknowns cannot be converted into confident facts.
3. Estimate basis date, location granularity, inclusions, exclusions, uncertainty band, and market-change warning.
4. Separate treatment of customer preference, design suggestion, regulation cue, and professional judgment.
5. Clear escalation when soil, slope, irregular boundaries, easements, high-rise/multi-unit intent, hazard exposure, or unusual structural need exceeds product scope.
6. Named reviewer identity and scope only when a real qualified professional completed the review.
7. Honest refund and delay policy; no generation starts before verified entitlement and disclosed cancellation boundary.

### Governance before live selling

- Indian counsel reviews company identity, terms, privacy notice, consumer/refund representation, tax/invoicing, IP/licensing, professional-service structure, and applicable data obligations.
- A licensed-practitioner panel validates representative outputs and red-line unsafe claims.
- Cost methodology has a named owner, source register, update cadence, change approval, and published limitations.
- AI/model providers are assessed for data use, retention, region, security, output rights, and deletion terms. Customer photos/project text are not used for model training without separate explicit consent.
- Professional reviewers have verified credentials, contract/scope, conflict policy, quality rubric, escalation route, and appropriate indemnity decision.
- Incident response covers privacy, cross-account access, payment, unsafe report content, and reviewer misconduct.

## 13. KPI framework

### North-star metric

**Weekly decision-ready projects (WDRP):** distinct projects that produce a feasibility/report artifact and complete at least one meaningful decision action within seven days—download/share, accepted trade-off, scenario comparison, or expert-review request.

This prevents “reports generated” from becoming a vanity metric. Define and instrument the qualifying actions before reporting WDRP.

### Funnel and product metrics

| Stage | Metric | Initial diagnostic question |
|---|---|---|
| Acquisition | Qualified landing sessions by source | Are we attracting plot owners, not generic inspiration traffic? |
| Engagement | Calculator meaningful-use rate | Did a visitor change at least two substantive inputs and view the result? |
| Intent | Brief start rate | Does the promise create enough confidence to disclose project details? |
| Completion | Valid brief completion rate | Where do users abandon or encounter contradictory inputs? |
| Activation | Saved feasibility rate | Does the user receive a useful artifact in the first session? |
| Value | Decision-action rate | Is the artifact being used, not merely opened? |
| Revenue | Paid conversion within 14 days | Does added confidence justify the price? |
| Fulfillment | Paid report ready within promised SLA | Can operations reliably deliver the sold outcome? |
| Professional | Review on-time/accepted rate | Is human review timely, specific, and useful? |
| Retention | 30-day returning project rate | Does the workspace remain useful during real planning? |
| Advocacy | Qualified referral/share-to-signup rate | Do customers trust the artifact enough to involve family/professionals? |

### Guardrails

- report generation/validation failure rate;
- p95 generation time and oldest queue age;
- estimate/report numeric inconsistency rate (target zero);
- refund and chargeback rate by reason;
- support contacts per order and unresolved age;
- cross-account authorization incidents (target zero);
- deletion completion within policy SLA;
- unsafe/prohibited claim findings in sampled reports;
- expert-review escalation and quality-failure rate;
- accessibility-critical defects in production (target zero).

Event names and formulas need a versioned analytics contract. Never infer success from clicks alone; join funnel events to validated project/order states without sending private brief content to analytics.

## 14. Launch risk register and runbook

| Risk | Early signal | Prevention | Immediate containment | Owner |
|---|---|---|---|---|
| Misleading/unsafe output | Practitioner audit failure, support complaint | Schema/rules, prohibited-claim gate, evaluation set, disclaimer | Disable new report generation; preserve existing access; review affected versions | Product + professional lead |
| Estimate materially wrong | High variance, repeated city complaints | Versioned benchmark sources, bands, sensitivity, periodic calibration | Mark basis degraded; widen/disable estimates for affected region | Cost methodology owner |
| Cross-account data/file access | Auth anomaly, customer report | Ownership checks, negative tests, opaque IDs, private R2 | Disable affected endpoint/share links; revoke sessions; investigate as SEV-1 | Engineering/security |
| Duplicate/incorrect charge | Reconciliation mismatch | Idempotency, verified events, ledger constraints | Kill checkout/fulfillment; reconcile and refund; preserve provider evidence | Commerce/finance |
| Provider/payment outage | Success-rate or webhook alert | Timeouts, replay queue, provider status monitoring | Pause checkout or show pending; never retry charges blindly | On-call + finance |
| Generation queue stall | Oldest-job age, SLA breach | Queue visibility, idempotent workers, capacity test | Stop new paid generation; communicate delay; drain/retry safely | On-call |
| Private file exposure | Public URL/object listing detection | Private bucket, scoped object key, auth gateway, expiry | Disable file delivery, rotate access mechanism, enumerate exposure | Engineering/security |
| Reviewer shortage/quality failure | Queue age, sampled rubric score | Capacity forecast, eligibility checks, QA sampling | Stop premium sales; reassign/escalate; offer refund | Operations/professional lead |
| Account/email abuse | Auth spikes, bounce/complaint rate | Rate limits, verification, Turnstile when justified | Tighten limits, block source, protect transactional sender | Engineering |
| Dependency/deployment regression | Synthetic journey or 5xx alert | CI, canary/preview, pinned dependencies, rollback artifact | Roll back application; use additive corrective DB migration | On-call/DevOps |
| Legal/brand challenge | Notice, counsel finding | Clearance, terms/policy review, licensed assets | Pause affected claims/brand campaign; preserve records; counsel response | Founder/legal |
| Low willingness to pay | Good activation, poor paid conversion | Customer interviews, value-based packaging tests | Avoid ad scaling; test report usefulness/scope before discounts | Founder/product |

### Go-live sequence

1. Freeze product claims, SKUs, refund boundary, cost methodology version, and professional scope.
2. Complete legal/professional review and trademark/domain clearance.
3. Apply production migrations; verify unique constraints, backup/export, and restoration in staging.
4. Configure production-only D1, R2, KV, queues, secrets, payment webhook, email authentication, monitoring, and kill switches.
5. Run automated unit/integration/contract/accessibility/security checks and a clean production build.
6. Execute staging journeys: register/recover, create/edit/delete project, generate free/paid report, upload/delete, payment success/failure/replay/refund, review clarification/revision.
7. Run production smoke with synthetic/non-sensitive data, then a real low-value payment and refund reconciled against the provider.
8. Validate 30+ representative reports with licensed practitioners before broad consumer traffic; classify every finding.
9. Launch to a small invited cohort with staffed support and daily metrics/quality review.
10. Expand only when accuracy, reliability, margin, support, and refund guardrails hold for two consecutive cohorts.

### Incident priorities

- **SEV-1:** incorrect/duplicate money movement, cross-account access, private-file disclosure, unsafe output with plausible construction harm, or broad outage. Activate kill switch, preserve evidence, establish incident command, and notify affected parties/advisers as required.
- **SEV-2:** login unavailable, report queue materially stalled, regional estimate corruption, or professional SLA collapse. Stop new commitments for the capability and recover within the declared target.
- **SEV-3:** isolated generation failure, delayed email, or non-blocking UI defect. Queue/retry or support through normal operations.

Rollback uses the last known-good application artifact. Never roll back an irreversible D1 migration; deploy an additive corrective migration. Payment/generation semantics changes require checkout or fulfillment pause during rollback.

## 15. Delivery roadmap

### Phase 0 — Responsible sellability (now to first paid cohort)

**Outcome:** one customer can discover, register, create a private project, receive a valid feasibility result, pay, obtain a quality-gated report, and get support/refund without manual database edits.

- Close P0 identity/recovery, ownership, project/version, estimate, report, file, commerce, and deletion paths.
- Implement immutable payment-event and entitlement records, webhook replay tests, and reconciliation.
- Complete R2 private upload lifecycle and report artifact delivery.
- Establish versioned estimate methodology, fixtures, report schema, prohibited claims, and render QA.
- Create operations views/runbooks, feature/kill switches, alerting, backup/restore evidence, and synthetic journeys.
- Complete legal/provider/reviewer gates and invited practitioner validation.

**Exit gate:** production smoke plus payment/refund passes; zero critical auth/data/accessibility findings; sampled report pass threshold agreed by the practitioner panel; support can resolve failures from documented tools.

### Phase 1 — Trust and conversion (weeks 3–8 after cohort start)

**Outcome:** users understand and act on the artifact; conversion improves without increasing complaints.

- Anonymous brief resume, email verification/session management, scenario comparison, report feedback.
- Photo labelling/metadata hygiene and site-informed quality rubric.
- Versioned report sharing with redaction/expiry.
- Customer-visible estimate methodology and basis freshness.
- Funnel instrumentation, classified support/refund reasons, experiment guardrails.
- Reviewer assignment/SLA/quality operations for a deliberately limited premium capacity.

**Exit gate:** paid cohort holds quality, SLA, margin, refund, and support guardrails for two consecutive release cycles.

### Phase 2 — Collaboration and regional depth (months 3–6)

**Outcome:** GrihaGrid becomes the shared planning record and improves regional relevance.

- Family collaborator roles and decision notes.
- Architect structured annotations and revision comparisons.
- Cost factor coverage with evidence governance for priority cities/regions.
- Multi-language core journey based on observed demand.
- Survey/document import with provenance and confirmation.
- Practitioner evaluation tooling and systematic expert-correction taxonomy.

### Phase 3 — Professional platform (months 6–12)

**Outcome:** validated consumer demand supports a professional workflow and repeatable supply.

- Professional workspaces, organization roles, review capacity/quality scoring, audit export.
- A practitioner-facing structured intake and handoff product.
- Governed integrations for cost data, CRM/support, and invoicing.
- Durable orchestration/queue scaling where measured load requires it.
- Regional expansion only after cost, legal, and professional coverage meet the same evidence bar.

### Explicit non-goals until evidence changes

- Municipal sanction drawings or “good for construction” documents.
- Structural design, soil/geotechnical conclusions, or contractor quotation.
- Automated professional sign-off or guaranteed compliance/Vastu outcomes.
- Construction execution marketplace, materials commerce, or loan broking.
- Unlimited generative exploration that is disconnected from project decisions.
- Native mobile applications before responsive web retention justifies them.

## 16. Founder validation agenda

Before optimizing the software, answer these with evidence:

1. Which first decision do plot owners currently pay to resolve?
2. Does a structured feasibility report change a real next action or merely entertain?
3. Which sections are trusted, challenged, shared, or ignored by customers and practitioners?
4. What estimate variance is acceptable when the basis and uncertainty are explained?
5. Is the ₹499 report a conversion product, a sustainable product, or a lead qualification mechanism?
6. Can architect review be delivered with consistent scope, quality, response time, and positive unit economics?
7. Which city/plot/household segments produce the highest decision utility and lowest unsafe ambiguity?
8. What evidence would justify expansion from “planning intelligence” into deeper professional workflow?

The founder should review five customer artifacts and two support conversations every week during the first 100 projects. The core learning loop is not traffic → conversion; it is **brief → decision artifact → customer action → professional correction → product rule**.
