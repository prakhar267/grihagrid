# GrihaGrid

India-first concept-stage home-planning SaaS. GrihaGrid turns a plot brief into a shareable, freshly recalculated city-adjusted construction range, a private saved project, a deterministic planning report with version-bound structured feedback and selective professional handoff, an optional Gemini-assisted planning brief, and Decision Compare: a versioned side-by-side choice between exactly two home briefs.

Production: <https://grihagrid.prakhargupta267.workers.dev>

The public site and free planning journey are live. The ₹999 Decision Compare checkout is intentionally fail-closed until the dated paid-launch gates in `docs/launch-readiness.md` are satisfied; the working comparison and public sample remain available without payment.

## Local development

```bash
npm install
npx wrangler d1 migrations apply grihagrid-db --local
npx wrangler dev --local --port 8790 --ip 127.0.0.1 --var APP_ENV:test --var APP_ORIGIN:http://127.0.0.1:5173
npm run dev
```

The Vite frontend proxies `/api` to the local Worker on port 8790. Only the
`test` environment accepts an HTTP loopback `APP_ORIGIN`, which keeps bearer
handoff links testable locally without relaxing staging or production HTTPS.

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
audit for every pull request and every push to `main`. CI remains read-only.
After an in-repository `main` push passes CI, `.github/workflows/deploy.yml`
independently requires successful exact-SHA CodeQL and a merged squash PR,
then uses protected `staging` and `production` environments to migrate, deploy,
smoke, run an authenticated canary, and record the serving Worker version.
Production follows staging and includes a 30-minute exact-version observation.
Documentation-only merges are classified and skipped. Deployment runs queue in
full, staging is restricted to protected branches, and production adds a
five-minute environment hold before it reconfirms the exact staging version.
Build and test work runs without environment secrets; the resulting exact-SHA
bundle is transferred to fresh privileged runners, which install the pinned
Wrangler version without executing candidate install hooks. The artifact is
restored outside the checkout, then replaces any candidate-controlled `dist`
tree before deploy.

Each deployment environment stores its own `CLOUDFLARE_API_TOKEN`,
`CLOUDFLARE_ACCOUNT_ID`, `D1_BACKUP_PASSPHRASE`,
`GRIHAGRID_CANARY_EMAIL`, and `GRIHAGRID_CANARY_PASSWORD` as encrypted GitHub
environment secrets. Cloudflare tokens are account-scoped service credentials
limited to Worker scripts, D1, KV reads needed for bindings, and Worker tailing;
they never include R2, payment-provider, or Gemini credentials. A future
pending migration cannot run until the workflow has made and encrypted a
mode-0600 export, authenticated AES-256-GCM encryption, a successful decrypt
check, and recorded checksums, Time Travel bookmark, and prior Worker version.
Only ciphertext and its recovery manifest enter the short-retention backup
artifact; the manifest also records a non-secret recovery-key version. Raw SQL
and raw Worker-tail events never enter an artifact.
Every migration after the reviewed `0012` baseline is also checked on every CI
and deploy run by a comment-aware forward-only SQL policy, so an earlier failed
release cannot leave an unsafe migration queued for a later release.

## Cloudflare and commerce

The deployment target is a Cloudflare Worker with static assets, D1 for application and immutable purchase records, KV for abuse controls, version metadata for release correlation, and a daily cleanup cron. Production and staging use separate Workers, D1 databases, KV namespaces, origins, and paid kill switches. Configure the bindings and secrets documented in `docs/backend-api.md` and `docs/payments.md`; normal releases then flow through the protected GitHub deployment workflow, with the runbook commands retained for verified break-glass recovery.

The public calculator, authentication, private projects, deterministic report, structured Brief Check feedback, working Decision Compare, and dashboard work without payment-provider secrets. Registration accepts only its documented email/password/optional-name fields, and login accepts exactly email plus password. Login combines a fail-closed 12-attempt per-IP KV perimeter with a `user_id`-only D1 fence that reserves at most 12 password checks in one fixed, non-sliding 15-minute account window before PBKDF2. Unknown, wrong-password, deleted, malformed-record, short/long-password and account-fenced credentials each perform one real-or-dummy derivation and return the same generic 401; an exact successful session transaction or password rotation clears the fence. Authenticated customers can review the current session plus at most 20 other current-authentication, unexpired sessions using only start/expiry times and a `hasMore` signal—never IDs, device, browser, IP, location or last-active data. Password-confirmed bulk revocation atomically advances only the authentication generation/revision, removes all old sessions and creates one replacement while preserving the password, `password_changed_at` and login-attempt fence. The control remains useful when only the current row is visible because a copied bearer cannot be identified separately; anyone who still knows the unchanged password may sign in again after the boundary. Password rotation remains the stronger response to suspected credential disclosure. Important-security-event notifications and email-based recovery are still unavailable, so ID-06 remains partial; registration still exposes `email_in_use`, and targeted 15-minute account lockout remains a known risk. See `docs/account-security.md`. The calculator is server-authoritative, validates and reconciles the exact public tuple, exposes its published calculation rule and current-market calibration limitation, omits account credentials, and never supplies a trusted estimate to project creation; see `docs/public-estimator.md`. Feedback is a separate owner-scoped record on one immutable report revision, contains no free text, and never rewrites report bytes; see `docs/report-feedback.md`. The optional AI brief uses a server-only `GEMINI_API_KEY`, sends only an allowlisted sanitized planning record, and fails closed behind atomic D1 spend limits and a per-project generation lease; see `docs/gemini-ai.md`. Decision Compare needs no upload storage. R2-backed uploads remain unavailable until R2 is activated. Live checkout remains closed until Razorpay live-mode/KYC and webhook reconciliation, receipts/tax/refund operations, customer recovery/deletion, monitoring, and rollback evidence are all proven.

Professional Handoff creates a revocable, expiring bearer link to only the
owner-selected sections of one immutable schema-v2 report. It exposes no account
or project workspace, never represents professional approval, and fails closed
behind a dynamic D1 operations switch plus a keyed abuse-control secret; see
`docs/report-handoff.md`.

Estimator share links contain only version plus the five public inputs and
always request a fresh server calculation. They store no anonymous scenario,
displayed price, account identity, or bearer token.

The estimator-to-account journey also uses a stable, user-scoped project-create
idempotency key: a lost successful response replays the same canonical project
without a duplicate row or attribution increment, while conflicting key reuse is
rejected.

An anonymous visitor may keep one unfinished structured brief on the same
browser for up to seven days after the last edit. Recovery is explicit and
value-free until the visitor chooses Resume; Save & exit and Discard are
separate controls. The full allowlisted brief lives only in one versioned local
browser envelope (or a same-tab memory fallback)—never a URL, cookie, navigation
history, session storage, analytics event, or anonymous API. Authentication
navigation carries only a continuation marker, opaque project/write identities,
revision, and bounded source marker; it carries no brief value. Dedicated file,
credential, estimate, report, and server-response fields are excluded; the
user-entered project name remains part of the browser copy. Shared-link
attribution is kept separately as one expiry- and retry-key-bound source-only
record so the existing v1 draft remains safe to read after an asset rollback;
that record contains no scenario or additional browser identity. Project creation
remains the authenticated, CSRF-protected Worker boundary and reuses the
original account-scoped key; see `docs/anonymous-brief-resume.md`.

See `docs/product-blueprint.md` for the product specification and `docs/operations-runbook.md` for the launch/rollback checklist.
The fail-closed schema snapshot, single-read healthy-path budget, and exact-version latency
validation are defined in `docs/readiness-performance.md`.

## Important product boundary

Reports are concept-stage planning aids, not construction, municipal-sanction, architectural, structural, geotechnical, tax or legal advice. A licensed local professional must validate all decisions before construction.
