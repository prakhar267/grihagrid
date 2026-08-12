# GrihaGrid

India-first concept-stage home-planning SaaS. GrihaGrid turns a plot brief into a city-adjusted construction range, a private saved project, a deterministic feasibility report, private site evidence, and an optional paid planning or architect-review workflow.

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
npm audit --audit-level=high
```

`check:migrations` applies every migration, in order, to a fresh temporary local
D1 database. `check:worker` performs a Cloudflare dry run against the built
assets and never deploys or accesses remote data.

## Continuous integration

GitHub Actions runs the locked install, fresh-database migration check,
production build, complete Node test suite, Worker dry run, and dependency
audit for every pull request and every push to `main`. The workflow is
read-only and contains no production credentials or deployment step. Protect
`main` by requiring the `Build, test, and validate` check before merging.

## Cloudflare

The deployment target is a Cloudflare Worker with static assets, D1 for application records, R2 for private project files, KV for rate-limit/idempotency state, and a daily cleanup cron. Apply all D1 migrations, configure the bindings and secrets documented in `docs/backend-api.md` and `docs/payments.md`, run `npm run check`, then deploy with `npm run deploy`.

The public calculator, authentication, private projects, deterministic report, and dashboard work without third-party provider secrets. R2 uploads remain unavailable until the Cloudflare account's R2 subscription and bucket are activated. Live checkout remains fail-closed until Razorpay keys and a signed webhook are configured. Email recovery and paid architect operations remain pre-launch work.

See `docs/product-blueprint.md` for the product specification and `docs/operations-runbook.md` for the launch/rollback checklist.

## Important product boundary

Reports are concept-stage planning aids, not construction, municipal-sanction, architectural, structural, geotechnical, tax or legal advice. A licensed local professional must validate all decisions before construction.
