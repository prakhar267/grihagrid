# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

## Durable product direction

The selected visual direction is **Architectural Monograph**. Keep the experience editorial, calm, and materially grounded: warm ivory paper (`#f3efe6`), near-black ink (`#181511`), restrained copper actions (`#a7532f`), Cormorant Garamond display type, DM Sans interface type, thin rules, generous whitespace, and photography that feels like a premium Indian architecture journal. Avoid gradients, glossy SaaS card walls, pill-heavy controls, decorative glassmorphism, and playful illustration. Product screens should feel like working pages from the same architectural book, not a separate admin template.

The product name is **GrihaGrid**. The core promise is: “Know what fits. Know what it costs.” It is an India-first concept-planning and professional-handoff product, never a substitute for licensed architectural, structural, geotechnical, or municipal work.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## Product and platform invariants

Treat `README.md`, `package.json`, `wrangler.toml`, `worker/index.js`, `src/App.jsx`, `src/styles.css`, and the relevant files in `docs/` as the canonical implementation and operating context. Before architectural changes, inspect the architecture, backend API, launch-readiness, operations, feature, and test-plan documentation. Inspect the configured live product and existing styles before material UI changes; evolve the current system rather than redesigning it.

The platform is React/Vite on a Cloudflare Worker with D1 and KV. Production and staging must use physically separate resources. R2 and private uploads are intentionally disabled. Gemini calls stay server-side and use the `GEMINI_API_KEY` Worker secret.

Preserve deterministic planning behavior, honest uncertainty and conflict states, Change Study before committed revisions, versioned conflict-safe project history, and immutability of revisions and purchased artifacts.

## Authority, security, and launch safety

Routine in-scope implementation and release work may proceed through branch, PR, CI, merge, migration, staging, production, smoke checks, and rollback without repeated permission. Stop for real payment or fulfillment enablement, financial or legal policy changes, changes to real customer data, credential rotation or disclosure, purchases, irreversible work without a verified recovery point, or a genuinely unavailable credential.

Never print, log, commit, or include credentials in PR text. Keep provider keys in Worker secrets and GitHub encrypted environment secrets; use existing authenticated sessions and `wrangler secret put`. Never store Gemini, Cloudflare, Razorpay, session, CSRF, share, or webhook secrets in source control.

Preserve tenant ownership and privacy. Require session, same-origin, and CSRF protection for writes; validate strict request schemas and reject unsupported fields; use idempotency and optimistic concurrency where appropriate; fence state transitions in SQL; keep reads read-only unless explicitly documented otherwise; and never expose bearer tokens, provider identifiers, secrets, or raw internal hashes.

Keep commerce and uploads fail-closed unless the user explicitly requests a paid launch and `docs/launch-readiness.md` contains dated evidence:

```text
PAID_CHECKOUT_ENABLED=false
DECISION_COMPARE_FULFILLMENT_ENABLED=false
ENABLED_PAYMENT_PLANS=""
privateUploads=false
```

Do not enable R2 automatically or advertise unavailable uploads, payments, professional review, invoices, refunds, fulfillment, or guaranteed feasibility. Never delete or modify real users, projects, orders, payments, files, or backups. Synthetic cleanup must target only the exact IDs created by the test.

## Change and verification workflow

For new implementation work, fetch first and base the branch on the latest `origin/main` while preserving unrelated user changes. Use `agent/<short-feature-name>`, stage only intended files, and never push feature work directly to `main`.

Before building, define the bounded customer problem, user journey, acceptance criteria, KPI, and guardrails. Prefer one complete customer outcome over several partial features.

Use forward-only D1 migrations. Never edit an applied migration; add a new one. Add focused tests for changed behavior and real local D1/Worker end-to-end coverage for high-risk paths.

Before completion, run at minimum:

```sh
npm ci
npm run check
npm run check:migrations
npm run check:worker
npm run check:worker:staging
npm audit --audit-level=high
git diff --check
```

Do not suppress flaky or failing tests. For relevant UI changes, verify desktop, 390px mobile, 200% zoom, keyboard operation, focus continuity, reduced motion, print, zero horizontal overflow, console/network health, and loading, empty, success, conflict, archived, stale, and error states.

Open a draft PR explaining the change, rationale, user impact, and validation evidence. Require CI, CodeQL, and required checks on the exact PR head; fix failures, mark ready only when green, squash-merge, and verify post-merge checks on the exact `main` SHA.

## Release discipline

Verify GitHub and Wrangler identities before release work. Deployment automation must use least-privilege Cloudflare credentials stored as GitHub environment secrets. Deploy only an exact merged `main` SHA, staging first, with pending staging migrations applied before the Worker. Promote the same reviewed SHA and migrations only after staging readiness, smoke checks, and relevant authenticated canaries pass. Documentation-only changes do not require a runtime deployment.

Before remote migrations, inspect pending migrations and remote data, create a protected export, record its SHA-256, permissions, D1 Time Travel bookmark, and current Worker version, then verify the resulting schema and that no migrations remain pending. Prefer Worker rollback for application failures; never rewrite remote migration history.

After a runtime release, report the configured production and staging URLs, PR, exact merged SHA, production Worker version, CI/CodeQL results, migration state, smoke/canary/monitoring evidence, launch-control state, and honest remaining limitations. Derive environment URLs from repository configuration rather than duplicating them here. Never claim a test, merge, migration, deployment, or live version without exact evidence; monitor high-risk production releases against the exact version for at least 30 minutes.
