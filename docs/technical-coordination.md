# Structure and services coordination

## Customer outcome

A homeowner can mark requested electrical and water points; an architect or engineer
can enter structural member sizes and service runs, edit them per storey, identify
geometric interference and issue a measured coordination set from the same saved
house. The workflow is Plan → Structure & services → place/edit → inspect issues →
Change Study → accept → rebuild tour → inspect 3D → save/export/reopen.

Acceptance: all components retain stable IDs, floor-relative positions, entered
sizes, system labels and notes across immutable private revisions, 2D sheets, 3D,
scene JSON, GLB and Blender. Edits are undoable, invalid input leaves the previous
model intact, independent floors remain independent, and geometry edits invalidate
old camera routes. Structural obstructions participate in walking clearance.
Deleted floors remove their own components. Changes from another editor cannot be
undone by restoring an obsolete full-model snapshot. Empty disciplines have a
visible authoring path. Keyboard, mobile, zoom, print and error states are verified.

KPI: Jaipur and Delhi each complete the coordinated three-storey journey with no
lost architectural geometry or service records; exact-source CI and security checks
pass. This is a complete authoring outcome, not a claim that every engineering
calculation or external production dependency is finished.

## Boundaries

Member sizes, pipe sizes and device ratings are designer inputs. No invented
reinforcement, foundation capacity, circuit protection, hydraulic sizing or city
approval is generated. Interference checks concern geometric intersections, not
code compliance or a complete clash detection service. Pipe geometry describes
entered straight runs; no implied flow direction, slope, concealed connection or
fabrication fitting. Quantities describe modeled components, not a priced BOQ.
Existing paid, upload and external-provider activation gates remain unchanged.

## Saved data and compatibility

V2 accepts an optional `coordination` array of up to 120 components, subject to the
existing whole-model size limit. Each record has `id`, `kind`, `label`, `floorId`,
`position: [x,y,baseAboveFloor]`, `size: [width,depth,height]`, `rotation` in radians,
`system` and `notes`; electrical records may also have `loadWatts` or null.
Dimensions are millimetres. Straight pipes have one length and two equal diameters.
No migration is required. Models without the collection retain existing geometry
and tour signatures. Copying a floor assigns fresh component IDs; clearing or
deleting a floor removes its own components. Resizing a house moves component
centres without silently resizing designed members.

Authoring history is local to component edits and resets when another editor
changes the model. Unapplied form drafts block Change Study acceptance. Exported
coordination sheets always use millimetres; paginated schedules retain notes.
Tap movement has a bounded minimum duration so quick touch/keyboard presses cannot
vanish between rendering frames. It uses the same collision resolver as held input.

Product reference: [Autodesk MEP systems workflow](https://www.autodesk.com/learn/ondemand/module/create-mep-systems-in-revit)
separates placement, connection, system information and coordination. This informs
the authoring journey; it supplies no engineering sizes or jurisdictional rules.

## Local acceptance evidence — 21 September 2026

The Jaipur revision 6 study contains ten entered components; Delhi revision 7
contains nine. Both preserve their original architectural collections exactly.
Real form editing covered invalid placement, focused errors, add/remove, Undo/Redo,
pending-form acceptance blocking and clearing stale history after another editor
changes the house. Actual local D1 tests preserve component records across saves
and reject invalid floor references without inserting a revision.

Both 45-second tours were rebuilt after acceptance and reached the second floor.
Three short walking taps on each of the six floors moved the saved camera by
396–453 mm; every final pose passes the walking validator. Each exported scene
contains six current saved viewpoints. GLB inspection finds every component.
Native Blender round trips checked all 652 Jaipur and 626 Delhi primitives and
all six saved cameras per city, with maximum bounds error below 0.001 mm.
This run built native scenes; previous preview frames remain historical evidence.

Chrome's 390 × 844 viewport had zero horizontal page overflow, keyboard component
selection focused the form, and invalid placement focused its alert. Native 200%
zoom reported DPR 4 with page/viewport widths both 735 px. The Jaipur HTML set
contains 19 sheets and the actual Chrome print preview reported 19 pages; Delhi's
set contains 18 sheets. Physical printing, iPhone and spoken VoiceOver were not
tested. Browser consoles showed no errors; an upstream Three.Clock deprecation
warning remains. Existing production, payment, upload and provider gates were
not activated.

Artifacts and per-city verification JSON are under the workspace report
`reports/jaipur-delhi-g2-2026-09-21/{jaipur,delhi}/coordination/` (outside this repo).
The public draft PR remains the review boundary for this cut; passing authoring
checks is not structural design or a production deployment claim.
