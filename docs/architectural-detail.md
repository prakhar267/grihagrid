# Architectural detail across the house studio

## Customer problem and acceptance

The Jaipur/Delhi G+2 journeys work, but the output lacks the dimensions, opening
schedules, fixtures, furnishing and framing that make a house drawing useful.
The bounded outcome is a measurable architectural concept drawing set and a
furnished shared model, not a certified construction or services package.

Journey: create/import a concept → inspect its dimensioned sheet → add/edit
room details → review and accept → explore furnishings → rebuild a room tour →
export the same drawing/model and render actual previews.

Acceptance measures:

- Every populated floor has a legible scaled sheet, measured room/overall
  dimensions, north reference, door/window tags, schedules and stair levels.
- Elevations and the stair section derive their positions and heights from
  the same model; exported sheets preserve these measurements and source revision.
- Kitchen/bathroom/bedroom/living/study furniture is recognizable and editable;
  additions respect room boundaries, other objects and usable navigation.
- Existing geometry is preserved when adding detail. A proposed addition goes
  through the existing Change Study and invalidates old camera geometry.
- Browser 3D, GLB and Blender consume identical fixture primitives. Room cameras
  provide a wider room view and individual objects can be inspected.
- Jaipur and Delhi G+2 examples complete the updated drawing → 3D → tour →
  export/render journey without lost rooms or disconnected floors.

KPI: both sample journeys complete, all requested rooms remain represented,
and dimensions/schedules match the exported model with no model or route errors.

## Drawing references

- [Autodesk: floor plans](https://www.autodesk.com/solutions/aec/floor-plans-with-autocad)
  explains scaled walls, doors, windows, fittings and dimensions.
- [Portland residential drawing examples](https://www.portland.gov/ppd/documents/plans-you-need-building-permit-brochure-6/download)
  illustrates floor plans, elevations, sections, stair details and fixture notation.
  Used for drawing communication only; its jurisdictional rules do not apply to India.
- [Sweet Home 3D features](https://www.sweethome3d.com/features/)
  provides a product reference for synchronized furnished plans, dimension lines,
  room areas, north reference and aerial/visitor views.

## Guardrails

Dimensions report model geometry and identify their basis. A room polygon is not
a certified carpet area. Site placement, structure, MEP sizing, approval rules and
construction details require project-specific input and professional design.
No invented columns, reinforcement, wiring, drainage or approval stamps are added.
Old accepted model records are never silently rewritten. No deployment or paid
activation is part of this change.

## Implemented workflow and verification (21 September 2026)

2D Plan opens measured A3 sheets with floor/overall dimension chains, room
extents and polygon areas, opening tags and schedules, floor levels, stair
riser/tread measurements, north reference and a scale bar. The editable model
remains mounted behind the Edit / furnish rooms switch so Undo survives mode
changes. SVG export and a self-contained HTML print set include all floors,
four model elevations, stair sections and a paginated complete opening schedule.
The sheet is zoomable independently of the page; metric and imperial labels
use the same millimetre source geometry.

Furnish this floor preserves existing objects and adds bounded room suggestions.
Unsupported or cramped placements are reported for manual editing. Six new
fixture types share editor validation and browser/GLB/Blender primitives: kitchen
counter, washbasin, shower, refrigerator, washing machine and puja unit. New brief
layouts start furnished. Existing version-1 film geometry remains unchanged;
version-2 scenes add skirting and window sills. Room cameras use a wider lens and
clear candidate positions favoring the primary furnishing's front.

The existing Jaipur/Delhi G+2 studies were edited and accepted in the running
studio. Jaipur revision 5 has 39 furnishings; Delhi revision 6 has 38. Delhi's
manually added kitchen window is retained. Both kitchen counters were dimensioned
and placed through the editor; Delhi's former counter/entrance-swing conflict was
removed. No rooms or walls were replaced. Three suggested showers (two Jaipur,
one Delhi) still require manual bathroom rearrangement; the furnishing helper
reports them rather than placing overlapping fixtures.

Verified: all six floor sheets, elevations and stair sections; metric/imperial
labels and 200% sheet zoom; per-floor furnishing, Undo/Redo and Change Study;
all 31 room selections in 3D; full 45/45-second tours ending on the second floor;
furnished-floor walking and saved before/after poses; old viewpoints marked stale;
scene JSON, GLB 2 exports, and real Blender CPU rendering with six completed
preview frames for each final revision. Final geometry, connectivity and tour
validation all pass. Local evidence is under
`../reports/jaipur-delhi-g2-2026-09-21/{jaipur,delhi}/detailed/`.

Chrome verified an actual 390 × 844 viewport: page scroll width stays 390 while
the 200% sheet scrolls within its 349-pixel container. Keyboard Enter switches
between drawing and editing. Native browser zoom shortcuts did not change the
browser scale, and native print output was not verifiable while the Mac was
locked; neither is reported as passed. The HTML print contract specifies A3
landscape at actual size. Physical iPhone and spoken VoiceOver remain deferred.

The full local regression run passed 873 tests. Fifteen detail tests, including
an additional final counter-orientation regression, passed in a focused run.
Clean install, fresh local migrations, both Worker dry runs, dependency audit
(zero vulnerabilities) and whitespace checks passed. The initial regression
caught changed legacy film primitives; restricting architectural trim to the
version-2 rendering path restored the legacy fixture and the full run passed.
Exact-head CI/CodeQL are the final draft-review gates. No merge or deployment.

A final live transition check found a queued tour effect restoring the old floor
while the user selected another floor during viewer remount. The effect now
checks the current camera mode before publishing a tour floor. Four immediate
completed-tour → plan → explore → ground-floor transitions stayed on the selected
floor, and all 26 focused detail/mode tests passed after the guard.

## Whole-house sections follow-up

Customer outcome: inspect how storeys, rooms, openings and stairs align vertically.
Journey: measured plan → adjustable building section → matching 3D section →
room/walking/tour → coordinated drawing export. Acceptance: both directions on
both G+2 studies, correct floor levels and aperture gaps, matching plan markers,
keyboard/mobile controls, and complete geometry in every exported model.
KPI: four city/direction journeys without changing accepted geometry or tour routes.
Sections are geometry coordination only; no structural or services specification
is inferred. Section clipping is presentation only and is disabled for walking,
room cameras, tours and render/export. Existing source revisions remain intact.

Implemented: A–A/B–B building section sheets with adjustable cut position, model
level dimensions, room intersections and hatched wall/slab cuts. Stair apertures
are subtracted from sectioned slabs, including concave outlines. A plan marker,
section sheet and full-height 3D cutaway share one coordinate. Drawing sets now
include both whole-house sections. Browser cuts are disabled in room, walking,
tour and render/export views; exported GLB materials never retain clipping.
Camera saving is disabled while cutting because a saved camera stores its pose,
not a section plane. Closing the section restores normal viewpoint saving.

A local Open saved scene JSON workflow validates bounded building, tour, current
cameras and optional brief before showing an explicit replacement review. Invalid
files and Cancel preserve the current study. New scene exports include the house
brief; older exports explain missing north/site information. This workflow is
limited to the demo and never overwrites private project revisions.

The existing Jaipur revision 5 and Delhi revision 6 geometry was restored through
this UI, with six current camera poses each. Their original briefs were recovered
from the earlier exported Markdown into separate sections/scene.json artifacts;
original exports and complete historical camera libraries remain preserved.
Both directions and keyboard cut positions match between 2D/3D. An invalid file
was refused without changing the house; review and cancellation preserve focus.
Chrome 390 × 844 has page width 390 and a contained 698-pixel sheet at 200% zoom.
Full local regression: 882 passed. Clean install, 24 fresh migrations, both
Worker dry-runs and dependency audit (zero vulnerabilities) passed. No release.

Jaipur's original automatic-device preview retry again exhausted disk space at
the final frame. A new CPU job 439ae657-15f5-4835-bca7-c5f772d96ab4 completed all
six frames with the exact model, tour and six saved viewpoints. Original failed
records are retained separately; no unrelated files were removed to make space.
