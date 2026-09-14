# Spatial studio verification — 14 September 2026

This report covers the expanded local implementation on `agent/spatial-camera-tours`.
No deployment, remote migration, payment activation or paid infrastructure was performed.
Completed local checks and remaining external verification limits are recorded below.

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
| Core geometry and direction | 29 focused checks passed, including exact swept clearance, the scaled 13-metre plan's narrow door passage, blocked partitions, door-to-window conversion and directed camera intent. These checks also passed in the complete 540-test suite. |
| Private storage | Ten dedicated D1/API checks passed, including ownership, origin/CSRF, immutable revisions, CAS, idempotency, stale cameras, archival and deletion. The account-lifecycle export regression also passed in the complete repository suite. |
| Private browser journey | All eight camera-library/recovery groups passed. Both camera and tour retries reused an exact request after a real server commit with its response deliberately dropped, without duplicate revisions. Independent authenticated contexts exercised camera merge conflicts, both tour conflict decisions, draft downloads, preservation of unrelated camera edits, stale-camera deletion, the scaled 40-second directed tour and removal of a directed stop. |
| Existing studio journey | The final nine-group run on port 5277 passed with zero page errors: desktop/keyboard, replacement-study discard restoring valid floors and stops, stale/rebuild behavior, private concept/tour save and reload/history through the Worker, scene export, 390px layout, reflow/reduced motion and WebGL fallback. It confirms the final local Worker accepts authorized writes from the preview origin. Mobile is viewport emulation. |
| Actual browser zoom and print | Chrome Settings page zoom was set to 200% in an isolated profile: CSS width changed from 1440 to 720, device-pixel ratio from 1 to 2, and visual viewport scale stayed 1. Scroll width remained 720 and keyboard focus was retained. The actual one-page A4 PDF was rendered with Poppler and inspected: all eight room labels are readable, with editor/import/scaling controls hidden. |
| Archived browser project | A real archived Worker project with concept, tour and camera revision 1 stayed readable. Drawing/import, floor, viewpoint, tour-editing, AI and new paired-render mutation controls were disabled. No mutation request occurred and saved revisions stayed unchanged. The exact synthetic project and account were cleaned up successfully. |
| Firefox and WebKit | Each engine passed eight checks: actual WebGL rendering; tour play, exact pause, pointer takeover and resume; keyboard room focus; numeric room/furniture edits and undo/redo; 390px editor/viewer reflow; 720px reflow; and reduced motion. Both reported zero page errors, console errors or failed requests. Settled screenshots were retaken after the camera fade completed. These are headless engines, not physical devices or the native Safari application. |
| Native Safari | Actual Safari 26.5.2 rendered the furnished scene. Native UI/accessibility-tree inspection found an incorrectly exposed WebGL fallback message; the embedded fallback was hidden from accessibility when the real scene is available. This inspection does not establish VoiceOver spoken navigation. |
| Live Gemini direction | Actual Google and application HTTP 200 for a slow kitchen-island reveal followed by the main bedroom: 40 seconds, four valid camera shots, requested order/subjects/height preserved. Provider time was 3,526 ms; application time was 3,996 ms. The source-revision mismatch returned 409 without a second provider call. Anonymous request validation passed and the exact synthetic account/project were removed. |
| App render controls | A real UI-created job received HTTP 201, then cancellation, resume and final cancellation each received 200. Render action acknowledgement bodies are consumed before refresh. |
| Local service and Blender pipeline | All 16 service/recovery tests and 12 Blender pipeline tests passed in the full suite. Coverage includes queue admission, rejected-resume state preservation, dependency/disk rechecks, private directory/file symlinks, child termination after IPC disconnect, frame-integrity checks and a cancellation fence that takes effect before persistence yields. Both cancellation/completion race regressions passed. |
| Native multi-floor export | Two-floor GLB: 148 meshes. A separate L-shaped upper floor with stairs and outward-swinging door: 156 meshes. Actual Three.js loads/raycasts confirmed solid slabs, missing L-corner and stair aperture. Maximum bounds error 0.000477 mm. |
| Full Cycles film | The actual Metal/Cycles job completed: 20 seconds, 600 native 1920×1080 PNG frames, 30 fps, eight samples, encoded as H.264. All 600 PNG chunk checksums passed; FFprobe confirmed 600 frames and a 20-second duration. All 20 every-second contact-sheet views and a native living-room still were visually inspected. Total elapsed time was 3,001 seconds. |
| Film in the app | The paired UI opened the exact completed job as a blob video, reported 1920×1080 and 20 seconds, and played to the end: 600 decoded frames, one dropped frame, no media error. Seeks at 0.5, 5, 10, 15 and 19.5 seconds were captured; the complete app view and the 10-second kitchen frame were inspected. |
| Native cancellation/restart | A real Blender preview job was manually cancelled with its completed frame retained, resumed, then interrupted by stopping the local service. After service restart it recovered automatically and completed all six previews. The first frame's hash and modification time were unchanged; GLB/camera comparison also passed. This proves native preview-job recovery, rather than a second full-film recovery run. |
| Packaging/security | The isolated packaged Worker imports without checkout `node_modules`. Final same-origin OCR/PDF and DOMPurify import checks passed with zero page errors, external requests or CSP violations; one expected loopback renderer health request occurred. The malicious-SVG check removed active/external content, rejected entities/non-SVG input, preserved a normal drawing pixel and observed no script execution or external request. |
| Repository validation | The pre-live-Gemini checkpoint's `npm run check` exited 0: 540 tests passed, zero failed, skipped or cancelled; test duration 414,830.6 ms. `check:ops` also reported valid operational configuration. The later live integration fix passed 15 focused intent/API checks; its final full-suite/CI results are recorded on the draft PR. |
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
- `qa-artifacts/spatial-final/native-accessibility-resume.json`: actual VoiceOver runtime, native spoken-text probe, restored settings and the physical iPhone authentication limit.

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

VoiceOver was started without its tutorial and its real runtime was observed.
Native Safari navigation and copy-last-spoken commands did not yield verifiable
spoken output in the temporary native TextEdit probe. Its original off setting
and disabled caption panel were restored, and the temporary document was
discarded. No VoiceOver navigation pass is claimed. iPhone Mirroring remains
explicitly locked at a Mac
login/unlock prompt; the user has not unlocked it, so physical iPhone traversal
is unverified. Chrome viewport emulation, headless WebKit, native Safari UI
inspection and accessibility-tree inspection are not substitutes for physical
phone or screen-reader testing.

Recognition currently targets legible orthogonal plan strokes, with dimensions
calibrated and all geometry reviewed by the user. Ambiguous/freehand/diagonal
plans may need explicit tracing and vertex correction. Schema v2 supports up to
four floors, 48 simple polygon rooms and eight stair connections. Authored assets
are procedural concept geometry with improved materials and lighting. These are
bounded capabilities, not a claim of unrestricted reconstruction or photorealism.
