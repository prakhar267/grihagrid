# Spatial studio verification — 14 September 2026

This evidence covers the local implementation. No deployment, remote migration,
payment activation or paid infrastructure was performed.

## Environment

MacBook Air M4, 16 GB RAM; installed Google Chrome with Metal rendering;
Blender 4.5.9 LTS ARM64 and FFmpeg. The app ran at
`http://127.0.0.1:5277/explore`; the local Worker used port 8790 and a separate
`.wrangler/spatial-dev` D1 database. All private browser fixtures were synthetic.

## Automated checks

| Check | Result |
| --- | --- |
| Locked install, `npm ci` | Passed |
| Full `npm run check` | Passed: 487 tests, zero failures/skips; operations check passed |
| Fresh D1 migrations | Passed all 22 forward migrations |
| Production and staging Worker dry-run builds | Passed; no deployment |
| `npm audit --audit-level=high` | Passed, zero reported vulnerabilities |
| `git diff --check` | Passed |
| Spatial core | 12 focused tests passed |
| Spatial API with real D1 | 8 tests, including parent, passed |
| Blender pipeline | 5 focused tests passed |
| `SPATIAL_UI_PRIVATE=1 npm run check:spatial:ui` | Passed all eight browser check groups, zero captured page errors |

The final full suite completed in 224.39 seconds. Earlier checks exposed two
legacy migration-count assertions and a payment-test pooled-socket reset. The
assertions now expect the added migration; the webhook fixture uses fresh HTTP
connections across synchronous D1 subprocess calls. All payment assertions and
product payment behavior are unchanged, and the complete rerun passed.

The API checks exercise ownership, origin and CSRF rejection, read-only empty
loads, Change Study acceptance, immutable revisions, idempotency, concurrent
writes, stale brief/layout handling, archived projects and source changes while
AI generation is in flight. Gemini responses are mocked in these tests; no live
Gemini request was made. The local Worker deliberately has no provider key.

The core suite checks every connected demo space, walls/windows/closed doors,
furniture collision, swept movement, checked path smoothing, full-tour samples,
unit conversion, resizing, stale routes, unknown IDs and renamed-room scenes.

## Browser evidence

The reproducible browser journey inspected 1440 px desktop and 390×844 mobile
layouts, a 720 px CSS viewport equivalent to 200% reflow, and reduced motion.
It accepted a 12 m to 13 m dimension change, verified stale playback fencing,
rebuilt the tour, played/paused/resumed it, checked pending stop edits, matched
a local 25-second room request and downloaded the scene bundle. A separate
authenticated browser context accepted a concept, saved a tour revision,
reloaded both with history intact, and deleted the exact synthetic project.

Screenshots and the machine-readable report are in the ignored local
`qa-artifacts/spatial-ui/` directory. Representative overview, living room,
kitchen, bedroom, tour and mobile walking views were also inspected directly.
Measured interactive performance was 51–60 fps on desktop and approximately
53 fps in a 390 px Chrome viewport on this Mac. This is viewport emulation,
not evidence from a physical phone.

Keyboard room selection retained focus and announced selection. Manual camera
takeover paused playback and the explicit Resume action continued it. Forced
WebGL unavailability produced a clean fallback with playback disabled and a
usable 2D plan, without an uncaught error. An A4 print was rendered and inspected:
one page, all eight rooms and dimensions readable, with the spatial-concept footer.

Keyboard walking moved from canonical `[2500,3100,1650]` to
`[2500,4362.56,1650]` through the physical living/gallery doorway. The viewer
exports full-height walls and roofs even when its presentation is cut away.
A browser-exported GLB contained all eight room IDs, 316 nodes and seven roofs,
at approximately 1.87 MB.

The 3D engine is a separate lazy chunk, approximately 253 kB gzip. The initial
HTML does not preload it. Procedural assets avoid external texture downloads;
quality presets bound pixel ratio and shadow resolution. The build reports the
expected large lazy-engine chunk warning; this is not a physical-device memory
or broad browser compatibility benchmark.

## Blender and video evidence

`output/spatial-demo-film/tour.mp4` is an actual 20.000-second H.264 video with
600 native 1920×1080 frames at 30 fps, 10,163,242 bytes. All frames were checked
for completion, encoded with decode errors treated as fatal, and counted again
using FFprobe. A contact sheet sampling every second across the entire film
was inspected, including the final garden view. This is a fast Eevee draft with
four samples and procedural concept assets. It is not a Cycles film or a claim
of photorealistic rendering.

Six Cycles preview frames and a native 1080p Cycles still were separately
rendered and inspected. Cycles remains the default higher-quality offline
option; its measured cost was about nine seconds per 1080p frame after initial
Metal compilation on this machine.

The editable `.blend`, GLB, manifest, job record and video evidence are beside
the film. Blender and direct glTF checks verified all 315 mesh identifiers,
room associations, coordinates, camera direction and vertical FOV. An actual
Three.js `GLTFLoader` load also passed. Maximum observed coordinate error across
these checks was below 0.002 mm. Browser and Blender lighting differ, while
geometry, IDs, scale and camera paths share the same source.

The film hit its initial ten-minute bound and finished through a supervised
resume from frame 477 using the unchanged saved scene. The job record preserves
both the timeout and completion; total wall time was 758 seconds. Automatic
resume is not a shipping CLI feature. Details and reproducible render commands
are in [the Blender pipeline guide](spatial-blender.md).

## Remaining boundaries

- One complete floor and rectangular rooms; dimension scaling rather than
  arbitrary room drawing, custom door swings or multi-floor navigation.
- Sample-derived concepts; no drawing recognition or automatic architectural
  reconstruction from an existing estimate.
- Gemini requires the existing server-side key. The current interface is
  limited to room ordering and total timing; manual tours work independently.
- Saved viewpoints persist in the open session and downloaded bundle; server
  persistence covers accepted models and tours, not a separate viewpoint library.
- Local Blender export, with no browser-to-shell execution or cloud render queue.
- Physical mobile devices, screen-reader traversal and broad browser/GPU coverage
  remain untested. Concept geometry is not a construction or regulatory drawing.
