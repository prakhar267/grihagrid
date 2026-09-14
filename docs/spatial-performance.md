# Spatial browser performance

This document records the browser renderer's limits and a reproducible local
measurement procedure. The 390px profile runs on the same desktop GPU with touch,
viewport and device-pixel-ratio emulation. It is **not a physical-phone benchmark**.
Physical iPhone and spoken VoiceOver checks were deferred by the user on
15 September 2026.

## Reproduce

After the required locked install and production build, serve that build through
the local Worker. Keep other browser tests and Blender rendering stopped during
the measurements. With the existing Worker on port 8790:

```sh
SPATIAL_UI_ORIGIN=http://127.0.0.1:8790 SPATIAL_PERF_TRANSITIONS_ONLY=1 node scripts/check-spatial-performance.mjs
SPATIAL_UI_ORIGIN=http://127.0.0.1:8790 node scripts/check-spatial-cross-browser.mjs
SPATIAL_UI_ORIGIN=http://127.0.0.1:8790 node scripts/check-spatial-performance.mjs
```

The final command measures all six combinations of desktop/390px emulation and
Balanced/Light/High quality. `SPATIAL_PERF_SECONDS` changes each active-tour sample
from its default eight seconds to a value between four and thirty seconds.
The script requires installed Playwright and local Google Chrome; it refuses
nonlocal app origins. It uses the public sample and makes no provider calls or
account/project writes. The transition check creates temporary demo viewpoints
in its isolated browser context to compare actual exported camera coordinates.
It allows the paired renderer's read-only local health request if that panel loads.

Reports and screenshots are ignored local QA evidence in
`qa-artifacts/spatial-performance/`. Preserve `verification.json` under a named
subdirectory before running a different mode; a new run replaces that filename.
The report records timestamp, source-file SHA-256 values, Git commit, built HTML
hash, safe host information, browser/GPU strings and per-frame observations.
It does not record machine serial numbers, secrets or private project contents.

## Measurement meaning

The harness wraps real WebGL draw calls and groups them by the surrounding
animation-frame timestamp. Rendered FPS is the number of frames with draw
submissions divided by measured wall time. It does not count empty animation
callbacks. Draw calls and triangles include visible and shadow passes, so they
can exceed the application's last-pass Three.js HUD values. They are submitted
geometry counts, not unique scene triangles. This is not a GPU elapsed-time or
display-presentation measurement.

Each scenario starts in a fresh browser context with network cache disabled,
records context creation attributes, enters 2D and returns to 3D, then measures
2.5 seconds of settled overview, eight seconds of playing tour, two seconds of
paused tour and two seconds after resetting overview. The separate transition
check changes quality directly without the 2D/3D remount, checks preserved
camera position/target/FOV and tour time/state, and exercises mouse look,
semantic picking and genuine WebGL context-loss fallback.

Frame intervals, long tasks, CDP main-thread task duration and sampled JavaScript
heap usage are retained. The heap sample is neither peak memory nor GPU memory.
Network totals come from CDP encoded transfer observations and resource timing
decoded sizes. They cover the initial app/editor workflow, not only the 3D
module. Optional OCR/PDF assets are listed separately as build inventory and are
not implied to have downloaded during the default sample journey. Localhost
navigation timing does not establish real-network loading performance.

## Enforced rendering and input limits

The following values are implemented in
[`WorldCanvas.jsx`](../src/spatial/WorldCanvas.jsx),
[`model.js`](../src/spatial/model.js) and
[`model-v2.js`](../src/spatial/model-v2.js).

| Control | Light | Balanced | High |
| --- | --- | --- | --- |
| Maximum device-pixel ratio | 1 | 1.5 | 2 |
| Directional shadow map | Disabled | 1024 × 1024 | 2048 × 2048 |
| Antialias context attribute | False | True | True |

Changing between Light and an antialiased mode recreates the WebGL context and
restores the camera and tour state. Balanced/High share the antialiased context.
The old detached canvas's deliberate context loss does not trigger the live
viewer fallback; a connected canvas's real context loss still does.

Other limits and costs:

- One shadow-casting directional light, one non-shadow directional light,
  ambient light and hemisphere light. No downloaded HDR environment or models.
- Three deterministic 128 × 128 procedural textures. Their RGBA base images
  total 192 KiB; a complete mip chain is approximately 256 KiB, excluding driver
  allocations and CPU copies. Texture anisotropy is capped at 4 in source.
- Cylinders use 16 radial segments; spheres use 12 × 8 segments. Rounded fabric
  boxes use two bevel segments; eligible hard furniture uses one segment and an
  8 mm maximum bevel. Each primitive currently has its own mesh and
  material; the renderer does not implement instancing.
- Overview uses demand rendering and a roof/wall cutaway. Room, walking and
  tour modes render continuously, including a paused tour. Pausing a tour freezes
  its timeline; it is not currently a zero-draw power-saving state.
- Version 1 input limits: one floor, 32 rooms, 128 walls and 256 furniture items.
  Version 2 limits: four floors, 48 rooms, 256 walls, 512 furniture items and eight
  stairs, with at most 64 room vertices and 24 openings per wall. These are
  validation limits, not measured performance guarantees at maximum size.
- Texture, mesh and event-listener cleanup runs on teardown. Temporary export
  resources are disposed after export. Camera distance clipping and fog are
  presentation settings, not a substitute for geometry or asset budgets.

## Review budgets

For the existing Courtyard House reference journey, use these **advisory review
budgets** for future changes: target approximately 60 rendered FPS on the named
desktop, investigate below 30 FPS in the named 390px emulation, p95 at most 800
draw submissions and 100,000 submitted triangles per frame including shadows,
and at most 4 MiB of decoded initial app/editor resources. Settled overview
should submit zero draws during the idle sample. The numeric thresholds are
documented regression review budgets; they are not automatic quality reduction
or CI timing gates. Physical-device results cannot be inferred from them.

## Final measured results

Measured on the production visual-polish build from 01:25–01:27 IST on
15 September 2026 (19:55–19:57 UTC on 14 September), with other browser and
native-render jobs stopped. Focused release database tests were running on the
host; no frame degradation was observed. Chrome was
152.0.7977.84 on the MacBook Air M4 host described below. All six contexts used
the real Apple M4 Metal WebGL2 renderer.

The measured scene was the Courtyard House: one floor, eight rooms, ten walls,
17 openings, 34 furniture items and 315 generated primitives; canonical scene
JSON was 9,210 bytes. The two-floor Gallery House is included in the report's
inventory only; its performance was not measured in this matrix.

| Profile / quality | Draw-frame FPS | p95 frame interval | p95 calls / frame | p95 triangles / frame | Drawing buffer |
| --- | ---: | ---: | ---: | ---: | --- |
| Desktop / Balanced | 59.97 | 16.7 ms | 628 | 50,702 | 1624 × 927 |
| Desktop / Light | 59.98 | 16.7 ms | 332 | 25,482 | 1082 × 618 |
| Desktop / High | 59.99 | 16.7 ms | 628 | 50,702 | 2165 × 1236 |
| 390px emulation / Balanced | 59.98 | 16.8 ms | 620 | 49,566 | 523 × 642 |
| 390px emulation / Light | 59.97 | 16.7 ms | 324 | 24,346 | 349 × 428 |
| 390px emulation / High | 59.99 | 16.7 ms | 620 | 49,566 | 698 × 856 |

The desktop canvas occupied approximately 1083 × 618 CSS pixels within the
1440 × 1080 page; the 390 × 844 emulated page's canvas was 349 × 428 CSS pixels.
The actual context reported antialias disabled in Light and enabled in
Balanced/High, both immediately after selecting quality and after a fresh mount.

All six initial and reset overview samples submitted **zero draws**. Paused tours
continued at 59.93–59.96 draw-frame FPS. Every active-tour HUD sample read 60 FPS,
within 0.03 FPS of the longer measured sample; the prior systematic 61 FPS
reading is gone. Every profile's maximum frame interval was 16.8 ms. No Long
Tasks were observed during active samples. Sample-end JavaScript heaps were
42.0–63.8 MiB, and main-thread task duration was 0.77–1.27 seconds per
eight-second active sample. No page errors, failed requests or HTTP errors were
recorded in any profile.

Each workflow decoded 2,784,076 resource bytes (2.66 MiB); CDP recorded
903,928–903,936 transferred bytes. Local navigation duration was 93.7–148.2 ms,
which is not time-to-first-3D-frame or an internet loading claim. The entire
build inventory was 19,881,066 bytes (18.96 MiB), including optional OCR/PDF
runtimes, fonts and other site imagery. The spatial engine bundle itself was
960,591 uncompressed bytes. The default journey fetched no drawing, remote model
or HDR environment.

The reference scene stayed within the advisory draw, triangle and initial-byte
budgets. Light roughly halved submitted work, while High increased pixel and
shadow-map work without changing the geometry budget. These short desktop-host
samples establish neither physical-phone performance nor thermal/battery
behavior, maximum-scene performance, or unused GPU headroom.

The final report is `qa-artifacts/spatial-performance/verification.json`; desktop
and emulated-mobile screenshots were inspected and show the furnished overview
and responsive controls. Its build HTML SHA-256 is
`d240b58b43e2db3c09d1361e5581cbdeda43869d64c1602ddee0a0b5e7c2e44d`;
the measured `WorldCanvas.jsx` SHA-256 is
`b8d922141b728d36ac9bd731ba6e40b86bc06707c4e588f23efe68789be18b75`.
The report retains hashes for every spatial source file and the harness, so the
tested contents remain identifiable across the subsequent integration commit.
The prior production measurements are preserved under
`qa-artifacts/spatial-performance/before-visual-polish/`. Bevels increased the
reference desktop p95 submitted triangle count from 36,686 to 50,702 while draw
calls stayed at 628 and measured production FPS remained about 60. A preliminary
Vite run measured 55–58 FPS with substantially more main-thread work; it is
retained under `visual-polish-vite/` and is not substituted for production data.
The final production matrix is also preserved under `visual-polish-production/`.

## Historical measurement and fixes

The first six-profile production run on 15 September 2026 used Chrome 152.0.7977.84
on a 16 GB MacBook Air M4 (10 CPU cores), macOS 26.5.2, with WebGL2 through
`ANGLE (Apple, ANGLE Metal Renderer: Apple M4, Unspecified Version)`.
Desktop viewport was 1440 × 1080 at device DPR 2; emulation was 390 × 844 at
device DPR 3. Quality settings capped actual drawing-buffer DPR as above.

That historical run measured 59.96–60.07 rendered FPS across the six profiles.
Light's p95 was 324–332 draw calls and 17,430–18,474 submitted triangles;
Balanced/High were 620–628 calls and 35,642–36,686 triangles. Settled overview
submitted zero draws in every case. The decoded workflow resource total was
2,775,539 bytes; CDP observed approximately 900,796 encoded transferred bytes.
The complete build inventory was 19,872,529 bytes, including optional OCR/PDF
runtimes and site imagery that the default sample did not fetch.

It also found two real issues: the HUD rounded to 61 FPS while measured rendering
was about 60 FPS, and selecting Light on an existing antialiased context kept
antialias enabled. The FPS calculation now counts intervals correctly, and
quality changes use the context-preserving lifecycle described above. Original
measurements are retained unchanged under
`qa-artifacts/spatial-performance/before-quality-fix/`; they are historical
evidence, not the final-source benchmark.

## Final production lifecycle checks

The production Worker build passed the Chrome quality-transition regression
again after the material and geometry polish. Orbit-adjusted overview, room view,
walking look direction and paused-tour camera coordinates/FOV were preserved
across Light/Balanced transitions; paused timeline values stayed fixed and a
playing tour continued. Semantic pointer picking worked through the stable
event source. Overview returned to zero draws, while deliberate loss of the
connected WebGL context still exposed the failure state and usable 2D plan.
There were no page errors or failed requests.

Firefox 155.0 and WebKit 26.6 then each passed nine production checks, including
direct quality changes with verified context antialias attributes and new draw
calls after old-context disposal, preserved paused-tour time, play/takeover/resume,
keyboard focus, numeric edits, 390px and 720px reflow, and reduced motion. Both
reported zero page errors, console errors and failed requests. These are
headless engine checks; they do not replace physical-device testing.
The later visual-polish checkpoint resolved the Firefox ground banding by
separating two coplanar ground surfaces. An isolated ground-only correction and
final Chrome/Firefox/WebKit images are retained in `qa-artifacts/spatial-visual/`;
see [the cause and before/after evidence](spatial-visual-polish.md).

Evidence is retained in
`qa-artifacts/spatial-performance/visual-polish-lifecycle/verification.json`
and `qa-artifacts/spatial-cross-browser/report.json` with settled screenshots.
The numeric run was isolated from browser verification and native render jobs;
these behavior checks ran separately so they did not compete with the timing samples.
