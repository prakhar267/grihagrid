# GrihaGrid technical architecture

## Current system and change scope

The primary application is the editable house studio: one shared model feeds
SVG editing, interactive 3D exploration, camera tours and local Blender output.
The existing account, project, estimate, report, revision, comparison and sharing
services remain the foundation for ownership and supporting planning work.

This product-cleanup change is local and reviewable. It does not deploy the
application, migrate remote data or activate paid infrastructure. Earlier
protected releases and their evidence remain historical records; the current
branch must be verified separately.

```text
Browser: React / Vite
  ├─ local drawing import / PDF.js / Tesseract → reviewed draft
  ├─ SVG floor-plan editor
  ├─ shared millimetre building model, geometry validation and routes
  ├─ lazy Three.js / React Three Fiber scene and camera state
  └─ existing account / planning / report surfaces
       │ same-origin JSON                  │ paired loopback HTTP
       ▼                                   ▼
Cloudflare Worker                     Node local render service
  auth, ownership, CSRF, admission      bounded local jobs and progress
  source checks and immutable saves     fixed repository Python entrypoints
  deterministic planning/report APIs         │
  bounded optional Gemini intent             ▼
       │               │               Blender / FFmpeg processes
       ▼               ▼                scene, GLB, preview, MP4
      D1              KV                private local output directories
  owned revisions   perimeter brakes
```

There is no deployed Cloudflare Queue consumer, R2 PDF pipeline or hosted
Blender service in this architecture. The implemented queue belongs to the
local render service. Private server uploads/R2, email and payments are gated
integrations, not requirements for opening the demo or authoring a manual tour.

## Frontend and shared spatial model

- `src/App.jsx` owns navigation, authentication recovery and the retained routes.
  `/` and `/explore` are the studio entry points; `/houses/new` creates an owned
  house, `/dashboard` lists private houses, and `/projects/:id/spatial` opens
  an owned studio. Planning brief,
  estimates, project history, reports and sharing remain secondary routes.
  `/estimate` without a query opens the editable calculator; malformed shared
  queries retain the existing invalid-state boundary.
- `SpatialWorkspace.jsx` coordinates **2D Plan**, **3D Explore**, **Camera Tour**
  and **Render/Export**. `LayoutEditor.jsx` edits independently selected geometry;
  `WorldCanvas.jsx` renders it. The 3D, PDF and OCR modules are lazy-loaded.
- `model.js` dispatches backward-compatible v1 and v2 validation/geometry.
  Canonical dimensions are millimetres with X right, Y forward and Z up.
  Browser/glTF use `[x,z,-y]/1000`; Blender uses `[x,y,z]/1000`, with a single
  glTF export-axis conversion. Stable floor/room/wall/opening/object IDs survive
  meshes and exports. Rotations are radians about canonical Z.
- V2 supports polygon rooms, doors/windows, furniture, up to four floors and
  physical stairs. Schema bounds are additional to request-size limits.
  Self-intersections, overlap, invalid openings and unsupported references fail
  validation; a cloud save also requires walking connectivity.
- Drawing recognition and OCR run in the browser from same-origin bundled
  assets. Recognition proposes a draft with review and scale calibration.
  The source drawing is not sent through the Gemini brief API or a server
  upload endpoint. Browser-local import does not enable R2.
- Roof/wall cutaways affect presentation only. Seeds preserve exterior
  arrangements. Exported scenes retain complete source geometry.

The exact schema, import bounds and API shapes are in
[spatial-workspace.md](spatial-workspace.md). Browser performance, resource
budgets and measured devices are in [spatial-performance.md](spatial-performance.md).

## Camera and AI responsibilities

`navigation.js` and its v2 implementation calculate floor support, clearance,
connections and routes. `tours.js` resolves directed stops into checked paths
and timed camera samples. Overview, room focus, walking and tour playback share
a controller; manual takeover pauses playback until explicit resume. A room
jump is distinct from walking through a doorway. Smoothed paths are checked
along their full length, not only at endpoints.

Shot records bind room/floor/subject IDs, canonical path/target, duration,
vertical FOV, easing/transition and source signatures. A changed layout makes
affected shots stale; saved poses remain attributable to their original concept.
Tour and camera-library edits are versioned independently of the accepted model.

Gemini is optional structured intent. The browser parses room/subject/shot
preferences, and the Worker aliases identifiers and limits provider input to
safe vocabulary. It sends no raw drawing, unrestricted prompt, address,
coordinate or account record through the tour endpoint. Returned identifiers,
order, durations and shot types are validated; deterministic geometry computes
the actual camera path. No AI-produced Python or JavaScript is executed.
“Tour all rooms” and manual editing work when the provider is unavailable.

## Persistence and supporting services

D1 is authoritative for ownership and immutable history. Migrations 0022 and
0023 add `spatial_revisions`, `spatial_tour_revisions` and
`spatial_camera_revisions`. The Worker requires active ownership, same-origin
CSRF protection, strict JSON, idempotency and expected input/model/tour/camera
revisions. Read-only preview precedes accepted spatial changes; a source change
while a request runs produces a conflict. Archived projects stay read-only.

The public demo is tab-local or explicitly downloaded. Creating a private house
establishes a real owned project; sample geometry is labelled, never silently
presented as a generated response to a cost brief. Account export and guarded
deletion include spatial history. No navigation rewrite changes older project,
report, comparison or purchased artifact records.

The retained estimator recomputes reportable quantities server-side. Reports
are deterministic, version-bound records rendered by the app and printed by
the browser; there is no background PDF queue. Gemini planning briefs explain
an allowlisted deterministic snapshot and remain a separate API from camera
intent. D1 admission counters and expiring generation leases bound provider
work. KV supports abuse admission; it is not the ownership, money or entitlement
ledger. The optional anonymous planning brief keeps its existing explicit,
seven-day same-browser storage and guarded authentication handoff.

See [backend API](backend-api.md), [project history](project-home.md),
[Brief Check / Change Study](brief-check.md) and [Gemini planning briefs](gemini-ai.md)
for the preserved contracts.

## Local Blender boundary

The browser pairs explicitly with the service at `127.0.0.1:43127`. Exact
Host/Origin validation and an origin-bound temporary bearer protect jobs and
artifacts; the bearer stays in memory and request headers. Restarting the
service invalidates browser pairing. The browser never runs shell commands.

The Node service accepts validated scene/tour/viewpoint bundles and launches
fixed repository code with argument arrays. `scene.py` builds geometry,
materials and surroundings; `cameras.py` keys shared camera samples;
`render.py` exports and renders; `resume.py` completes verified missing frames.
Blender auto-execution is disabled. The model cannot select executable code
or filesystem paths.

Jobs have private isolated directories, dependency/disk admission, bounded
concurrency, progress, cancellation and recovery. Provenance binds the saved
scene, immutable input and render recipe. GLB round-trip and reopened Blender
camera checks protect units, IDs and orientation. Existing completed frames
are reused only after their integrity checks pass. Cycles and FFmpeg produce
the film locally. Browser solid/PBR materials and Blender procedural materials
are intentionally different visual implementations of the same scene.

See [spatial-blender.md](spatial-blender.md) for pairing, exact job limits,
recovery semantics, formats and inspected native export evidence.

## Security and privacy controls

- Session and CSRF tokens are random and stored as digests. Session cookies are
  `HttpOnly`, `Secure` and `SameSite=Lax`; the CSRF cookie is readable by the
  same-origin client and `SameSite=Strict`. Recovery/verification links are
  one-use and configuration-gated; magic-link login is not an implemented flow.
- Password changes require the current password, advance an account authentication
  generation plus opaque revision, and replace every earlier session atomically.
  A login verified against stale authentication state cannot insert a surviving
  session.
- Session review is a bounded, read-only projection of the current session plus
  at most the 20 newest other matching sessions. It includes only a current flag,
  start time, expiry time and top-level truncation signal; D1 session/account
  identifiers, UA/browser/device fingerprints, IP, location and last-active
  state never cross the API boundary.
- Password-confirmed bulk revocation uses the same generation/revision fence but
  performs a generation-only transition: conditionally bump user auth state,
  delete every existing session and insert one replacement in one D1 batch.
  It preserves the complete password record, `password_changed_at` and the
  login-attempt fence. A copied bearer therefore closes even when review shows
  only the current row, while the unchanged password may create a later login.
- Registration accepts only email/password/optional-name primitive fields;
  login accepts exactly primitive email/password fields. Unsupported or
  confused-type fields fail before account lookup.
- Login requires healthy KV for a fixed 12-attempt per-IP window, then reserves
  one of 12 fixed, non-sliding 15-minute D1 slots for a real `user_id` before
  PBKDF2. Unknown, wrong-password, deleted, malformed-record, invalid-password-
  length and account-fenced requests each perform one real-or-dummy derivation
  and return the same `401 invalid_credentials`.
- The D1 login fence stores only `user_id`, timestamps, count and limit—never an
  email, IP, password-derived value or free text. A generation/opaque-revision-
  fenced session insert and its fence clear commit in one batch; password
  rotation clears the fence through its exact replacement-session batch.
- Per-account D1 controls supplement per-IP abuse controls on password change,
  session bulk revocation, project creation, public shares and provider spend.
  Password change and session revocation share one five-check-per-account fixed
  15-minute admission boundary. Checkout abuse KV remains a brake rather than a
  money or entitlement ledger.
- Ordinary JSON request bodies are limited while their raw bytes stream: the
  Worker accepts at most 65,536 bytes, decodes UTF-8 fatally, and only then
  parses an object. A present `Content-Length` must be decimal and can reject
  early, but absent, zero, leading-zero, or understated values never replace
  actual byte counting. Oversize, framing, reader, and media failures cancel
  unread input best-effort before any post-admission domain work.
- Anonymous report and Family capabilities retain their smaller 512/1,536-byte
  envelopes and generic misses. Razorpay webhooks retain the exact bounded raw
  bytes for HMAC verification at 256 KiB before fatal UTF-8 JSON parsing.
- Static image type is verified by signature and structure, not extension;
  dimensions, exact termination, metadata stripping, and size/count limits are
  enforced before a ready D1 record is exposed.
- Strict CSP, HSTS, `X-Content-Type-Options`, `Referrer-Policy` and frame protections at the edge.
- Webhook signatures use constant-time comparison and a bounded replay window.
- Logs exclude request bodies, tokens, addresses, photos and provider payload secrets.
- Anonymous browser drafts have no dedicated fields for files, filenames,
  addresses, coordinates, account or project identifiers, credentials, sessions,
  estimates, reports, AI output, or server responses. The user-entered project
  name may itself contain identifying text; recovery copy names that boundary,
  browser-profile exposure, and early browser eviction. Discard targets only the
  exact named record.
- Authentication logs also exclude email, IP, account/fence identifiers,
  password shape and every password-derived value; monitoring is aggregate by
  templated route, bounded outcome/status, release and latency.
- Session-review and revocation monitoring likewise remains aggregate. It does
  not add device telemetry, persist a viewed session list, or emit a product
  event with session times. Verification and recovery mail stores only bounded
  delivery evidence and is unavailable without provider configuration.
- Gemini requests use a Worker secret, `store: false`, provider core-harm protection,
  adult consent, and sanitized inputs that exclude identity, project names,
  precise addresses, coordinates, payments, and uploads.
- Generated text is rejected unless it stays inside the advisory boundary; D1
  enforces per-user and platform spend ceilings, while KV remains a best-effort
  brake for authentication and checkout abuse.
- User deletion is password-confirmed and transactional for ordinary customer
  accounts. It refuses governed financial-retention and professional-offboarding
  cases rather than silently deleting required evidence.
- Registration's `email_in_use` response remains an enumeration surface. A
  known email can be deliberately fenced for the remainder of one fixed window,
  and an attacker can repeat that denial in later windows. The login fence does
  not claim to solve either risk.
- Dependency review and governed recovery exercises are operating requirements,
  not evidence that a remote restore has completed. See the dated operations record.

## Environments and release boundaries

Local development uses synthetic data and isolated local D1 state. Staging and
production have distinct Workers, D1 databases, KV namespaces, secrets and
origins. R2 is unbound while private uploads are closed; an environment diagram
must not imply active buckets. Provider credentials stay server-side.

Existing release procedures require reviewed exact-source CI/CodeQL, staging
validation before production, forward-only migrations, recovery evidence and
version-bound observation. Those procedures are retained; they are not invoked
by this local cleanup. See [operations-runbook.md](operations-runbook.md).

Authentication-generation changes, immutable project histories and completed
retention actions cannot be undone by rolling back a Worker. Domain/payment
activation, private storage and external-provider setup remain separately gated.

## Reliability targets and evidence

- Responsive 2D editing and matching 3D geometry; settled overview does not
  require continuous draws. Aim for about 30 fps on a representative mobile
  device, and report actual tested hardware instead of treating emulation as
  physical-phone evidence.
- No accepted camera path through an obstacle, no stale tour played/exported
  as current, and no lost accepted revision after a retry or conflict.
- Readiness release gates retain 20 serial exact-version samples with p95 below
  500 ms and all schema/capability checks intact. These bounded checks are not a
  sustained-load guarantee for every API or device.
- Local rendering reports real progress, timeouts and failure. Hardware, scene
  complexity and sample count determine duration; no cloud queue SLA is claimed.
- RPO 24 hours and RTO four hours remain operating objectives. Scheduled
  encrypted backups and isolated SQLite restore/schema checks do not establish
  a completed governed remote recovery drill.

[Production operations](production-operations.md) records the private-runner
billing gate, external-monitor activation and D1 capacity constraints with dates.
[Spatial verification](spatial-verification.md) preserves actual browser,
geometry, AI and native-render results. Physical iPhone and spoken VoiceOver
remain deferred. New infrastructure such as hosted rendering or durable queues
requires a separately reviewed need, design and authorization.
