# Spatial studio

## Customer outcome and scope

Import a drawing, check the recognized plan, edit its rooms and objects, accept
an immutable concept revision, explore the corresponding furnished 3D space,
direct a camera tour, save viewpoints and render locally through Blender.
The acceptance measure is completion without a geometry mismatch, collision,
lost edit or browser error. Device performance must identify the actual device;
a desktop touch viewport is not a physical-phone benchmark.

`/explore` is a labelled public demonstration. Its model and cameras remain in
the tab or downloaded JSON. `/projects/:id/spatial` persists the owner's accepted
model, tour and camera library. An empty private studio starts visibly from a
sample; the estimate brief is not silently converted into invented architecture.

The studio retains Architectural Monograph typography and ivory/ink/copper
colors. Accepted changes require Change Study. Estimates, purchased reports,
private server uploads, R2 and payment activation controls keep their existing
behavior. This implementation is local and reviewable; deployment is outside
this task.

## Architecture and data flow

1. `DrawingImport.jsx` decodes PNG/JPEG/WebP/SVG or a selected PDF page locally.
   SVG active/external content is removed before rasterization. PDF.js renders
   without evaluation or XFA. Files are bounded to 25 MB and raster analysis to
   1,100 pixels along the longest edge.
2. `drawing-recognition.js` detects orthogonal ink strokes, plausible doorway
   gaps and enclosed polygons. This is real pixel analysis; blank images do not
   return the demonstration house. Confidence represents pixel support, not
   architectural accuracy. Diagonal/ambiguous strokes need correction or
   explicit manual tracing. Recognition does not promise survey accuracy.
3. Optional Tesseract OCR runs in a browser worker using same-origin, pinned
   English language data. It proposes room labels and dimension candidates.
   The user chooses two reference points, supplies a known distance and reviews
   rooms, openings and construction assumptions before creating geometry.
4. `LayoutEditor.jsx` edits that shared model using `editor-ops.js`: room
   polygons and shared vertices, walls, doors/windows, furniture, floors and
   stairs. It includes numeric correction, snapping, drag/nudge, undo/redo and
   object dimensions/material color. Invalid operations report a reason.
5. React/SVG and Three.js/React Three Fiber consume the same validated model.
   `model.js` dispatches to backward-compatible v1 or v2 implementations;
   `navigation.js` and `tours.js` calculate checked routes and camera samples.
6. The existing Worker authenticates and validates private revisions in D1.
   Gemini receives bounded anonymous intent only. A separately paired loopback
   Node service runs reusable Blender Python in a child process, keeps durable
   local jobs and returns progress and authenticated artifacts to the browser.

The scene bundle is `{model, tour, viewpoints}`. No generated Python or
JavaScript from an AI response is executed. Browser-local recognition is
separate from the deliberately disabled private server-upload product.

## Shared geometry and coordinate conventions

Canonical coordinates are millimetres, XY ground, Z up. Browser/glTF coordinates
are `[x,z,-y]/1000`; Blender uses `[x,y,z]/1000` and its glTF exporter performs
axis conversion. Object rotations are radians about canonical Z. Stable room,
floor, stair and object IDs accompany generated meshes.

Schema v1 remains readable, preserving the original rectangular single-floor
demonstration. Schema v2 supports up to four floors, 48 simple polygon rooms,
256 walls, 512 furniture records and eight stairs. Unknown fields, invalid
references, self-intersections, overlapping rooms, invalid openings and
unsupported geometry fail validation. Geometry validity and complete walking
connectivity are separately checked; the private save requires both.

| Record | Fields and convention |
| --- | --- |
| Building | `schemaVersion`, `id`, `name`, `revision`, `seed`, `units`, `axes`, `bounds`, collections below |
| Floor | `id`, `name`, absolute `elevation`, clear `height` |
| Room | `id`, `name`, `floorId`, arbitrary simple `polygon`, `color`, `exterior` |
| Wall | `id`, `floorId`, XY `start`/`end`, `roomIds`, `height`, `thickness`, nested `openings` |
| Opening | `id`, `kind`, wall-distance `offset`, `width`, `sill`, `height`, door `open`, `hinge` (`start`/`end`) and `swing` (`1`/`-1`) |
| Furniture | `id`, `roomId`, `floorId`, procedural `kind`, `position`, `size`, `rotation`, `color`; position Z is relative to the floor |
| Stair | `id`, `name`, `fromFloorId`, `toFloorId`, XY `start`/`end`, `width`, `steps`, two supporting `roomIds` |
| Exterior | `groundColor`, `skyColor`, canonical `sun` position; named planting objects |

V2 slab meshes use triangulated room polygons, including real holes in the
upper floor and lower ceiling around stairs. Mesh primitive vertices are local
millimetres about `position`; `indices` are triangles. Furniture and stairs must
fit their complete footprints inside supporting rooms, including concave
boundaries. V2 door leaves use the same hinge/swing footprint in rendering and collision,
including when fully open. Physical treads and continuous supported walking surfaces share
stair endpoints/elevations. Ground-plane collision alone is insufficient.

Overall v2 scaling includes every room footprint, stairs and openings and
preserves floor elevations. Per-object editing is independent of scaling.
Presentation cutaways do not delete architecture from exports. Environments
and procedural material recipes remain deterministic from the saved model.

## Camera behavior

Overview supports orbit, pan, zoom and floor isolation. Room selection fades to
an accessible computed viewpoint; hover highlights without moving the camera.
WASD/arrows and labelled touch controls walk with a 220 mm clearance radius.
Configurable eye height is 1.50–1.80 m in the UI. Floors, stair ascent/descent,
wall openings, closed doors, glass and furniture constrain movement.

Tour paths traverse a checked navigation grid with doorway and stair links.
Line-of-sight smoothing is clearance checked. Smoothstep easing changes
progress along the checked polyline, so an unconstrained spline cannot overshoot
through a wall. Aerial shots use separate clearance and explicit transitions
into interiors. Pause, manual takeover, explicit resume, restart, scrubbing,
speed changes, stop order and shot timing use one camera controller.

Tours preserve legacy v1 input and add v2 `eyeHeight`, `shotPreferences`, floor
and subject references, and per-shot source signatures. Preferences specify an
existing room and optional object, `reveal|orbit|hold|walk`, `slow|normal|fast`
pace and optional fixed duration. One directed subject per room is supported.
Insufficient clearance for a reveal/orbit returns an actionable error.

A shot stores ID, kind, room/floor/subject references, canonical 3D path, target,
start time, duration, vertical FOV, transition and geometry source. Continuous
moves must join; cuts and fades are explicit. Changes invalidate affected
signatures even if a draft retains the same revision number. Rebuild and review
are required before playback/export of a stale or unaccepted layout.

Saved camera records contain `id`, `name`, `buildingId`, `sourceRevision`,
optional `floorId`, `position`, `target`, and `fov`. A private library revision
contains up to 40 views. Older poses can be retained, renamed or removed; they
cannot be restored into an incompatible concept. Camera rename/delete drafts
survive tour saves and retain their original concurrency fence.

## Private API and AI boundary

Migrations `0022_spatial_workspace.sql` and `0023_spatial_camera_library.sql`
create immutable model, tour and camera-library revisions. All reference an
exact accepted brief/model source. Existing purchased snapshots stay immutable.

| Route | Behavior |
| --- | --- |
| GET `/api/projects/:id/spatial` | Latest concept, tour, camera library, source state and history |
| POST `/api/projects/:id/spatial/preview` | Read-only Change Study |
| POST `/api/projects/:id/spatial` | Accepted concept revision |
| POST `/api/projects/:id/spatial/tour` | Separate validated tour revision |
| POST `/api/projects/:id/spatial/viewpoints` | Separate private camera-library revision |
| POST `/api/projects/:id/spatial/tour-intent` | Validated Gemini shot direction |

Writes require active ownership, trusted origin, CSRF, strict schema, request
limits and SQL compare-and-swap. Camera writes add `expectedCameraRevision` to
`expectedInputRevision` and `expectedSpatialRevision`. Idempotency keys preserve
retries. Archived projects are read-only. Other owners cannot read/write any
part of the library. Explicit project deletion follows existing cascade rules.
Account downloads include the owner's complete spatial layout, tour and camera
history with explicit public fields; persistence request keys and hashes are
excluded. Account deletion cascades through only that owner's spatial rows.
Cloud requests retain the existing 64 KiB JSON envelope and 48,000-character
serialized-model budget; the schema's object-count limits are additional
bounds, not a promise that every maximum can be combined into one saved model.

Local language parsing matches rooms, object subjects, shot type, pace, timing
and eye height without a provider request. The Gemini endpoint receives that
structured intent after consent. The Worker replaces room/object IDs with
fresh aliases and includes only safe object vocabulary and floor ordinals.
It sends no raw text, drawing, custom name, address, coordinate or account data.
Requested order, subjects, duration and preferences must survive provider
validation. AI cannot invent camera coordinates or execute code. Source changes
during a response cause a conflict. Existing quota admission and the server-only
`GEMINI_API_KEY` secret are reused; no key is placed in browser code.

Live provider verification requires an operator-supplied local secret or a
separately authorized deployed environment. Mock transport tests are labelled
as such. The deterministic and manual workflows remain available without AI.

## Local operation and asset budgets

The current preview uses `http://127.0.0.1:5277/explore` and a local Worker at
8790 with isolated `.wrangler/spatial-dev` storage. Start `npm run spatial:service`
for app-connected rendering; pair using its private code file. The browser
uses HTTP only to the exact loopback address `127.0.0.1:43127`, authenticates in
headers, and never executes shell commands. See [Blender setup](spatial-blender.md).

`npm ci` locks OCR/PDF dependencies. `predev` and `build` generate same-origin
`public/spatial-ocr/` and `public/spatial-pdf/` assets from those packages, with
licence notices and OCR SHA-256 manifest. Generated binaries are ignored in Git.
The 3D engine, PDF decoder and OCR wrapper have separate lazy chunks. The CSP
allows same-origin workers and WebAssembly while keeping object embedding,
foreign scripts and arbitrary outbound connections disabled. No CDN receives
an imported drawing or OCR text.

All house geometry, furniture recipes and textures are repository-authored.
OCR is Tesseract.js/Tesseract (Apache-2.0), the bundled English traineddata comes
from the official `@tesseract.js-data/eng` package with the
[upstream data licence](https://github.com/naptha/tessdata/blob/gh-pages/LICENSE)
and provenance notice retained, and PDF.js is Apache-2.0 with
included font/CMap/WASM notices. Rendering quality bounds DPR and shadow maps;
obsolete geometries, textures and context listeners are disposed.

## Verification

`npm run check`, fresh migrations, both Worker dry runs, audit and diff checks
are required. Focused suites cover geometry, actual swept paths, stairs,
per-shot signatures, revision races, camera persistence and AI privacy.
Browser scripts in `scripts/check-spatial-*.mjs` exercise the editor, drawing
recognition/OCR/PDF, camera library, local renderer and legacy tour journey.
Private browser fixtures reject non-loopback origins and remove only their own
exact synthetic projects. Actual results, hardware constraints and inspected
artifacts are recorded in [verification evidence](spatial-verification.md).
