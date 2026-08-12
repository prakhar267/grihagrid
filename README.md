# GrihaGrid

India-first AI home-planning SaaS. GrihaGrid turns a plot brief into a feasibility score, city-adjusted construction range, saved project, planning report and optional architect-review workflow.

## Local development

```bash
npm install
npm run dev
```

## Checks

```bash
npm run check
npm run build
npm run test:sites
```

## Cloudflare

The deployment target is a Cloudflare Worker with static assets, D1 for application records, R2 for private project files, KV for rate-limit/idempotency state, and a daily cleanup cron. Run `npm run build`, provision bindings, apply `migrations/0001_initial.sql`, configure secrets from `.dev.vars.example`, and deploy with `npm run deploy`.

The public calculator works without secrets. Email delivery and payments remain disabled until provider credentials and legally reviewed policies are configured.

## Important product boundary

Reports are concept-stage planning aids, not construction, municipal-sanction, architectural, structural, geotechnical, tax or legal advice. A licensed local professional must validate all decisions before construction.
