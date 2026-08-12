# GrihaGrid product blueprint

## Founder thesis

Indian families do not initially need a finished architectural commission. They need an affordable way to answer three high-anxiety questions: what fits on this plot, what will it roughly cost, and what should I ask a professional next? GrihaGrid packages those answers into a fast, structured report and turns professional review into a clear upgrade instead of a prerequisite.

The wedge is not “AI draws plans.” The wedge is **decision confidence before commitment**. Floor concepts are one component of a broader decision product: feasibility, constraints, budget, material allowances, timeline, risks, and a handoff brief.

## Brand decision

**Name:** GrihaGrid  
**Promise:** Know what fits. Know what it costs.  
**Positioning:** India-first home-planning intelligence for plot owners.  
**Why it works:** “Griha” is culturally grounded; “Grid” suggests structure, measurement and a system rather than magic. The name is distinct from the reference and can stretch from consumer reports to professional collaboration.

Search checks on 12 August 2026 found no obvious exact-match home-planning product for “GrihaGrid.” This is not a trademark clearance. Counsel must conduct India trademark-class and domain checks before paid acquisition.

## Reference product audit

### What the reference does well

1. Leads with the user outcome, not the technology: a complete plan and cost report.
2. Makes value tangible through interactive plot-fit and cost calculators before asking for payment.
3. Uses one-time pricing that fits an episodic home-building journey.
4. Separates speed from confidence: instant AI tiers, then a premium human-review tier.
5. Repeats scope limitations and uses regional cost, Vastu and India-specific language to build relevance.

### Highest-impact risks

1. “Construction-ready” language can overstate the output and create safety, liability and trust risk. GrihaGrid consistently says “concept-stage” and explains professional sign-off.
2. Dense pricing tiers compete for attention. GrihaGrid gives the middle plan a clear default and states the confidence level of each tier.
3. The reference jumps to account creation before demonstrating a saved result. GrihaGrid lets prospects complete the brief first, then creates a project workspace.
4. Visual theme and promotion overlays can obscure the hero. GrihaGrid prioritizes the core promise and avoids launch-day promotional clutter.
5. Screenshot inspection cannot prove keyboard behavior, screen-reader output, data handling, payment reliability or report quality; these require implementation and operational testing.

## Primary users and jobs

| User | Job to be done | Success signal |
|---|---|---|
| First-time plot owner | Understand whether the family brief fits the plot | Completes free feasibility and saves project |
| Budget-conscious family | Establish a defensible planning range | Shares/downloads a phase-wise estimate |
| Overseas/NRI owner | Align remotely with family and professionals | Uses a single project/report as source of truth |
| Architect reviewer | Validate assumptions without rebuilding the intake | Accepts a structured brief and returns notes |
| Operations/admin | Triage orders, failed generation and review queues | Meets report and response SLAs |

## Core use cases

1. Anonymous visitor changes plot size, floors, finish and city and sees the cost range update instantly.
2. Prospect completes a four-step plot brief, sees assumptions and generates a free feasibility project.
3. User creates an account or verifies a magic link and resumes a saved project.
4. User upgrades a project, pays once, and receives an idempotently generated report and invoice.
5. Site+ customer uploads plot photos privately and deletes them later.
6. Expert customer submits questions; an assigned architect reviews, comments, signs off or requests clarification.
7. User downloads a versioned PDF, sees its generation status and can retry a failed generation safely.
8. Support can find an order by opaque ID, view safe audit metadata and issue a permitted refund.
9. System removes expired sessions and abandoned upload artifacts on scheduled jobs.
10. Admin monitors generation latency, payment/webhook failures, queue depth and error budget.

## MVP acceptance criteria

- Responsive marketing, pricing, authentication, onboarding, dashboard and report-preview routes.
- Calculator returns the same result client- and server-side for supported inputs.
- D1 migration covers users, sessions, projects, orders and leads with constraints and indexes.
- R2 files remain private and are served only through short-lived authorized URLs.
- Payment creation and webhooks use idempotency keys and signature verification before fulfillment.
- Every report contains visible scope limitations and assumption timestamps.
- Health endpoint exposes service/database health without secrets or personal data.
- Keyboard navigation, visible focus, reduced-motion behavior and mobile reflow pass QA.

## Metrics

North star: weekly projects that reach a decision-ready report. Funnel: calculator engagement → brief completion → saved project → paid report → expert review. Guardrails: refund rate, report-generation failure rate, p95 completion time, support contacts per order, deletion-request SLA and professional-review SLA.

## Explicit non-goals for launch

- Municipal-sanction or good-for-construction drawings.
- Structural engineering, soil validation or contractor quotation.
- Guaranteed Vastu/compliance outcomes.
- Autonomous architect sign-off.
- A marketplace for construction execution.
