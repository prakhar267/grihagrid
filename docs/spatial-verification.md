# Spatial studio verification — updated 15 September 2026

This report covers the expanded implementation on `agent/spatial-camera-tours`.
The user authorized drawing/visual polish and production release on 15 September
2026. Local acceptance evidence and protected release preparation are recorded
below; actual deployment, migration and monitoring results belong to the exact
merged-SHA release workflow. Payments, fulfillment and private uploads stay closed.

On 15 September the user explicitly deferred physical iPhone and spoken
VoiceOver testing and requested completion of all remaining work. Those two
checks are excluded from this delivery's completion gates and remain unverified.
Browser, keyboard, touch-emulation and accessibility-tree checks retain their
recorded scope; none is relabelled as physical-device or spoken-screen-reader proof.

## Environment

MacBook Air M4, 16 GB RAM; Google Chrome, actual Safari 26.5.2,
Playwright Firefox 155.0 and WebKit 26.6, Blender 4.5.9 LTS ARM64 with
Metal, and FFmpeg. The app uses
`http://127.0.0.1:5277/explore`; the strict-CSP Worker preview uses port 8790
and an isolated `.wrangler/spatial-dev` D1 database. Browser account/project
fixtures are synthetic and cleanup targets only their exact identifiers.

## Current evidence

| Area | Observed result |
| --- | --- |
| Drawing to editable geometry | All nine groups passed against the production-build import checkpoint under the real Worker CSP, including the DOMPurify SVG boundary, SVG/PNG recognition, actual local Tesseract OCR, both PDF pages, keyboard calibration/opening selection, explicit review and export. A blank image produced zero invented rooms; manual tracing was clearly separate. |
| Layout editing | Rooms/shared vertices, furniture position/dimensions/rotation, doors/windows/hinge/swing, irregular upper room, connected stairs, floor add/delete, undo/redo and matching 3D passed. |
| GPU demand | Settled overview produced zero background WebGL draws; orbit/reset invalidated correctly, and entering a room resumed continuous rendering. |
| Final measured performance | Six final Chrome profiles passed after repository/browser tests and Blender rendering finished. Desktop active tours measured 59.97–59.98 rendered FPS; 390px desktop emulation measured 59.46–59.98 FPS. Every settled overview sample submitted zero draws. All quality modes applied the requested antialias state and reported no page errors. Exact draw/triangle/resource measurements and review budgets are in `docs/spatial-performance.md`; these results do not establish physical-phone performance. |
| Core geometry and direction | 29 focused checks passed, including exact swept clearance, the scaled 13-metre plan's narrow door passage, blocked partitions, door-to-window conversion and directed camera intent. These checks also passed in the final 549-test suite. |
| Private storage | Ten dedicated D1/API checks passed, including ownership, origin/CSRF, immutable revisions, CAS, idempotency, stale cameras, archival and deletion. The account-lifecycle export regression also passed in the complete repository suite. |
| Private browser journey | All eight camera-library/recovery groups passed. Both camera and tour retries reused an exact request after a real server commit with its response deliberately dropped, without duplicate revisions. Independent authenticated contexts exercised camera merge conflicts, both tour conflict decisions, draft downloads, preservation of unrelated camera edits, stale-camera deletion, the scaled 40-second directed tour and removal of a directed stop. |
| Existing studio journey | The final nine-group run on port 5277 passed with zero page errors: desktop/keyboard, replacement-study discard restoring valid floors and stops, stale/rebuild behavior, private concept/tour save and reload/history through the Worker, scene export, 390px layout, reflow/reduced motion and WebGL fallback. It confirms the final local Worker accepts authorized writes from the preview origin. Mobile is viewport emulation. |
| Actual browser zoom and print | Chrome Settings page zoom was set to 200% in an isolated profile: CSS width changed from 1440 to 720, device-pixel ratio from 1 to 2, and visual viewport scale stayed 1. Scroll width remained 720 and keyboard focus was retained. The actual one-page A4 PDF was rendered with Poppler and inspected: all eight room labels are readable, with editor/import/scaling controls hidden. |
| Archived browser project | A real archived Worker project with concept, tour and camera revision 1 stayed readable. Drawing/import, floor, viewpoint, tour-editing, AI and new paired-render mutation controls were disabled. No mutation request occurred and saved revisions stayed unchanged. The exact synthetic project and account were cleaned up successfully. |
| Firefox and WebKit | The final production build passed nine checks in each engine: actual WebGL rendering; tour play, exact pause, pointer takeover and resume; direct Light/Balanced transitions with correct antialias settings, unchanged paused time and new-context draws; keyboard room focus; numeric room/furniture edits and undo/redo; 390px editor/viewer reflow; 720px reflow; and reduced motion. Both reported zero page errors, console errors or failed requests. These are headless engines, not physical devices or the native Safari application. |
| Native Safari | Actual Safari 26.5.2 rendered the furnished scene. Native UI/accessibility-tree inspection found an incorrectly exposed WebGL fallback message; the embedded fallback was hidden from accessibility when the real scene is available. This inspection does not establish VoiceOver spoken navigation. |
| Live Gemini direction | Actual Google and application HTTP 200 for a slow kitchen-island reveal followed by the main bedroom: 40 seconds, four valid camera shots, requested order/subjects/height preserved. Provider time was 3,526 ms; application time was 3,996 ms. The source-revision mismatch returned 409 without a second provider call. Anonymous request validation passed and the exact synthetic account/project were removed. |
| App render controls | A real UI-created job received HTTP 201, then cancellation, resume and final cancellation each received 200. Render action acknowledgement bodies are consumed before refresh. |
| Local service and Blender pipeline | All 31 service/recovery/Blender pipeline tests passed in the final suite. Coverage includes strict saved-camera validation, malformed camera transforms, queue admission, rejected-resume state preservation, dependency/disk rechecks, private directory/file symlinks, child termination after IPC disconnect, frame-integrity checks and a cancellation fence that takes effect before persistence yields. Both cancellation/completion race regressions passed. |
| Native multi-floor export | Two-floor GLB: 148 meshes. A separate L-shaped upper floor with stairs and outward-swinging door: 156 meshes. Actual Three.js loads/raycasts confirmed solid slabs, missing L-corner and stair aperture. Maximum bounds error 0.000477 mm. |
| Native saved cameras | The final pipeline checkpoint passed 31 focused service/Blender/recovery tests and an actual native export of three saved cameras plus the animated tour. Reopened `.blend`, Blender GLB reimport and Three.js loading preserved camera positions, directions, vertical FOV, full Unicode names and revision/floor associations. Malformed transforms are rejected. Injecting a failure in reopened-camera verification left no resumable build proof. Evidence: `output/spatial-saved-cameras-20260915/verification.json`. |
| Final app camera exports | Three groups passed on the completed production build: the full library retained an older camera, scene JSON/browser GLB included two distinct current upper-room/overview cameras, and an app-created native Cycles preview completed with both cameras preserved in its authenticated GLB download. Camera poses, vertical FOV and room/floor/stair/wall/opening associations passed; Unicode names survived. There were zero page errors and no horizontal overflow at 390px. The completed local job is `e0731f35-6d8a-497a-8e77-e191ee291c65`. |
| Final quality transitions | The production build preserved actual exported camera position/target/FOV and tour time through Light/Balanced changes in orbit-adjusted overview, room, walking and paused-tour modes. Playing tours stayed playing and advanced. Mouse look and semantic room/object picking worked, settled overview returned to zero draws, and genuine connected-context loss still exposed the usable 2D fallback. No page or network errors occurred. |
| Full Cycles film | The actual Metal/Cycles job completed: 20 seconds, 600 native 1920×1080 PNG frames, 30 fps, eight samples, encoded as H.264. All 600 PNG chunk checksums passed; FFprobe confirmed 600 frames and a 20-second duration. All 20 every-second contact-sheet views and a native living-room still were visually inspected. Total elapsed time was 3,001 seconds. |
| Film in the app | The paired UI opened the exact completed job as a blob video, reported 1920×1080 and 20 seconds, and played to the end: 600 decoded frames, one dropped frame, no media error. Seeks at 0.5, 5, 10, 15 and 19.5 seconds were captured; the complete app view and the 10-second kitchen frame were inspected. |
| Native cancellation/restart | A real Blender preview job was manually cancelled with its completed frame retained, resumed, then interrupted by stopping the local service. After service restart it recovered automatically and completed all six previews. The first frame's hash and modification time were unchanged; GLB/camera comparison also passed. This proves native preview-job recovery, rather than a second full-film recovery run. |
| Packaging/security | The isolated packaged Worker imports without checkout `node_modules`. Final same-origin OCR/PDF and DOMPurify import checks passed with zero page errors, external requests or CSP violations; one expected loopback renderer health request occurred. The malicious-SVG check removed active/external content, rejected entities/non-SVG input, preserved a normal drawing pixel and observed no script execution or external request. |
| Repository baseline | The pre-polish implementation at `e6fad7d` passed all 549 tests, zero failed, skipped or cancelled; test duration 320,433.0 ms. `check:ops`, locked install, production build, 23 fresh migrations, both Worker dry runs and zero-vulnerability audit passed. Its exact-head CI/CodeQL results are retained in `qa-artifacts/spatial-final/completion-checks.json`. The release follow-up runs the full gates again on its final source; earlier 540/542/546-test results remain historical checkpoints. |
| Migration/audit/build | Locked `npm ci`, production build, fresh 23-migration chain, production and staging Worker dry runs, and zero-vulnerability audit passed. After the print-only CSS adjustment, the production build and both Worker dry runs passed again. |

Browser evidence and screenshots are in ignored local directories:

- `qa-artifacts/spatial-import-editor/`: final nine-group report, 28-file source manifest, reviewed PDF/image/editor/3D screenshots and exported edited scene.
- `qa-artifacts/spatial-import-security/`: malicious-SVG sanitization and normal-pixel comparison.
- `qa-artifacts/spatial-library/`: eight recovery groups, camera/tour draft downloads, desktop camera-conflict and mobile tour-conflict screenshots. The earlier renderer-pairing screenshot is separate historical evidence.
- `qa-artifacts/spatial-ui/`: desktop, 390px viewport, keyboard, reflow and fallback.
- `qa-artifacts/spatial-print-archive/`: actual A4 PDF and Poppler image, real Chrome 200% zoom screenshot, and archived plan/tour/render screenshots with the zero-mutation report.
- `qa-artifacts/spatial-cross-browser/`: eight checks per Firefox/WebKit engine, engine versions, zero-error reports and settled desktop/editor/mobile screenshots.
- `qa-artifacts/spatial-render-ui/`: actual create/cancel/resume and render action styles.
- `qa-artifacts/spatial-film-ui/`: completed-job metadata, whole-video playback counters and five sought frames.
- `qa-artifacts/spatial-live-gemini/`: real provider/app result, anonymous-request and source-fence checks, successful UI screenshot, and the preserved first failed attempt.
- `qa-artifacts/spatial-ids/`: UUID fallback unit and browser checks, including actionable errors when secure entropy is unavailable.
- `qa-artifacts/spatial-phone-static/lan-edit-verification.json`: real LAN HTTP browser environment, edited scene, screenshot and exact source/served-asset hashes. This is desktop Chrome with a mobile viewport, not a physical phone.
- `qa-artifacts/spatial-final/native-accessibility-resume.json`: actual VoiceOver runtime, native spoken-text probe, restored settings and the physical iPhone authentication limit.
- `qa-artifacts/spatial-final/final-checks-lan-fix.json`: 546-test local result, exact-commit CI/CodeQL results, source/served-asset verification and temporary LAN-server cleanup.
- `qa-artifacts/spatial-viewpoint-export/verification.json`: final current/older library exports, actual browser GLB poses and metadata, completed native app preview and authenticated GLB verification. The first harness failure is preserved separately: it assumed TRS fields where the valid browser GLB uses matrices; the final harness composes the actual scene graph matrices without changing runtime export code or relaxing tolerances.
- `qa-artifacts/spatial-performance/quality-transitions-production/verification.json`: final production camera lifecycle, picking, idle rendering and genuine context-loss checks.
- `qa-artifacts/spatial-final/completion-checks.json`: final 549-test run, required local gates, source/build/film hashes, final browser results and exact-head checks.

The saved-camera export journey can be repeated with
`scripts/check-spatial-viewpoint-export.mjs`. Set `SPATIAL_UI_ORIGIN` to the
local app origin. Supplying `SPATIAL_PAIR_FILE` with the existing renderer's
private pairing-code file additionally creates and completes a real preview
job; the code itself is never printed. The harness verifies separate current
and older camera downloads, actual browser GLB camera poses and geometry
associations, and the authenticated native GLB when paired. It preserves its
own completed local job and records evidence under
`qa-artifacts/spatial-viewpoint-export/`. Browser performance methodology and
budgets are in [spatial-performance.md](spatial-performance.md).

The strict-CSP import checkpoint verified the build from `2026-09-14T12:04:02.957Z`
at `2026-09-14T12:07:16.916Z`. Its manifest includes every spatial JS/JSX/CSS
module, the SVG sanitizer and camera/tour review components, relevant tests,
`package.json` and `package-lock.json`, plus the built HTML hash. The aggregate
source SHA-256 is
`e112115b09776e5d58868a58f58db4c0120acb3fc6cd8f335ffdc71de30f280e`.
No spatial source file was newer than that build at verification time. The
subsequent print-only CSS adjustment has its own A4/zoom/archived evidence and
successful production rebuild; the earlier manifest is preserved as the exact
import checkpoint, not relabelled as a later build. Historical failure captures
remain available; the latest report files identify the completed runs.

Native GLB evidence is in `output/spatial-v2-export-verified/` and
`output/spatial-v2-door-irregular-proof/`. Generated artifacts and credentials
are excluded from Git. Completed Cycles output and its independent native
recovery evidence are in `output/spatial-cycles-film/`, including
`video-evidence.json`, `native-recovery-evidence.json`, `tour.mp4`,
`tour-contact-sheet.jpg` and `living-room-1080p.png`. The prior Eevee film remains
historical evidence and is not used to establish Cycles completion.

## Final checks and limits

The first expanded full suite was stopped after two existing brief-revision tests
hit their unchanged 180-second limits while the 16 GB host also rendered Cycles.
Failures are preserved in `/tmp/grihagrid-full-check-contended.log`; they are not
waived, and no assertions/timeouts were relaxed. After the completed film
released those resources, `npm run check` passed all 540 tests and `check:ops`.
The successful run is recorded in `/tmp/grihagrid-full-check-final.log`.
The locked install, migration check, audit, production build and both Worker
dry runs also passed. The print-only CSS adjustment was then checked through
the actual A4/zoom/archived browser journey, a new production build and both
Worker dry runs.

Exact-head CI and CodeQL results are attached to
[draft PR #76](https://github.com/prakhar267/grihagrid/pull/76)
and must be green for this verification checkpoint. Local test evidence does
not establish a deployment or replace those remote checks.

The existing Gemini credential was configured in the ignored local secret file
with owner-only permissions. No credential was created, rotated or disclosed;
no billing or remote deployment was enabled. The first real request reached
Google successfully but the application correctly rejected its direction.
The response schema had made explicitly requested camera height and shot
preferences optional, and its prompt did not reserve travel time. The schema
now requires the requested values and lets the geometry engine allocate timing
unless a shot duration was explicitly requested. Independent validation remains
strict. Fifteen focused intent/API checks passed, including malformed output
rejections against real local D1.

A subsequent real `gemini-3.6-flash` request passed end to end at
`2026-09-14T14:31:03.069Z`. A separate local observer around the packaged Worker
delegated the original request to Google and returned the original response;
it recorded only bounded status/count/timing/model/validation metadata. It
observed exactly one provider request, including after the stale-revision test.
No raw provider body, secret or original freeform instruction was logged. The
UI screenshot and exported tour validation establish the completed direction
journey; they do not claim a separate Blender film of that exact AI-generated
tour. The local parser continues to label its own output separately.

Preparing the phone preview exposed a real compatibility issue: browsers can
omit `crypto.randomUUID` on LAN HTTP while still providing
`crypto.getRandomValues`. Spatial object, viewpoint and request IDs now use
native UUIDs when available and otherwise construct UUIDv4 from 16 secure random
bytes. If neither API works, the editor reports an error before creating an
object. Request IDs retain the existing exact-body retry behavior. Four focused
unit tests passed, along with browser checks for drawing corrections and absent
entropy. A separate Chrome journey against actual LAN HTTP confirmed the native
insecure-context environment without injecting or replacing crypto. It saved a
viewpoint and created a floor, room, perimeter walls, chair, door and window,
then accepted the concept and exported a valid model with unique IDs. There were
no uncaught page errors or horizontal overflow at 390 pixels. This establishes
the LAN browser path; physical-device testing remains separate.

VoiceOver was started without its tutorial and its real runtime was observed.
Native Safari navigation and copy-last-spoken commands did not yield verifiable
spoken output in the temporary native TextEdit probe. Its original off setting
and disabled caption panel were restored, and the temporary document was
discarded. A later attempt to enable scripting was interrupted; fresh native UI
inspection confirmed that scripting remained disabled and VoiceOver remained
off. No AppleScript was executed. Physical iPhone testing had stopped at iPhone
Mirroring's separate login prompt. The user subsequently deferred both tests;
neither is claimed as passed. Chrome viewport emulation, headless WebKit,
native Safari UI inspection and accessibility-tree inspection are not substitutes
for physical phone or spoken screen-reader testing.

Recognition follows legible straight and slightly uneven plan strokes at any
angle, with dimensions calibrated and all geometry reviewed by the user.
Rotated, skewed and simple concave outlines retain their visible shape; this
does not rectify photographic perspective. Curved walls, overlapping outlines,
heavy annotation and strong distortion still need explicit tracing or vertex
correction. Schema v2 supports up to
four floors, 48 simple polygon rooms and eight stair connections. Authored assets
are procedural concept geometry with improved materials and lighting. These are
bounded capabilities, not a claim of unrestricted reconstruction or photorealism.

### Bounded recognition acceptance — 2026-09-15

The 18 focused recognition tests pass on actual generated RGBA raster inputs.
They cover rotations of 5°, 17°, 37°, 73° and −23°, a skewed quadrilateral,
chamfered and triangular rooms, a rotated concave L outline, uneven stroke
thickness with 2.5-pixel wobble, and a shared diagonal wall with a doorway. The
accepted single-room fixtures require the expected corner count, corners within
5–6 source pixels, area error below 4%, and a valid shared v2 model after
calibration. A retained SVG-rendered PNG with actual room labels and dimension
text preserves two rooms, five walls and one door at 0°, 17° and 37°. A tightly
cropped one-pixel boundary also remains a valid observed room. The 1,400 × 1,000 input permits a 9-pixel corner tolerance after
bounded downsampling. Separate cases reject blank, unfinished, excessive-gap,
filled-dark (including smaller 120/200-pixel solid squares), nested,
small-annotation, circular, deterministic sparse-noise and
open jagged inputs. These fixture bounds describe the checks performed, not an
accuracy guarantee for arbitrary drawings.

`tests/drawing-recognition-angles.test.mjs` and its deterministic raster fixture
module retain the acceptance cases. `scripts/check-spatial-recognition.mjs`
writes source hashes, PNG fixtures and the before/after comparison to
`qa-artifacts/spatial-recognition/`. Against the previous recognizer at `e6fad7d`,
five rotated/skewed/concave/uneven examples improve from zero detected rooms to
their expected one or two rooms; blank and unfinished examples remain rejected.
The reusable browser journey additionally checks calibration, mandatory review,
review invalidation on rerun, model creation and accepted JSON export. Its
browser result is recorded separately in `verification.json` when run.

The final production bundle passed both nine-group browser journeys on port
8790. New PNG checks cover rotated/shared-door/skewed/concave/uneven acceptance,
blank/solid-fill/unclosed rejection, calibration plus mandatory review,
approval reset after rerunning recognition, a changed threshold followed by a
second upload, and a valid accepted JSON export. The original nine groups
retain SVG/PNG/PDF import, genuine local Tesseract OCR and independent editor
operations. Both runs had zero page errors or external requests; the original
also recorded zero CSP violations. `final-freeze.json` records their source
hashes and completion. A stale Vite dependency failure is preserved as an earlier
checkpoint and superseded by these fresh production-bundle checks.

### Visual polish and release acceptance — 2026-09-15

The customer journey remains drawing import, calibration and explicit review,
shared 2D/3D editing, room/tour navigation, saved viewpoints and a paired local
Blender preview. Acceptance requires the supported drawing fixtures above to
retain their observed corners, ambiguous fixtures to remain blocked, and the
viewer to preserve camera state within its existing graphics budgets.

The polished browser passed Chrome/Firefox/WebKit visual checks, the complete
camera/quality lifecycle and nine behavior checks each in Firefox and WebKit.
Six Chrome production profiles measured 59.97–59.99 rendered FPS with zero idle
overview draws. The decorative ground overlap was removed; canonical geometry
did not change. See [spatial-visual-polish.md](spatial-visual-polish.md) and
[spatial-performance.md](spatial-performance.md) for retained screenshots,
source hashes and measurement scope.

The updated Blender material recipe produced six real Cycles/Metal previews at
16 samples in 37.95 seconds. All 315 mesh IDs/bounds and the tour camera survived
GLB export/reimport and reopened `.blend` verification; maximum bounds error was
0.000954 mm. Two separately rendered 32-sample native 1920×1080 stills passed
visual inspection. Their settings and SHA-256 hashes are retained in
`output/spatial-polish-20260915/detail-verification.json`. The earlier 20-second
film remains evidence for the previous material recipe, not a rerender claim.

The actual local app also paired and completed a new native preview with a
saved overview camera in its downloaded GLB: job
`e11b66bf-1220-438c-bd64-63fda30a4000`. Its preview decoded at 633×356, with no
page or failed-request errors. The setup panel now supplies the current exact
app origin, so HTTPS deployment origins can be explicitly allowed by the local
renderer. `scripts/check-spatial-hosted-render.mjs` checks the configured hosted
app against an exact release ID and its real CSP, browser local-network
permission, origin-bound pairing, completed preview and camera-bearing GLB.
Its failure diagnostics withhold private Playwright call logs; a real disabled
pairing-input timeout with a synthetic sentinel confirmed no disclosure or
pairing screenshot. That check read no real pairing credential.

Release readiness and post-migration evidence now require all three spatial
tables, 23 columns and six immutable/archive guards from migrations 0022/0023.
The existing candidate canary saves/reloads a model, tour and camera library,
rejects a stale revision and four archived writes, then proves exact synthetic
project cleanup including all three spatial tables. The existing rollback
canary retains compatibility with the previous Worker. All 42 focused release,
readiness and real-D1 API checks passed. A separate isolated subprocess proved
both canary entry points load without project dependencies; the privileged
runner uses a reviewed synthetic JSON fixture. Worker packaging includes the
shared readiness manifest.

The authorized release uses the existing protected workflow: exact-head CI and
CodeQL, reviewed squash merge, exact-main validation, verified protected D1
exports and Time Travel bookmarks before migrations, staging canaries before
production, and at least 30 minutes of monitoring against the exact production
version. iPhone and spoken VoiceOver remain deferred. No paid launch or upload
activation is included.
