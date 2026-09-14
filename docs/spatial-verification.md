# Spatial studio verification — 14 September 2026

This report covers the expanded local implementation on `agent/spatial-camera-tours`.
No deployment, remote migration, payment activation or paid infrastructure was performed.
Verification remains in progress where explicitly marked below.

## Environment

MacBook Air M4, 16 GB RAM; Google Chrome, actual Safari 26.5.2,
Blender 4.5.9 LTS ARM64 with Metal, and FFmpeg. The app uses
`http://127.0.0.1:5277/explore`; the strict-CSP Worker preview uses port 8790
and an isolated `.wrangler/spatial-dev` D1 database. Browser account/project
fixtures are synthetic and cleanup targets only their exact identifiers.

## Current evidence

| Area | Observed result |
| --- | --- |
| Drawing to editable geometry | Nine browser groups passed under the real Worker CSP: SVG/PNG pixel recognition, actual local Tesseract OCR, two-page PDF decoding, keyboard calibration, opening selection, explicit review and export. A blank image produced zero invented rooms; manual tracing was clearly separate. |
| Layout editing | Rooms/shared vertices, furniture position/dimensions/rotation, doors/windows/hinge/swing, irregular upper room, connected stairs, floor add/delete, undo/redo and matching 3D passed. |
| GPU demand | Settled overview produced zero background WebGL draws; orbit/reset invalidated correctly, and entering a room resumed continuous rendering. |
| Core geometry and direction | 26 focused v1/v2, door and camera-intent checks passed before the final review fixes. Final suite remains required. |
| Private storage | Ten D1/API checks passed, including ownership, origin/CSRF, immutable revisions, CAS, idempotency, stale cameras, archival and deletion. Final account-export regression is in progress. |
| Private browser journey | Four groups passed: saved camera rename/delete, preservation across tour saves, independent browser-context reload, stale-view handling, rich 40-second direction and actual renderer pairing. |
| Existing studio journey | Eight desktop/mobile/reflow/keyboard/reduced-motion/fallback groups passed with zero page errors. Mobile is viewport emulation. |
| App render controls | A real UI-created job received HTTP 201, then cancellation, resume and final cancellation each received 200. Render action acknowledgement bodies are consumed before refresh. |
| Local service | 24 focused pipeline/service/recovery checks passed, including queue admission, rejected-resume state preservation, dependency/disk rechecks, private directory/file symlinks and child termination after IPC disconnect. |
| Native multi-floor export | Two-floor GLB: 148 meshes. A separate L-shaped upper floor with stairs and outward-swinging door: 156 meshes. Actual Three.js loads/raycasts confirmed solid slabs, missing L-corner and stair aperture. Maximum bounds error 0.000477 mm. |
| Full Cycles film | Actual 20-second, 600-frame, native 1920×1080, 30-fps, eight-sample job is rendering. Completion/encoding/inspection remain pending. |
| Native cancellation/restart | Unit/service coverage passes; actual interrupted Blender frame retention/recovery remains pending until the film releases the single worker. |
| Packaging/security | Isolated packaged Worker imports without checkout `node_modules`; same-origin OCR/PDF assets and strict CSP passed. No external drawing/OCR requests or CSP violations occurred in the import journey. |
| Migration/audit/build | Fresh 23-migration chain, both Worker dry runs and zero-vulnerability audit passed at the integration checkpoint. Required exact final checks remain pending. |

Browser evidence and screenshots are in ignored local directories:

- `qa-artifacts/spatial-import-editor/`: report, source hashes, PDF/image/editor screenshots.
- `qa-artifacts/spatial-library/`: private camera and actual renderer journey.
- `qa-artifacts/spatial-ui/`: desktop, 390px viewport, keyboard, reflow and fallback.
- `qa-artifacts/spatial-render-ui/`: actual create/cancel/resume and render action styles.

Native GLB evidence is in `output/spatial-v2-export-verified/` and
`output/spatial-v2-door-irregular-proof/`. Generated artifacts and credentials
are excluded from Git. The prior Eevee film is historical evidence only;
it does not prove the new Cycles film has completed.

## Final checks and limits

The first expanded full suite was stopped after two existing brief-revision tests
hit their unchanged 180-second limits while the 16 GB host also rendered Cycles.
Failures are preserved in `/tmp/grihagrid-full-check-contended.log`; they are not
waived, and no assertions/timeouts were relaxed. The full suite must pass after
rendering releases those resources, alongside the required locked install,
migrations, Worker dry runs, audit and exact-head PR checks.

Gemini API tests use a mock provider response to verify anonymous subject/room
aliases, strict output validation, quota and source-revision fencing. The actual
local `GEMINI_API_KEY` is unavailable, so no live Gemini success is claimed.
The UI's local parser labels its own output honestly and does not make an AI call.

Actual Safari rendered the 3D scene. Inspecting its accessibility tree exposed
fallback text that should have been hidden while WebGL worked; this was fixed.
The Mac then locked. iPhone Mirroring also requires the user's login. Physical
phone traversal and actual VoiceOver are still unverified; Chrome viewport
emulation and accessibility-tree inspection are not substitutes for them.

Recognition currently targets legible orthogonal plan strokes, with dimensions
calibrated and all geometry reviewed by the user. Ambiguous/freehand/diagonal
plans may need explicit tracing and vertex correction. Schema v2 supports up to
four floors, 48 simple polygon rooms and eight stair connections. Authored assets
are procedural concept geometry with improved materials and lighting. These are
bounded capabilities, not a claim of unrestricted reconstruction or photorealism.
