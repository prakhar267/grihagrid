# Local Blender scenes and camera films

The spatial renderer is a local job, separate from the Cloudflare Worker.
It consumes the same validated millimetre geometry and camera route as the
browser workspace. No provider call or account credential is needed.

## Run a job

Install Blender 4.5 LTS and, for MP4 encoding, FFmpeg. The runner searches
`BLENDER_BIN`, the standard macOS application locations, its optional user
cache location, and `PATH`. An explicit `--blender` path takes precedence.
It does not download software itself.

```sh
# Complete synthetic furnished demo, including six Cycles preview frames.
node scripts/spatial/run.mjs --mode preview --samples 16

# A plain building JSON or the workspace's downloaded {model, tour} bundle.
node scripts/spatial/run.mjs --input /absolute/path/grihagrid-scene.json --mode preview

# Export an editable scene and an optimized binary glTF without rendering.
node scripts/spatial/run.mjs --input /absolute/path/grihagrid-scene.json --mode scene

# 24 seconds, 30 fps, 1920×1080. Inspect the preview before this longer job.
node scripts/spatial/run.mjs --mode film --duration 24 --samples 16 --timeout 7200

# Faster draft film: real-time Eevee shading, explicitly recorded in manifest.
node scripts/spatial/run.mjs --mode film --engine eevee --duration 20 --samples 4 --timeout 1800
```

An embedded tour keeps its own duration; `--duration` controls generation
when there is no supplied tour. Each run creates a new `output/spatial-*`
directory. Explicit `--output` directories must be empty. Failed jobs keep
their partial artifacts and a failed `job.json`; successful jobs mark it
complete only after Blender and any FFmpeg encoding have succeeded.

Outputs are `building.json`, `scene-data.json`, `house.blend`, `house.glb`,
`manifest.json`, `job.json`, preview PNGs, and (film mode) PNG frames and
`tour.mp4`. Inputs and outputs stay local and may contain project data.
Do not put job directories in a public assets directory.

## Shared coordinates and camera contracts

Canonical geometry uses millimetres, X right, Y forward, and Z up. Blender
uses the same axes in metres. glTF/browser coordinates are
`[x / 1000, z / 1000, -y / 1000]`. The glTF exporter performs that axis
conversion; the Python builder must not apply it a second time.

`src/spatial/model.js` owns scene validation and primitive generation.
`src/spatial/tours.js` owns routing, clearance validation, and camera
sampling. The local Node runner imports those modules directly.
`scene.py` creates meshes/materials/lights; `cameras.py` applies the camera
samples; `render.py` assembles, exports, checks, and renders.

Every camera sample uses vertical field of view in degrees. Blender uses
a 24 mm vertical sensor and `lens = 12 / tan(verticalFov / 2)`. Frames are
sampled at 30 Hz and keyed directly with linear interpolation so Blender
does not introduce Bezier overshoot between route points. Cuts defined
by the source tour remain cuts. A keyed black compositor overlay matches
the source tour's deliberate fade transitions.

Exports preserve object ID, room ID, category, and source revision as glTF
extras. After export, the same Blender process imports the GLB into an
empty scene and checks every mesh identifier, room association, world
bounds (1 mm tolerance), and camera position and direction. It records
results in `manifest.json` and fails the job if a check fails. The Node
runner additionally reads the exported glTF JSON and independently checks
each object's browser-axis translation, camera orientation, and vertical
field of view. This catches a consistent but incorrect exporter/importer
axis convention that a Blender-only round trip could conceal.

## Resource and presentation boundaries

The runner reads JSON through one open regular-file descriptor with a hard
2 MiB byte limit and exclusive creation of initial job records. It accepts at
most 5,000 generated primitives, 1–128 samples, and tours up to 120 seconds. Child processes use
argument arrays with no shell. Blender runs factory startup with automatic
script execution disabled and four CPU threads. On compatible Macs the
default `--device auto` uses Metal; `--device cpu` forces the bounded CPU
path. The initial Metal kernel compilation can take about a minute.
Render timeouts are
30–7,200 seconds; encoding has a separate five-minute bound. The trusted
Python entrypoint is fixed in the repository; JSON never supplies code.

The default renderer uses Cycles with denoising, four bounce depth, and
procedural solid materials. It deliberately does not download furniture
or texture packs. Existing demo assets are authored in source. A 16-sample
preview is useful for checking composition; it is not a photoreal quality
guarantee. Raising samples increases local runtime. `--engine eevee`
offers a faster draft-film option with different shading; every artifact
manifest records the actual engine and sample count.

The browser uses real-time lighting and presentation cutaways. Blender
renders full architecture, physical lighting and glass transmission.
Those lighting/shader results are not pixel-identical. Both share the
geometry, stable IDs, dimensions, and camera path. Room assignment on a
shared wall uses the canonical primitive's assigned room.

This is a local development/render workflow, not an authenticated cloud
render queue. The Worker cannot run Blender. Production scheduling,
private artifact storage, quotas and job-owner isolation require separate
infrastructure; R2 and private uploads remain disabled.

## Local evidence, 14 September 2026

Verified official Blender 4.5.9 LTS ARM64 on the available MacBook Air M4,
16 GB memory. Its downloaded DMG matched Blender's published SHA-256
`e3a3d7aac381fb4e4d05197f99cd8899484d7e8bc4497c134066e6733f372238`.
The optional local cache app is outside the repository.

The furnished demonstration exported 315 mesh primitives, a 1.5 MB GLB,
and a 4.6 MB editable Blender scene. The Blender round trip checked all
315 identifiers and room associations, with maximum bounds error
0.000954 mm and camera direction error 0.000000215. Six Cycles preview
frames (8 samples, 633×356) rendered in a 15.51-second complete job and
were visually inspected: exterior, living room, gallery, bedroom and
garden views showed coherent surfaces, openings and furniture.

A native 1920×1080 Cycles still also rendered successfully. The first
Metal run spent about 78 seconds compiling kernels, followed by roughly
nine seconds rendering/denoising one frame at four samples. That measured
cost makes a full Cycles film a longer offline job on this machine.
The fast demonstration film uses Eevee and must not be represented as
a Cycles film or a photoreal render.

A separate scene-only job consumed the workspace-compatible `{model,tour}`
bundle, preserved its supplied tour, and passed both Blender and direct
glTF-coordinate checks. The direct check observed maximum object-position
error 0.001224 mm and vertical field-of-view error 0.00000208 degrees.
The focused Node suite covers resource bounds, rejected overwrites,
literal process arguments, process timeout, shared geometry serialization,
and incorrect glTF axis/lens conventions.

The actual GLB also loaded successfully through Three.js `GLTFLoader` in
a separate smoke check: all 315 mesh/room associations survived, world
bounds differed by at most 0.000538 mm, and its camera loaded with a
47.999998-degree vertical field of view matching the 48-degree source.

The completed fast film contains **600 native 1920×1080 frames, 30 fps,
20.000 seconds, H.264**, and is 10,163,242 bytes. All PNG frames passed
completion checks and FFmpeg encoded them with decode errors treated as
fatal. FFprobe subsequently counted all 600 encoded frames. A contact
sheet sampled every second across the complete tour was visually
inspected, including the final garden view. It is a furnished concept
scene with procedural assets; its low-sample Eevee shading has visible
grain and is not photorealistic.

The first deliberately bounded film attempt stopped at 600 seconds with
476 complete frames and a partial frame 477. An exact-job recovery used
the unchanged saved scene (SHA-256
`19a7b9abddc5b38018bd128834160fe14708dd4b9dda1fe4fa2017742aeeb9b9`)
to render frames 477–600 with the same engine and sample count, preserving
every completed frame. Total wall time including that recovery and
encoding was 758 seconds. `job.json` records the earlier timeout and final
completion. This was a supervised synthetic recovery, not an automatic
retry feature of the shipping CLI; normal film jobs should use the
documented 1,800-second or greater appropriate timeout.
