# GrihaGrid

India-first concept-stage home-planning SaaS. GrihaGrid turns a plot brief into a city-adjusted construction range, a private saved project, a deterministic feasibility report, an optional Gemini-assisted planning brief, and Decision Compare: a versioned side-by-side choice between exactly two home briefs.

Production: <https://grihagrid.prakhargupta267.workers.dev>

The public site and free planning journey are live. The ₹999 Decision Compare checkout is intentionally fail-closed until the dated paid-launch gates in `docs/launch-readiness.md` are satisfied; the working comparison and public sample remain available without payment.

## Local development

```bash
npm install
npx wrangler d1 migrations apply grihagrid-db --local
npx wrangler dev --local --port 8790 --ip 127.0.0.1 --var APP_ORIGIN:http://127.0.0.1:5173
npm run dev
```

The Vite frontend proxies `/api` to the local Worker on port 8790.

## Checks

```bash
npm run check:migrations
npm run check
npm run check:worker
npm run check:worker:staging
npm audit --audit-level=high
```

`check:migrations` applies every migration, in order, to a fresh temporary local
D1 database. The Worker checks bundle the production and isolated staging
targets without deploying or accessing remote data. `npm run check` also runs
the real local workerd/D1 Decision Compare journey.

## Continuous integration

GitHub Actions runs the locked install, fresh-database migration check,
production build, complete Node test suite, Worker dry run, and dependency
audit for every pull request and every push to `main`. The workflow is
read-only and contains no production credentials or deployment step. Protect
`main` by requiring the `Build, test, and validate` check before merging.

## Cloudflare and commerce

The deployment target is a Cloudflare Worker with static assets, D1 for application and immutable purchase records, KV for abuse controls, version metadata for release correlation, and a daily cleanup cron. Production and staging use separate Workers, D1 databases, KV namespaces, origins, and paid kill switches. Apply all D1 migrations, configure the bindings and secrets documented in `docs/backend-api.md` and `docs/payments.md`, run the release gates, then deploy through the runbook.

The public calculator, authentication, private projects, deterministic report, working Decision Compare, and dashboard work without payment-provider secrets. The optional AI brief uses a server-only `GEMINI_API_KEY`, sends only an allowlisted sanitized planning record, and fails closed behind atomic D1 spend limits and a per-project generation lease; see `docs/gemini-ai.md`. Decision Compare needs no upload storage. R2-backed uploads remain unavailable until R2 is activated. Live checkout remains closed until Razorpay live-mode/KYC and webhook reconciliation, receipts/tax/refund operations, customer recovery/deletion, monitoring, and rollback evidence are all proven.

See `docs/product-blueprint.md` for the product specification and `docs/operations-runbook.md` for the launch/rollback checklist.

## Important product boundary

Reports are concept-stage planning aids, not construction, municipal-sanction, architectural, structural, geotechnical, tax or legal advice. A licensed local professional must validate all decisions before construction.
