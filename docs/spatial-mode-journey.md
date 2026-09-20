# Cross-mode floor editing verification

## Outcome and acceptance

A house edited in 2D must remain usable in 3D Explore, walking, Camera Tour,
saved viewpoints and exports. Acceptance means the selected floor matches the
camera, new rooms have useful entry views, stairs preserve room access, tours
include the intended floors, and revision changes have a clear recovery path.
The local demonstration is tested without changing the user's original study.

## Fixes from the 21 September browser journey

- The 2D editor stays mounted across mode changes, preserving Undo/Redo. Accepting a revision resets its history; discarding a study clears stale draft history.
- Empty floors show a direct **Plan this floor** action and disable walking.
  Populating a floor selects a room on that floor, rather than a ground-floor
  fallback. Unfurnished rooms face into the room instead of vertically down.
- Stair suggestions validate every room in the connected floor group. A stair
  with usable landings is rejected if it blocks a previously reachable room.
  Other unfinished floors can still be connected separately.
- Unaccepted layouts explain **Review → Accept → Rebuild** at the viewer. A
  rebuild cannot report success while the layout still needs acceptance.
  Demo Change Study checks connectivity, matching the private save requirement.
- Standard tours distribute their twelve-stop budget across populated floors.
  Standard itineraries follow added/removed rooms; custom orders remain intact.
  **Use whole-house route** offers an explicit reset and reports floor coverage.
- Stops and room choices include floor names. Local direction qualifies copied
  room names with a named floor or “upstairs.” Scrubbing, including a small move
  near the previous playback position, synchronizes the floor selector and
  saved-camera floor metadata.
- The exterior establishing orbit fits the full house height, preventing tall
  houses from losing their roof at the edge of a rendered frame.
- Mobile walking, transport and stop controls have 44px targets. Offline render
  errors explain reconnection and do not claim an empty render history before
  jobs have loaded.
- Local renders offer an explicit CPU fallback when automatic GPU rendering
  exhausts memory. The selected device persists with each job and through
  service restart; resuming keeps that job's original settings.

## Evidence and limits

`tests/spatial-mode-journey.test.mjs` covers floor-scoped entry, forward walking,
blocked stair refusal, all-floor stop allocation, duplicate room names,
four-level camera routes, unfinished floors and floor-specific instructions.

Fresh browser evidence, downloaded JSON/GLB, actual camera-position comparisons
and native Blender preview artifacts are in
`../reports/mode-journey-2026-09-21/` relative to the repository root. The report
records each tested operation and distinguishes UI playback, native rendering,
provider availability, failures and recovery. This is local implementation and
draft review only; physical iPhone and spoken VoiceOver remain deferred.
