# GrihaGrid

**Edit a house in 2D. Explore it in 3D. Direct a camera tour.**

GrihaGrid is a concept-stage house studio for Indian households. A single
validated building model connects the editable floor plan, furnished browser
scene, camera tours and local Blender exports. Rooms, openings, furniture,
floors and stairs remain consistent as the user edits the plan or moves the
camera. A model is real spatial geometry, not a sequence of generated pictures.

The supporting planning tools still answer “Know what fits. Know what it costs.”
Estimates, reports, Change Study, comparison, sharing and account controls remain
available around the same private project history.

[![CI](https://github.com/prakhar267/grihagrid/actions/workflows/ci.yml/badge.svg)](https://github.com/prakhar267/grihagrid/actions/workflows/ci.yml)
[![Production smoke](https://github.com/prakhar267/grihagrid/actions/workflows/production-smoke.yml/badge.svg)](https://github.com/prakhar267/grihagrid/actions/workflows/production-smoke.yml)
[![Production backup](https://github.com/prakhar267/grihagrid/actions/workflows/production-backup.yml/badge.svg)](https://github.com/prakhar267/grihagrid/actions/workflows/production-backup.yml)

## Start with the house

The primary journey in this checkout is:

1. Open `/` or `/explore` to enter the labelled demonstration house.
2. Inspect **2D Plan**, select a floor, and edit rooms, walls, openings or furniture.
   Drawing import proposes geometry locally and requires review and scale calibration.
3. Use **3D Explore** to orbit, highlight a room, enter it or walk through connected spaces.
4. Build a **Camera Tour**, adjust its stops and timing, pause to look around and resume.
   Manual direction and “Tour all rooms” work without an AI provider.
5. Choose **New house** at `/houses/new` to create an owned project, then keep
   accepted model, tour and viewpoint revisions. **Your houses** on `/dashboard`
   opens the private studio at `/projects/:id/spatial`; **Project details** remains
   a secondary action.
6. Pair the **Render/Export** panel with local Blender to create previews, an editable
   `.blend`, GLB, manifest and MP4. The app shows the actual render and recovery state.

The public demonstration remains in the current tab or downloaded files; it is
not an automatically saved personal house. A new-house flow establishes private
project ownership and a labelled starting concept. It does not pretend an estimate
brief is a professionally designed floor plan.

Secondary routes retain `/start` for the full planning brief, `/estimate` for
the editable calculator or a valid shared scenario, `/projects/:id` for planning history, `/report/:id` for
reports, and comparison/handoff routes. Existing links and saved records keep
working. A malformed shared-estimate query stays invalid rather than becoming
a valid calculator result. Pricing is not the primary entry point, and paid
capabilities remain closed.

## Scope of this change

The current product cleanup is **local implementation and review only**. It does
not authorize deployment, remote migrations, paid infrastructure, new provider
accounts, or activation of payments/private uploads. Historical releases already
include the spatial studio; this checkout's navigation and documentation changes
must not be described as deployed without separate exact-version evidence.

The existing hosted application is at
[the production workers.dev address](https://grihagrid.prakhargupta267.workers.dev/explore).
That link is a deployed baseline, not proof that the current branch is live.
Release evidence remains in [launch readiness](docs/launch-readiness.md),
[free-production readiness](docs/free-production-readiness.md) and
[production operations](docs/production-operations.md).

## Spatial capabilities and boundaries

| Area | Current implementation | Boundary |
| --- | --- | --- |
| Drawing → 2D | Browser-local PNG/JPEG/WebP/SVG/PDF review, line recognition, OCR and calibration | Recognition proposes a draft; the user corrects it before acceptance |
| Shared geometry | Versioned millimetre model, polygon rooms, independent walls/openings/furniture, up to four floors and stairs | Invalid geometry or disconnected walking space is rejected |
| 3D exploration | Three.js/React Three Fiber, room hover/focus, overview, walking, cutaways and quality controls | Cutaways change presentation, not the exported building |
| Camera tours | Checked paths, shot subjects, stop order, timing, pause/resume, manual takeover and saved viewpoints | Layout changes mark affected tours stale until regenerated/reviewed |
| Optional Gemini direction | Server-side structured intent from existing room/object references | AI does not invent trusted coordinates or executable scripts; local tours remain available |
| Private house history | Owner-scoped accepted model, tour and camera-library revisions in D1 | Unsaved public demo changes are not cloud persistence; stale writes conflict |
| Blender rendering | Paired loopback service, Cycles previews/film, progress, cancellation and recovery | Requires local Blender/FFmpeg and sufficient resources; no hosted GPU service |
| Account and planning tools | Existing estimates, reports, Change Study, comparisons, sharing and account lifecycle | Retained supporting workflows, not replaced by the studio |
| Private server uploads, R2 and payments | Existing fail-closed implementations and controls | Browser-local import does not activate server storage or checkout |
| Email recovery and verification | Configuration-gated | Unavailable without the required sender setup |

A furnished concept is not a construction drawing, structural assessment,
municipal approval, contractor quotation or professional endorsement. Materials
and lighting are illustrative. Browser rendering and Blender share geometry and
camera motion; they do not produce identical shaders or lighting.

## Architecture

```text
React / Vite browser
  ├─ SVG 2D editor and local drawing review
  ├─ shared validated millimetre model + deterministic routes/tours
  └─ lazy Three.js / React Three Fiber 3D workspace
       │ same-origin API                  │ explicit local pairing
       ▼                                  ▼
Cloudflare Worker                    Loopback Node render service
  auth, validation, source fences      fixed Blender Python modules
  accepted revisions, AI intent        scene → cameras → render / resume
       │                 │               │
       ▼                 ▼               ▼
      D1                KV          private local .blend / GLB / MP4
  owned history     admission brakes
       │
       └─ optional server-side Gemini structured intent
```

The Worker does not run Blender. There is no implemented Cloudflare Queue or
cloud PDF/render pipeline. The render service has its own bounded local job
queue. R2, payments and email remain separate gated boundaries.

Read [technical architecture](docs/architecture.md),
[spatial schema and camera contracts](docs/spatial-workspace.md) and
[Blender operation](docs/spatial-blender.md). The full [documentation index](docs/README.md)
separates current product guides, supporting contracts and dated evidence.

## Run locally

Use Node.js 22 and npm. The sample 2D/3D experience needs no paid service or AI key.
For private project persistence, start the local Worker with an isolated database:

```sh
npm ci
npx wrangler d1 migrations apply DB --local --persist-to .wrangler/spatial-dev
npx wrangler dev --local --port 8790 --ip 127.0.0.1 \
  --persist-to .wrangler/spatial-dev \
  --var APP_ENV:test --var APP_ORIGIN:http://127.0.0.1:5277
```

In another terminal, start Vite:

```sh
npm run dev -- --host 127.0.0.1 --port 5277
```

Open `http://127.0.0.1:5277/`. Vite proxies `/api` to the local Worker on port
8790. Test mode permits an exact HTTP loopback origin; deployed environments
require HTTPS. Use fictional accounts and project details for local verification.

For local rendering, install Blender 4.5 LTS and FFmpeg, then start:

```sh
npm run spatial:service
```

The service binds `127.0.0.1:43127`. Pair through the app using the private code
file identified by the service. Restarting the service requires pairing again.
No pairing code or provider credential belongs in source, URLs, logs or public
assets. See [render setup and recovery](docs/spatial-blender.md) for exact
requirements, supported origins, local storage and output conventions.

## Verification

```sh
npm ci
npm run check
npm run check:migrations
npm run check:worker
npm run check:worker:staging
npm audit --audit-level=high
git diff --check
```

`check` builds the app, runs the serialized repository tests and validates
operations configuration. The Worker checks are dry runs, not deployments.
Focused browser scripts are `scripts/check-spatial-*.mjs`; use their documented
local fixtures and inspect the resulting evidence. Rendering is verified only
when actual artifacts have been produced and inspected.

[Spatial verification](docs/spatial-verification.md),
[performance measurements](docs/spatial-performance.md) and
[visual polish](docs/spatial-visual-polish.md) preserve dated results and their
limits. Physical iPhone and spoken VoiceOver testing remain explicitly deferred;
desktop touch emulation does not establish physical-phone performance. Earlier
live Gemini and film results are historical evidence, not fresh executions in
this documentation/navigation cleanup.

## Security and retained workflows

Private houses use the existing ownership, same-origin, CSRF, strict-schema,
idempotency and optimistic-concurrency boundaries. Accepted model revisions do
not mutate older reports or purchased snapshots. Tours and viewpoints retain
their own revisions and source references. Account export/deletion includes
spatial history under the existing retention and safety rules.

The Gemini direction boundary receives validated aliases and safe intent, not
raw drawings, account details or arbitrary project prose. Uploaded documents
are decoded locally. Renderer pairing is a separate, temporary capability for
this computer; it does not grant another user's cloud-project access.

Read [backend contracts](docs/backend-api.md), [account security](docs/account-security.md),
[account lifecycle](docs/account-lifecycle.md) and [operations](docs/operations-runbook.md)
before changing those boundaries. Existing release, backup and recovery records
remain intact. Operational gaps must be read from their dated evidence, not
inferred as solved from a passing local build.

## Repository structure

```text
src/spatial/           shared model, SVG editor, Three.js scene and camera UI
src/                   application shell, account and retained planning/report flows
scripts/spatial/       local renderer, job service and reusable Blender Python
worker/                same-origin Cloudflare API
migrations/            forward-only D1 schema and immutable-history constraints
tests/                 geometry, API, ownership, recovery and browser contracts
docs/                  current product guides, supporting contracts and evidence
scripts/               build, local QA, smoke, backup and release tooling
ops/backup-vault/      prepared manual private-receiver template; execution gated
.github/workflows/     existing CI, protected release, smoke and backup automation
```

Generated render outputs, private local jobs, backups, credentials and QA captures
are not product source and are not cleanup targets for this change.
