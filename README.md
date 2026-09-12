# GrihaGrid

> **Know what fits. Know what it costs.**

India-first concept-stage home planning for families building on their own
plot. GrihaGrid turns a structured plot and household brief into an indicative
construction range, a private project workspace, traceable planning reports,
decision tools, and a selective handoff for professional review.

[![CI](https://github.com/prakhar267/grihagrid/actions/workflows/ci.yml/badge.svg)](https://github.com/prakhar267/grihagrid/actions/workflows/ci.yml)
[![Production smoke](https://github.com/prakhar267/grihagrid/actions/workflows/production-smoke.yml/badge.svg)](https://github.com/prakhar267/grihagrid/actions/workflows/production-smoke.yml)
[![Production backup](https://github.com/prakhar267/grihagrid/actions/workflows/production-backup.yml/badge.svg)](https://github.com/prakhar267/grihagrid/actions/workflows/production-backup.yml)

## Live product

**[Open the production demo →](https://grihagrid.prakhargupta267.workers.dev)**

Useful public starting points:

- [Home](https://grihagrid.prakhargupta267.workers.dev/)
- [Plan my home](https://grihagrid.prakhargupta267.workers.dev/start)
- [Sample plan](https://grihagrid.prakhargupta267.workers.dev/plans)
- [Sample Decision Compare](https://grihagrid.prakhargupta267.workers.dev/compare/sample)
- [Pricing and availability](https://grihagrid.prakhargupta267.workers.dev/pricing)

The free public planning journey is live. Paid checkout and paid fulfillment
remain intentionally disabled. The production site currently uses its
`workers.dev` address; a custom domain is not configured.

## What the product does

GrihaGrid is built for Indian and NRI households that want clarity before
commissioning detailed architectural or construction work. A user enters the
plot, household programme, budget, finish level, and priorities once. The
product then helps the family:

1. understand an indicative, city-adjusted construction range;
2. identify missing information and obvious programme tensions;
3. save one private, versioned source of truth for the project;
4. preview the impact of a change before accepting a new revision;
5. compare exactly two planning directions without losing their assumptions;
6. collect small, structured family feedback through a private link;
7. generate a deterministic planning report and optional Gemini explanation;
8. share only selected report sections through a revocable professional
   handoff; and
9. take a clearer brief, decision history, and verification list to licensed
   local professionals.

The core outcome is decision clarity—not an AI-rendered house, automatic floor
plan, construction drawing, or approval.

## Current capability status

| Capability | Production status | What it means |
| --- | --- | --- |
| Public planning range | Live | Server-recalculated, city- and finish-adjusted indicative range |
| Account registration and login | Live | Private project workspace with secure cookie sessions |
| Anonymous brief continuity | Live | One explicit, seven-day same-browser draft; no anonymous server record |
| Private projects | Live | Owner-scoped project data, archive/delete controls, and dashboard |
| Architecture Design Document | Live | Deterministic, printable concept report with assumptions and verification registers |
| Brief Check | Live | Missing-information and deterministic programme-tension assessment |
| Change Study and revision history | Live | Read-only impact preview before an immutable accepted revision |
| Decision Compare | Live without checkout | Versioned A/B comparison, owner selection, and sharing |
| Family Alignment | Live | Seven-day, structured, anonymous-to-owner family review for up to five responses |
| Gemini planning brief | Live | Optional advisory explanation generated from allowlisted planning facts |
| Structured report feedback | Live | Version-bound outcome and concern labels; never rewrites the report |
| Professional Handoff | Live | Expiring, revocable link containing only owner-selected report sections |
| Professional review workflow | Technical path live, controlled | Exact-report request/reviewer workflow; no practitioner identity or approval is implied |
| Account security and lifecycle | Live | Session review, revoke others, password change, export, and guarded deletion |
| Email verification and password recovery | Unavailable | Requires a verified sender domain and transactional-email configuration |
| Private image uploads | Unavailable | Implementation is fail-closed until isolated private R2 buckets are approved and bound |
| Paid checkout and fulfillment | Disabled | No public money is accepted and no paid artifact is issued |
| Custom domain | Not configured | Production remains available on the live `workers.dev` URL above |

The exact release evidence and remaining external approvals are recorded in
[Launch readiness](docs/launch-readiness.md) and
[Quality evidence](docs/quality-evidence.md).

## How to demonstrate GrihaGrid

Use fictional details for a product demonstration. Do not enter a real street
address, confidential client brief, credentials used elsewhere, or sensitive
site information.

### Quick public tour

1. Open the [production home page](https://grihagrid.prakhargupta267.workers.dev/).
2. Review the editorial product explanation and concept-stage boundary.
3. Open the [sample plan](https://grihagrid.prakhargupta267.workers.dev/plans)
   to see the shape of the planning output without creating an account.
4. Open the
   [sample comparison](https://grihagrid.prakhargupta267.workers.dev/compare/sample)
   to see how two directions are evaluated.

### Complete planning journey

1. Select **Plan my home**.
2. Enter fictional plot dimensions, city, facing, floor count, room programme,
   parking, finish level, style, road width, accessibility, future-use, and
   budget information.
3. Review the indicative range and the assumptions behind it.
4. Create a dedicated demo account, or log in, to save the exact brief. Email
   verification is not required for the current free demo.
5. Open **Project Home** and generate the Architecture Design Document.
6. Review **Brief Check**. Change a project input to see **Change Study** before
   accepting the new revision.
7. Save two alternatives in **Decision Compare**, inspect their trade-offs, and
   make an owner choice if appropriate.
8. Create a **Family Alignment** room to demonstrate bounded structured input.
   Treat its capability link as private and revoke it after the demo.
9. Generate the optional **AI planning brief** after reading its consent and
   data-use disclosure.
10. Use **Professional Handoff** to select specific report sections and create
    an expiring link. Treat the link as a bearer secret and revoke it after use.
11. Visit **Account security** to review sessions, rotate the demo password,
    export the account, or delete an ordinary demo account.

Because email recovery is unavailable, retain the demo-account password. The
app visibly refuses checkout, paid fulfillment, and uploads in this release.

## Product principles and boundaries

- **Decision utility over visual theatre:** every output should support a
  decision or expose an assumption.
- **Ranges over false precision:** cost, area, and schedule information includes
  its basis, exclusions, and uncertainty.
- **One brief, progressively enriched:** reports, revisions, comparisons, and
  handoffs stay connected to the same project history.
- **Automation explores; professionals validate:** software never becomes the
  authority for safety, permissions, design, or construction.
- **Private by default:** project routes are owner-scoped and public sharing is
  deliberately selective, expiring, and revocable.
- **India is product context:** supported choices include Indian cities, plot
  units, family patterns, parking, climate, finish levels, and optional Vastu
  preferences without promising compliance.

GrihaGrid reports are concept-stage planning aids. They are not architectural,
structural, geotechnical, quantity-surveying, tax, legal, municipal-sanction,
contractor-quotation, or construction approval. A licensed local professional
must validate every decision before design development or construction.

## Architecture

```text
Browser
  ├─ React application and static assets
  ├─ one optional same-browser anonymous draft
  └─ strict /api/* requests
          │
          ▼
Cloudflare Worker
  ├─ authentication, session, CSRF, and abuse-control boundaries
  ├─ estimator, project, revision, comparison, report, and sharing services
  ├─ sanitized Gemini planning-brief service
  └─ health, readiness, release metadata, and scheduled retention
          │
          ├───────────────┐
          ▼               ▼
         D1               KV
  users/projects/      perimeter and
  immutable history   abuse-control brakes

External, gated boundaries: Gemini, email, R2, payments, and human reviewers
```

Production and staging use separate Workers, D1 databases, KV namespaces,
secrets, and origins. D1 is the source of truth for application state. KV is an
abuse-control dependency, never the ledger for money or entitlements. Private
R2 storage, transactional email, and payments fail closed when their bindings
or controls are absent.

### Technology

- React 19 and Vite 8
- Cloudflare Workers with static assets
- Cloudflare D1 for relational state and immutable history
- Cloudflare KV for fail-closed admission and abuse controls
- Google Gemini through a server-only, sanitized and bounded integration
- Node's built-in test runner with real local workerd/D1 coverage
- GitHub Actions, CodeQL, protected environments, encrypted backup evidence,
  staged deployment, authenticated canaries, and exact-version monitoring

See [Technical architecture](docs/architecture.md) and
[Backend API](docs/backend-api.md) for the complete system and endpoint
contracts.

## Run locally

### Prerequisites

- Node.js 22 (the CI runtime)
- npm
- Wrangler authentication only when interacting with a Cloudflare account;
  local development does not require production credentials

### Install and start

```bash
git clone https://github.com/prakhar267/grihagrid.git
cd grihagrid
npm ci
npx wrangler d1 migrations apply grihagrid-db --local
```

Run the local Worker API in one terminal:

```bash
npx wrangler dev --local --port 8790 --ip 127.0.0.1 \
  --var APP_ENV:test \
  --var APP_ORIGIN:http://127.0.0.1:5173
```

Run the Vite application in another terminal:

```bash
npm run dev
```

Vite proxies `/api` to the local Worker on port `8790`. Only the test
environment accepts an HTTP loopback origin; staging and production require
HTTPS.

Do not place provider keys in source control. Gemini, Cloudflare, email,
payment, handoff, canary, and backup credentials belong only in Worker secrets
or protected GitHub environment secrets.

## Verification commands

```bash
npm ci
npm run check
npm run check:migrations
npm run check:worker
npm run check:worker:staging
npm audit --audit-level=high
git diff --check
```

| Command | Purpose |
| --- | --- |
| `npm run check` | Production build, complete serialized test suite, and operations-config validation |
| `npm run check:migrations` | Applies all migrations in order to a fresh temporary local D1 database |
| `npm run check:worker` | Bundles the production Worker without deployment or remote data access |
| `npm run check:worker:staging` | Bundles the isolated staging target without deployment |
| `npm run smoke` | Runs the bounded public smoke contract against an explicitly supplied target |
| `npm run smoke:auth` | Runs the cleanup-safe authenticated release canary |
| `npm run load:smoke` | Runs bounded local load checks; remote execution requires explicit opt-in |

## Release model

Every change is developed on a branch and merged through a pull request.
Required CI and JavaScript/TypeScript CodeQL checks must pass on the exact PR
head. After squash merge, the protected deployment workflow authorizes the
exact `main` SHA, rebuilds it on a fresh runner, and then:

1. inspects migrations and creates encrypted recovery evidence when required;
2. applies forward-only migrations and deploys to isolated staging;
3. runs readiness latency checks, public smoke, and an authenticated canary;
4. promotes the same reviewed SHA to production;
5. repeats the smoke/canary gates and verifies zero synthetic residue; and
6. observes the exact production Worker version for 30 minutes with bounded
   public probes and Worker-tail aggregates.

Documentation-only changes are classified and skip runtime deployment.
Production D1 backups are encrypted with AES-256-GCM and verified through an
isolated restore rehearsal. Operational failures route to bounded,
owner-assigned GitHub incidents.

See [Operations runbook](docs/operations-runbook.md),
[Readiness and performance](docs/readiness-performance.md), and
[Test plan](docs/test-plan.md).

## Security and privacy highlights

- Owner-scoped project, report, comparison, file, review, and account queries.
- Secure HTTP-only sessions, same-origin write checks, and CSRF validation.
- Generic authentication failures, PBKDF2 password records, per-IP KV limits,
  and per-account D1 login fencing.
- Strict request schemas, bounded streaming bodies, idempotency keys, and
  optimistic concurrency for mutable workflows.
- Immutable project revisions and report versions; structured feedback never
  changes generated report bytes.
- Share and handoff capabilities are high-entropy, digest-only at rest,
  expiring, revocable, non-indexed, and excluded from operational logs.
- Gemini receives allowlisted planning facts—not account details, exact
  addresses, uploaded files, or payment data.
- Synthetic release canaries delete only their exact test records and prove
  cleanup before a release succeeds.
- Provider credentials are never stored in the repository or exposed to
  untrusted build steps.

Security architecture and known residual risks are documented in
[Account security](docs/account-security.md),
[Account lifecycle](docs/account-lifecycle.md), and
[Quality evidence](docs/quality-evidence.md).

## Documentation map

| Area | Document |
| --- | --- |
| Product strategy, users, scope, metrics, and roadmap | [Product blueprint](docs/product-blueprint.md) |
| Technical system and security architecture | [Architecture](docs/architecture.md) |
| API contracts and external dependencies | [Backend API](docs/backend-api.md) |
| Public estimate calculation and sharing | [Public estimator](docs/public-estimator.md) |
| Anonymous browser draft and auth handoff | [Anonymous brief resume](docs/anonymous-brief-resume.md) |
| Project decision workspace | [Project Home](docs/project-home.md) |
| Completeness checks, change preview, and revisions | [Brief Check](docs/brief-check.md) |
| Two-option decision workflow | [Decision Compare](docs/decision-compare.md) |
| Structured private family review | [Family Alignment](docs/family-alignment.md) |
| Deterministic report and professional registers | [Architect review pack](docs/architect-review-pack.md) |
| Optional advisory AI explanation | [Gemini AI](docs/gemini-ai.md) |
| Immutable report feedback | [Report feedback](docs/report-feedback.md) |
| Selective professional sharing | [Professional Handoff](docs/report-handoff.md) |
| Controlled reviewer workflow | [Professional review](docs/professional-review.md) |
| Authentication, sessions, and password rotation | [Account security](docs/account-security.md) |
| Verification, recovery, export, and deletion | [Account lifecycle](docs/account-lifecycle.md) |
| Private static-image implementation and activation gate | [Private uploads](docs/private-uploads.md) |
| Payment state machine and disabled launch controls | [Payments](docs/payments.md) |
| Release evidence and current go/no-go decision | [Launch readiness](docs/launch-readiness.md) |
| Human and automated quality evidence | [Quality evidence](docs/quality-evidence.md) |
| Deployment, monitoring, backup, incident, and rollback | [Operations runbook](docs/operations-runbook.md) |

## Repository structure

```text
src/                  React application and design system
worker/               Cloudflare Worker API
migrations/           Forward-only D1 migrations
scripts/              Build, smoke, canary, backup, and release tooling
tests/                 Unit, integration, browser-contract, workerd, and D1 tests
docs/                  Product, architecture, API, security, and operations records
.github/workflows/     CI, CodeQL-gated deployment, smoke, and backup automation
wrangler.toml          Production and isolated staging configuration
```

## Current launch boundary

The repository-controlled free demo is released and monitored. Broad public or
commercial promotion still requires accountable human approval for legal copy,
keyboard and assistive-technology testing, independent security/privacy review,
representative practitioner review, staffed support ownership, independent
two-region monitoring, and a governed remote restore drill.

Those approvals must not be inferred from automated checks. Paid checkout,
fulfillment, private uploads, transactional email, and custom-domain activation
remain separately gated and visibly unavailable.
