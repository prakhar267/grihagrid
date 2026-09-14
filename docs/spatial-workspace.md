# Spatial studio

## Customer outcome

Explore a furnished single-storey concept, inspect the same plan in 2D, make
a dimension study, accept a revision, and direct a camera tour. The primary
acceptance measure is completion of this journey without a geometry mismatch,
camera collision, lost edit, or browser error. Measure viewer FPS and asset
size on the actual test device, without calling emulation a mobile benchmark.

`/explore` is a labelled, unauthenticated demonstration. Its edits remain in
the open tab; downloaded JSON preserves the model, tour and saved viewpoints.
`/projects/:id/spatial` opens the owner-scoped project studio. The project home
links to it. An unsaved project studio explicitly starts from sample geometry;
it does not infer a custom architectural design from the cost-estimate brief.

## Shared geometry

`src/spatial/model.js` defines schema version 1: millimetres with XY ground and
Z up. `toBrowser([x,y,z])` produces `[x,z,-y]/1000`; Blender uses `[x,y,z]/1000`
before its standard glTF export. Rectangular room polygons, wall openings,
furniture and environment data produce the same named primitive descriptors
for the browser and Blender. All demonstration geometry and textures are
procedurally authored in this repository; no external asset licence is needed.

The initial generator deliberately supports one floor and rectangular rooms.
Width and interior-depth controls scale connected room boundaries, walls,
openings and furniture positions together. Furniture dimensions stay fixed.
Validation rejects unsupported schemas, fields, IDs, overlaps and disconnected
rooms. Read the errors rather than treating a rendered concept as buildable.

The executable validator is `validateBuilding`; `src/spatial/demo.json` is a
complete schema-v1 example. Unknown fields are rejected. Coordinates and sizes
below use millimetres; object rotations use radians around canonical Z.

| Record | Stored fields and meaning |
| --- | --- |
| Building | `schemaVersion`, `id`, `name`, `revision`, `seed`, `units`, `axes`, `bounds`, and the collections below |
| Floor | Stable `id`, `name`, `elevation: 0`, `height` |
| Room | `id`, `name`, `floorId`, rectangular `polygon`, material `color`, `exterior` flag |
| Wall | `id`, `start`, `end`, `roomIds`, `height`, `thickness`, nested `openings` |
| Opening | `id`, `kind`, distance `offset` along its wall, `width`, `sill`, `height`; doors also have `open` |
| Furniture | `id`, `roomId`, procedural asset `kind`, ground-contact `position`, `size`, `rotation`, `color` |
| Exterior | `groundColor`, `skyColor`, canonical `sun` position; planting is named furniture |

The first schema uses reusable procedural material/asset recipes, not arbitrary
remote assets. Door leaves use a fixed hinge/swing convention; open passage
clearance is computed from opening width, frame inset and camera radius. Custom
hinge directions and arbitrary material/light catalogues are future schema
extensions. Connections and navigable areas are derived from this geometry and
validated independently, avoiding a second, potentially inconsistent room graph.

## Camera behavior

Overview has presentation-only wall/roof cutaways. Room selection fades into
a computed accessible viewpoint. Walking uses a 220 mm clearance radius,
human eye height and swept collision checks against walls, closed doors,
windows and furniture. Desktop WASD/arrows and touch controls are available.

Tours contain ordered shots with canonical paths, targets, vertical field of
view, timing and explicit transitions. A grid route planner passes through
open doorways; line-of-sight smoothing is clearance checked. Easing changes
progress along that checked polyline rather than fitting an unchecked spline.
Playback supports pause, takeover, resume, restart, scrub, speed, stop order,
individual shot timing and viewpoint capture. Layout revisions make older
tours stale. Saved viewpoints are included in the downloaded scene bundle.

The exported bundle is `{model, tour, viewpoints}`. A tour stores `schemaVersion`,
`id`, `name`, `buildingId`, `sourceRevision`, `source`, `duration`, `roomIds`, and
`shots`. Each shot contains `id`, `kind` (`orbit`, `walk`, or `hold`), nullable
`roomId`, canonical 3D `path`, `target`, `startTime`, `duration`, vertical `fov`,
and `transition` (`continuous`, `cut`, or `fade`). Speed follows checked path
length and shot duration; smoothstep easing is applied by the shared sampler.
Saved viewpoint records include position, target, FOV and source revision.

Three.js is loaded with the spatial workspace, leaving existing estimator and
report entrypoints independent of the 3D engine. Detail presets bound shadows
and device pixel ratio. A 2D fallback survives WebGL unavailability. Renderer
resources and context listeners are released on unmount.

## Project persistence and AI

Forward-only migration `0022_spatial_workspace.sql` creates immutable spatial
and tour revision records linked to an exact existing brief revision. It does
not change the deterministic estimate or purchased report snapshots.

Owner-scoped API routes:

| Route | Behavior |
| --- | --- |
| GET `/api/projects/:id/spatial` | Read latest concept, tour, source state and recent revision metadata |
| POST `/api/projects/:id/spatial/preview` | Validate and return a Change Study without writes |
| POST `/api/projects/:id/spatial` | Accept a concept with revision fencing and idempotency |
| POST `/api/projects/:id/spatial/tour` | Save a separately versioned validated tour |
| POST `/api/projects/:id/spatial/tour-intent` | Request a bounded Gemini itinerary |

Writes require an active owner session, trusted origin, CSRF token, strict
schema and rate admission. SQL compare-and-swap conditions reject concurrent
or stale writes. Archived projects remain read-only. Project deletion uses
existing authorization and cascade rules; this work does not enable deletion
of customer or financial records outside those rules.

Local instruction matching extracts known room names and duration and states
that no AI request occurred. For Gemini, the browser sends only validated
intent after explicit consent. The Worker replaces room IDs with generated
aliases; it never sends raw instructions, drawings, custom labels, coordinates,
account details or addresses. The existing server-side Gemini secret and
transactional per-user/platform generation allowance are reused. Results are
independently validated and rejected if the source changes during generation.
Manual tour creation remains usable without provider configuration.
The bounded AI interface currently handles room ordering and total duration;
shot styles and safe positions are generated deterministically. It does not
yet interpret arbitrary visual subjects or generate design proposals.

## Local operation and limits

Run the Vite preview and a local Worker/D1 using the existing development
configuration. The implementation session uses `http://127.0.0.1:5277/explore`
and an isolated `.wrangler/spatial-dev` database with Worker port 8790.
The alternate frontend port avoids an existing application's local listener.
`npm run check:spatial:ui` checks the demo with installed Google Chrome. With
the local Worker running, `SPATIAL_UI_PRIVATE=1 npm run check:spatial:ui` also
creates a synthetic local account/project, saves and reloads concept/tour
revisions, and deletes only that exact synthetic project. This option rejects
non-loopback origins. It does not use production credentials or databases.

See [Blender pipeline](spatial-blender.md) for scene JSON to editable `.blend`,
GLB, preview and MP4 commands. Rendering runs on a local machine, outside the
Worker. The browser downloads a bundle for that runner; it does not execute
shell commands or claim a cloud render service exists.

This implementation does not activate uploads, R2, payments or paid compute.
It does not provide drawing recognition, arbitrary polygon editing, stairs,
multi-floor walking, photoreal browser rendering or construction certification.
These boundaries are explicit in the schema and documentation.

## Verification

Focused core tests cover geometry, unit conversion, door and furniture
collision, swept path clearance, complete tour sampling and stale revisions.
The spatial API tests run actual D1 storage through the Worker, including
ownership, CSRF, immutable history, racing commits and AI source changes.
The Blender tests cover argument handling, shared serialization, output
isolation, process timeouts and scene bundles. Visual and full-suite results
are recorded in `docs/spatial-verification.md` after verification finishes.
