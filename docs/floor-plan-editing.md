# Floor planning after adding a level

## Customer problem and acceptance

Adding a floor previously displayed only dashed outlines of the other floors,
with no starter plan and no room controls beside that empty state. The current
tool (including Pan) remained selected. A homeowner could reasonably think the
upper floor was uneditable.

The outcome is an explicit add-floor → choose/copy/draw → edit rooms → connect
stairs → review Change Study journey, using the existing architectural style.
Acceptance measures are working starting layouts on levels 2–4, no unintended
changes to other floors, usable room controls without precise canvas clicks,
atomic undo/redo, and no invalid geometry or silent replacement. Automatic
stairs must have usable landings and a traversable route through both floors.

## Behavior

- **Add floor** selects the new floor, resets Pan/drawing state and focuses its
  setup heading. Existing empty floors receive the same choices.
- **Two-bedroom floor**, **Family & study**, and **Open floor** create editable
  geometry at the indoor reference footprint of the nearest populated lower
  floor. Divided templates need at least 7 × 6 m; a smaller site can use an open
  floor, copy, or manual rooms.
- **Copy floor plan** copies indoor rooms, walls, windows and furniture with
  independent IDs. It preserves the source; outdoor ground and existing stairs
  are not copied. Outside-facing doors become windows on the copied level.
- **Add room** offers name, width, depth and X/Y position in metres, with an
  available starting position. Overlaps are rejected without changing the plan.
  Perimeter walls are included; doors and furniture can be added with the tools.
- The room list exposes **Edit** and **Remove** for each room on the active floor.
  Edit focuses the inspector; Remove is undoable. Removing a room does not
  delete unrelated loose walls elsewhere in the house.
- **Clear floor to choose another layout** explicitly confirms the affected
  rooms, walls, furniture and connecting stairs before clearing them in one edit.
  **Delete floor and contents** is also atomic, including loose walls. The ground
  floor and the house's final remaining room are protected.
- **Suggest connecting stairs** searches for a bounded straight run in overlapping
  indoor rooms. It checks walls, furniture, existing shafts, tread/riser bounds,
  landing room and the actual traversable route. It never moves existing rooms
  or furniture to force a fit. **Draw stairs from below** switches to the lower
  floor with the correct upper destination and the Stairs tool already active.
- All edits remain a layout study until accepted through the existing Change
  Study. Read-only/archived controls, source revisions and save conflicts retain
  the existing workspace protections. No API or migration change is required.

Starting layouts are concept plans. A rectangular reference is not a structural
assessment of the floor below. Stair suggestions can fail on tight or misaligned
plans; they are not a complete stair-design optimizer. The existing four-floor,
48-room and saved-model limits remain in force.

## Verification

`tests/floor-editor.test.mjs` exercises templates and copying across floors 2–4,
geometry/3D generation, room editing and removal, floor-scoped preservation,
narrow and occupied sites, invalid additions, atomic clear/delete, stair refusal,
four-level stair routing, and camera tours. Existing core, navigation and Worker
regressions also apply. Browser evidence and final checks are recorded in
`../reports/floor-editor-2026-09-21/` relative to the repository root and in draft
PR #83. Physical iPhone and spoken VoiceOver retain their existing deferral.
