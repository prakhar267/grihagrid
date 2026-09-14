# Spatial browser visual polish — 15 September 2026

The browser scene retains the Architectural Monograph palette and canonical
building geometry while improving surface scale, furniture edges and daylight.
No external textures, downloaded models or paid assets were added.

## Ground banding: cause and correction

The canonical `site-ground` box is centred at Z = −180 mm with height 200 mm.
Its top is therefore Z = −80 mm. The browser's decorative backdrop plane was
also at Z = −80 mm. The two coplanar surfaces competed for depth; Firefox
showed bands of the sage ground through the cream backdrop. This was a geometry
overlap, not a reason to disable shadows or lower Firefox quality.

The backdrop now sits 25 mm below the lowest canonical floor/exterior slab.
For the sample, its height is −305 mm, below the site's −280 mm bottom.
Canonical scene primitives, coordinates, IDs, collision boundaries and exports
are unchanged. An isolated Firefox capture with only this correction removed
the bands and exposed the complete site base cleanly.

Evidence is retained under `qa-artifacts/spatial-visual/`:

- `before/firefox-overview.png`: reproduced bands.
- `ground-fix/firefox-overview.png`: same scene, only backdrop separation changed.
- `after/{chrome,firefox,webkit}-overview.png`: final material/lighting treatment
  with a clean site base in all three engines.

## Surface treatment

Three deterministic 128 × 128 canvas textures still supply all mapped materials.
Per-face UV coordinates now use local metres instead of stretching a unit-box
texture over an entire cabinet or room. Wood's grain module is 0.45 m, woven
fabric's is 0.12 m, and seamless mineral detail is 0.6 m. Scaling furniture or a
room therefore changes how much texture is visible rather than stretching it.

Stone no longer uses a tiled image with unintended grout lines on countertops.
The same subtle mineral map supplies plaster, ceramic and clay microdetail.
Existing textures are reused for restrained bump detail: plaster 0.4 mm,
wood 1.5 mm, fabric 1.2 mm, stone 0.7 mm, ceramic 0.15 mm and clay 0.8 mm.
Material roughness separates plaster/linen from wood, stone, ceramic and metal.
Fabric uses a subdued physical sheen; other surfaces retain standard materials.

Upholstery corners use a uniform radius capped at 40 mm and 28% of the smallest
dimension. Hard furniture parts larger than 45 mm in every dimension receive
a one-segment bevel capped at 8 mm and 12% of their smallest dimension. Both
remain within each primitive's canonical box. Existing object IDs and selection
handlers remain attached to the same meshes, and geometry is disposed when its
dimensions or visibility change.

Ambient/hemisphere fill is reduced so room depth and daylight shadows remain
visible. The sun direction stays unchanged, with a restrained warm/cool balance
and a softer PCF shadow radius. Light/Balanced/High DPR and shadow-map limits are
unchanged. The shader and geometry changes are presentation treatments; exported
camera poses and canonical building dimensions still come from the shared model.

## Reproduce and inspect

```sh
SPATIAL_UI_ORIGIN=http://127.0.0.1:5277 SPATIAL_VISUAL_STAGE=after node scripts/check-spatial-visual.mjs
```

The script captures the overview, living room, kitchen, main bedroom and a
390px overview in Chrome, Firefox and WebKit, plus full desktop studio pages.
It records browser versions/source hashes, checks actual WebGL draws and reports
page errors, console errors, failed requests and mobile overflow. The 390px
case is viewport emulation, not a physical phone. All three final visual runs
passed with empty error/request-failure lists. Before/after room images were
inspected for material scale and edge definition; the Firefox overlap artifact
is absent from the corrected captures.

For behavior and numeric budgets, use the lifecycle and performance procedures
in [spatial-performance.md](spatial-performance.md). The browser's camera-state,
quality transitions, pointer picking, demand rendering and genuine WebGL-loss
fallback remain acceptance checks for this polish checkpoint.

The polished production build passed the complete quality/camera lifecycle check:
Light/Balanced transitions preserve overview, room, walking and paused-tour
poses, playing tours continue, mouse look and semantic picking work, and a real
connected-context loss still exposes the 2D fallback. Its six performance
profiles measured 59.97–59.99 draw-frame FPS with zero idle overview draws.
Desktop Balanced/High p95 remains 628 draw calls and 50,702 submitted triangles;
all profiles remain below the existing 800-call/100,000-triangle review budgets.
The three-texture budget is unchanged. See the performance report for the exact
source/build hashes, transfer sizes and device-emulation limits.
