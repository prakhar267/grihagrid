# Local render studio

The app can submit a validated house, camera tour and current saved viewpoints
to a paired renderer on this computer, show job progress and preview images,
cancel or resume work, and play/download the finished MP4, GLB and editable
Blender scene. Blender and FFmpeg run locally; the Cloudflare Worker does not
run either program.
No provider account, paid rendering service, R2 bucket or upload is involved.

## Start and pair once

Install Blender 4.5 LTS and FFmpeg. From the project checkout, start:

```sh
npm run spatial:service
```

The service listens only at `http://127.0.0.1:43127`. Its terminal prints the
path of a private pairing-code file, never the code itself. Open that file
and enter its code in the app's Local render studio. Keep the service running.
Then use **Render previews** or **Render 1080p film** in the app; subsequent
renders do not require individual terminal commands.

The default app origins are explicit loopback origins on ports 5277, 5173
and 4173. An operator can set `GRIHAGRID_RENDER_ORIGINS` to a comma-separated
list of exact HTTPS or loopback origins before starting the service. This
is an origin allowlist, not a wildcard. The app CSP must independently allow
`http://127.0.0.1:43127` in `connect-src` and fetched blob media in `img-src`
and `media-src`. Some browsers require their local-network permission too.

The app's setup panel includes its current exact origin in the service command,
so the deployed HTTPS studio can pair as well as the local development app.
When using several app addresses, list each exact origin, separated by commas,
in the same environment variable before starting the renderer. Changing the
address or restarting the service requires pairing again.

Browser and native scenes use restrained oak, seamless mineral stone, linen
and warm plaster. Blender procedural textures use metre-based object coordinates
with subtle relief and roughness variation; mesh scale is applied before shading
so texture detail stays consistent across different furniture and room sizes.
Warm directional daylight, cooler ambient light and subdued ceiling fill retain
depth. These are concept materials, not measured specifications or scanned assets.

The default data directory is `~/.local/share/grihagrid/render-service`.
Directories are mode 0700; pairing, immutable input and job metadata files
are mode 0600. Pairing creates an origin-bound, eight-hour bearer session.
The app keeps it only in memory, sends it in an Authorization header, and
fetches media into blob URLs. No credential is placed in a URL, cookie,
localStorage, public asset directory, repository file or service log.
Restarting the service rotates the pairing code and invalidates browser
sessions; rendering recovery itself does not require the browser to pair again.
A paired browser controls this computer's local render jobs. This local
capability is separate from cloud project ownership or billing entitlements.

## Rendering and recovery

App jobs always use Cycles, with 4/8/16/32/64 permitted samples (the UI offers
8/16/32/64), Metal when available, denoising, and a native 1920×1080, 30 fps
film. Tour length is bounded to 60 seconds. The UI displays the actual engine
and samples; higher samples cost more local time. Six small preview frames
are produced before a film. The film button still creates a full native
resolution frame sequence, not an upscaled preview.

One job runs at a time; at most four jobs may be active/queued and twenty
records retained. Remove completed or cancelled jobs from the panel when
finished with their local artifacts. Removal is limited to that generated
job directory. Fresh submissions and both manual/automatic recovery apply the same dependency
and disk admission checks. Disk admission reserves queued work and accounts for uncompressed frame size plus
512 MiB headroom. Each Blender subprocess has a two-hour limit, four CPU
threads and a 512 MiB Node controller; FFmpeg has two threads and five minutes.
Blender GPU memory itself is constrained by the validated scene budget and
available hardware, not a claimed operating-system GPU-memory quota.

Each request gets a UUID directory and immutable request JSON. Every new
construction attempt has a separate `attempt-N` directory. Initial scene,
config and job writes are exclusive, so racing jobs cannot replace each
other's inputs. The saved blend, serialized scene and render recipe have
SHA-256 provenance recorded before rendering. Resume refuses changed source,
scene or settings. It loads only the generated saved scene, checks frame PNG
dimensions, every chunk checksum and complete termination, preserves complete frames and renders missing/partial
frames before re-encoding the video. A cancelled job stays cancelled until
**Resume render** is selected.

On service restart, previously running and queued jobs recover automatically
in creation order. A graceful service shutdown also records this recovery
intent. Saved frames use the same verified scene, camera keys and engine.
If construction stopped before a verifiable saved scene existed, recovery
creates a separate attempt, with at most three automatic construction attempts.
Previously failed jobs and explicitly cancelled/cancelling jobs do not
restart automatically. Tampered provenance stops recovery and asks for a new
job. The UI identifies automatic recovery and reports connection loss as a
last-known status; it does not claim a disconnected render has stopped.

The service launches a fixed Node worker and repository Python entrypoints
with argument arrays and no shell. Blender auto-execution is disabled.
Browser JSON cannot select an executable, script, filesystem path or engine.
Worker IPC disconnection aborts its child renderer, preventing orphan work
when the service exits. Progress is available through authenticated job reads
and authenticated SSE; the panel polls while connected. Revoking a session
also closes its progress streams.

## HTTP and input boundaries

All requests require an exact loopback Host and allowed Origin. Jobs,
artifacts, cancellation and removal also require the matching bearer session.
Pairing attempts, sessions, progress streams, connections and submissions are
bounded. Unsupported fields and query parameters are rejected. Content must
be strict UTF-8 JSON with a two-MiB body limit and valid shared model/tour
references. CLI inputs use one opened regular-file descriptor, a bounded
MAX+1 read loop, and a `finally` close, avoiding a path-stat/read race.

The app request is `{model, tour, viewpoints, settings}`; CLI scene bundles use
`{model, tour, viewpoints}`. Omitting `viewpoints` preserves the earlier
model/tour workflow. The shared `src/spatial/viewpoints.js` validator checks up
to 40 named poses before creating outputs or starting Blender. References must
match the building and current concept revision, with a valid optional floor,
distinct finite position/target coordinates and vertical FOV of 20–110 degrees.
Duplicate IDs, unsupported fields and stale or foreign cameras fail validation.
The app includes only current-concept views and reports older views explicitly;
**Download camera library** preserves every stored pose separately.

Artifact endpoints accept only fixed generated filenames, never arbitrary
paths. Static symlinked job, attempt and preview directories are rejected. They open a regular file without following a final symlink, bound the
stream to its opened size, enforce a 256 MiB download limit, and disable
caching. Preview images may be viewed while rendering; final artifacts are
served only after the whole job completes. Private job records use serialized,
atomic replacement. A second process that cannot bind the service port cannot
rotate the live pairing code or mutate the running service's job records.

## Shared geometry and camera architecture

`src/spatial/model.js` validates the building and generates the primitives used
by the 2D plan, Three.js viewer and Blender renderer. Schema v2 supports multiple
floors, simple irregular room polygons and stair apertures. Polygon slabs are
triangulated once in shared JavaScript; Python consumes the actual local
vertices and triangle indices, including holes. Stairs and railings use the
same generated boxes/cylinders as the browser. Python does not reconstruct
rooms from bounding rectangles or invent a separate floor plan.

Canonical coordinates are millimetres, X right, Y forward, Z up. Blender uses
the same axes in metres. glTF/browser coordinates are
`[x / 1000, z / 1000, -y / 1000]`; the exporter performs that conversion once.
Stable object, room, floor, stair, wall and opening identifiers, category and source revision
are carried into the GLB extras and manifest.

`src/spatial/tours.js` owns collision-aware routes, timing and sampled camera
poses. The runner imports it directly. `scene.py` builds geometry/materials and
floor-aware lights. `cameras.py` keys the sampled camera and fade transitions.
`render.py` builds, exports, verifies and renders; `resume.py` renders only
missing frames of the unchanged saved scene. Vertical FOV is preserved through
Blender's vertical sensor convention. Linear per-frame keys avoid additional
Bezier overshoot; source cuts remain cuts and deliberate fades use a keyed
black compositor overlay.

Each supplied viewpoint also becomes an unanimated Blender camera named from
the saved label. `tour-camera` remains the active animated camera. Saved-camera
IDs use `viewpoint:<id>` to avoid geometry collisions. GLB extras preserve
`viewpointId`, full `viewpointName`, `buildingId`, `sourceRevision` and optional
`floorId`; the manifest retains the canonical record and actual Blender label.
The full label survives even when Blender truncates its display name. Their
canonical poses and vertical lenses are also exported to
GLB. The immutable job input and serialized scene retain these viewpoints, so
the existing provenance hashes cover the camera library used for that render.

After export, Blender reimports the GLB into an empty scene and checks mesh IDs,
room associations, world bounds within 1 mm, camera position and direction.
Node independently checks GLB room/floor/stair/wall/opening associations, browser-axis
translations, camera direction and vertical FOV, including every saved camera.
The saved `.blend` is reopened to check its static cameras and the active tour
at the first, middle and final keyed frames. These results are written to
`manifest.json`; a failed check fails the job. A resumable construction proof
is written only after both the exported GLB and reopened Blender scene pass.
Before film encoding, every expected frame must have complete native-1080p PNG
headers and termination; FFmpeg then decodes the sequence with errors treated
as fatal.

Cycles uses persistent scene data, GPU denoising where supported, bounded bounce
depth, physical light sources, subtle bevels, procedural wood/fabric/stone grain,
metal and glass materials. Authored furniture remains procedural concept
geometry; no external asset pack is silently downloaded. The editable blend
retains the procedural materials. GLB exports matching solid base colors and
material properties instead of pretending Blender's procedural node graphs are
portable browser shaders. Full roofs and physical lighting also differ from
browser presentation cutaways. Shared geometry and camera motion do not imply
pixel-identical shading or a photorealistic result.

## Optional CLI

The CLI remains useful for batch export or development:

```sh
npm run spatial:render -- --input /absolute/path/grihagrid-scene.json --mode preview
node scripts/spatial/run.mjs --mode scene --output output/spatial-new-scene
node scripts/spatial/run.mjs --mode film --duration 20 --samples 8 --timeout 7200
```

Inputs may be a plain building or the app's `{model,tour}` export. An embedded
tour keeps its own duration. Explicit output directories must be empty; an
omitted path creates a new `output/spatial-*` directory. Blender is found through
`BLENDER_BIN`, standard macOS locations, the optional user cache, or PATH; an
explicit CLI `--blender` path takes precedence. The CLI additionally supports
`--device cpu`, bounded durations up to 120 seconds and `--engine eevee` for
explicitly labeled drafts. App rendering does not expose the Eevee option.

Outputs include building/scene/config JSON, `house.blend`, `house.glb`,
`manifest.json`, `build-proof.json`, `job.json`, previews, and film PNGs/MP4.
No output belongs in a public web assets folder.

## Local verification, 14 September 2026

The official Blender 4.5.9 LTS ARM64 build was verified on this MacBook Air M4
with 16 GB RAM. The downloaded DMG SHA-256 matched
`e3a3d7aac381fb4e4d05197f99cd8899484d7e8bc4497c134066e6733f372238`.
Blender lives in the optional cache outside the repository.

The furnished v1 house exports 315 meshes. Earlier independent Blender and
Three.js checks preserved all IDs and room associations, with maximum bounds
error below 0.001 mm. The refined Cycles preview job completed in 11.7 seconds
at eight samples; six frames were inspected for coherent exterior, living,
gallery, bedroom and garden composition. Warm native-1080p Metal benchmarks
measured about 1.95 seconds at four samples and 3.15 seconds at eight samples;
full-film times vary with view complexity, thermal behavior and concurrent work.

The actual schema-v2 two-floor scene exported 148 meshes in
`output/spatial-v2-export-verified`. Blender round-trip maximum bounds error was
0.000477 mm; camera direction error was 0.000000246. All room/floor/stair GLB
associations passed. Three.js GLTFLoader then loaded all 148 meshes and 38
stair-associated components. A raycast hit the solid upper slab and returned
zero hits through its stair opening, confirming the exported aperture is real
geometry. That proof is recorded in `three-loader-proof.json` beside the GLB.

A further actual export in `output/spatial-v2-door-irregular-proof` contains
156 meshes, an L-shaped upper floor, the stair opening and an outward-opening
end-hinged door. It completed in 3.37 seconds, with maximum bounds error
0.000477 mm. Three.js raycasts confirmed the L-shaped missing corner and stair
aperture are empty. The exported door leaf has the intended 90-degree pose and
retains its floor, wall and opening IDs.

The named-camera checkpoint in
`output/spatial-saved-cameras-20260915/verification.json` verified an actual
two-floor Blender scene with 148 meshes, three saved cameras and the active
tour camera. Reopening `.blend` preserved all three static poses and checked
tour frames 1, 120 and 240. Blender GLB reimport and actual Three.js GLTFLoader
both preserved camera identities, source/floor associations and names,
including a long multilingual label. Maximum saved-camera position error in
the browser coordinates was 0.000611 mm, direction-vector error was below
0.00000031 and vertical-FOV error was below 0.0000062 degrees. The record
contains exact source and artifact hashes. An injected failure during reopened
camera verification left no resumable construction proof. This was a scene
export check; it did not rerender the completed film or establish the separate
browser UI journey or final repository gates.

The paired service's full Cycles demonstration completed through its real
authenticated HTTP job API. Job `3d52bc1d-156f-4de0-b290-e2e2f9afe56b` produced
600 native 1920×1080 frames at 30 fps with eight samples and Metal GPU rendering.
The H.264 film is 20.000 seconds and 7,580,848 bytes. The measured wall time was
3,001 seconds (50 minutes, 1 second), including 2,950.22 seconds in Blender.
Every source PNG passed native-dimension, complete-file and all-chunk checksum
checks; FFprobe independently decoded and counted all 600 video frames.
GLB verification preserved all 315 object associations, with maximum browser
position error 0.001224 mm and camera direction error below 0.000000042.

Review copies are in `output/spatial-cycles-film`: `tour.mp4`, `house.blend`,
`house.glb`, `manifest.json`, a native living-room still, a 20-view contact sheet
and `video-evidence.json`. All every-second views and the native still were
visually inspected. The exterior, living room, corridor, kitchen, bedroom and
garden remain coherent; lighting is soft and furnishings are procedural.
This is an inspected concept-visualization film, not a photorealistic result.
The original private render outputs and earlier Eevee film remain intact.

Real browser controls created preview job
`5d817235-319e-43ac-a260-52a59610f7a4`, then cancelled and resumed it. A subsequent
native Blender check cancelled it after its first completed PNG, resumed the
same saved scene, stopped the service process after two previews, and restarted
the service. Automatic recovery completed all six previews in the same attempt.
The first PNG's SHA-256 and modification time remained unchanged through both
recoveries. Authenticated preview bytes and the downloaded GLB were verified.
`output/spatial-cycles-film/native-recovery-evidence.json` records this actual
process recovery, alongside separate fixture-based failure and admission tests.

The earlier `output/spatial-demo-film/tour.mp4` remains intact: Eevee, H.264,
1920×1080, 600 frames, 30 fps, 20.000 seconds, 10,163,242 bytes. Its every-second
contact sheet was inspected. Its measured 758-second timeout/recovery run is
separate historical evidence, not the current Cycles film.

Focused tests cover byte/input limits, exclusive writes, literal subprocess
arguments, timeout, shared geometry, incorrect GLB axes/lenses, Host/Origin/auth
rejection, unsupported operations, bounded queue admission, cancellation,
provenance tampering, automatic recovery with unchanged saved frames, preserved
explicit cancellation, authenticated artifact access, symlink rejection,
revoked SSE sessions and duplicate startup protection. Run with:

```sh
node --test --test-concurrency=1 tests/spatial-blender.test.mjs tests/spatial-service.test.mjs tests/spatial-service-recovery.test.mjs
```

This is a functional paired local queue. Hosted render scheduling, multi-tenant
cloud artifact storage and GPU fleet operations are separate infrastructure.
R2, private uploads and paid checkout remain disabled.

## Preview recovery metadata — 26 September 2026

The go-live check found that a resumed preview recorded film dimensions in its
manifest. The customer outcome is accurate artifact metadata after recovery:
interrupt a preview, resume its verified scene, then compare the manifest with
the actual PNG headers. Preview output is 633×356 (33% resolution); film output
remains 1920×1080. Acceptance is a match between resumed preview metadata and
every preview PNG, with the original completed frame preserved byte-for-byte.
The KPI is zero dimension mismatches. Preserve geometry, camera provenance,
render quality, existing frames and the native-film validation contract.

A fresh native Cycles/Metal check interrupted a three-storey Jaipur preview
after its first completed frame, resumed it, and verified all six actual PNG
headers against the corrected manifest. The first frame's SHA-256 was unchanged;
all 652 geometry objects and the saved viewpoint passed the coordinate checks.
This is a real preview recovery check, not a newly rendered full film.
