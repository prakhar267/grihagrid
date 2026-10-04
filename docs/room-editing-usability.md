# A direct path from a room to its edits

## Customer outcome

A homeowner inspecting a room in 3D can edit that exact room in one action, see
basic room facts before technical controls, and return to the same room to check
the result. Architects retain the boundary-coordinate tools and drawing modes.

Journey: select a room → Edit this room → rename or adjust it → See this room in
3D → Review changes → accept the concept → rebuild/play the tour.

Acceptance: direct editing selects the correct room and floor and moves keyboard
focus to its inspector, including repeated visits after selecting furniture.
Room facts use the shared model. Boundary coordinates and corner tools start
collapsed. The preview action preserves selection and never accepts a revision.
Unapplied drawing/component forms, undo history, archived and conflict guards,
and tour freshness rules remain intact. Mobile and keyboard paths work.

KPI: room selection to its edit controls requires one action (previously two
navigation choices plus finding the inspector); direct preview requires one
action. Verify task completion in the browser. No user-research or conversion
improvement claim is implied by these engineering checks.

## Audit evidence

Current-run screenshots and notes are in
`reports/usability-2026-10-03-guided-editing` under the HouseForge root.
The 3D room card previously repeated generic instructions without an edit action;
the editor displayed all boundary coordinates before explaining the room.

## Verification

Browser verification on 4 October 2026 (Asia/Kolkata):

- Selected Main bedroom in 3D, entered its inspector with Enter, renamed it,
  previewed the same room, returned, undid and redid the change.
- Selected furniture, then repeated the room shortcut; it returned to the room
  inspector rather than leaving the furniture selected. Focus reached the
  inspector and then its inputs with Tab.
- Repeated the route for Upper reading gallery, retaining Upper floor at 3.2 m.
- Collapsed shape controls expand with the keyboard. A blank room name restores
  the previous value and gives a plain-language error without changing geometry.
- Review remained mandatory. Playback stayed disabled until accepting and
  rebuilding; the two-floor tour reached 30/30 seconds, including the upper room.
- At 390 × 844 and native Chrome 200% zoom: no horizontal page overflow, room
  controls reachable, keyboard focus retained. Restored viewport and zoom.
- Reduced-motion toggle now also disables smooth page scrolling.
- An empty third floor retains its Plan this floor action. Discard restores the
  accepted two-floor layout. Starting the shortcut with an open drawing import
  returns to that import with a clear finish/cancel instruction, preserving it.
- Downloaded scene JSON contains both floors, stair, model revision 3 and matching
  tour revision 3. Downloaded drawing HTML contains the upper room and print rules.
  The browser download-event helper timed out; actual files in Downloads confirmed
  success. No local HTML print-render claim is made for this run.
- Browser error log was empty. Existing server-side archive, concurrency and
  pending-component protections are unchanged and remain covered by the suite.

The project-wide check and protected release evidence are recorded separately.
Physical iPhone, spoken VoiceOver and moderated user research remain unverified.


## Local verification timing correction

The first full run passed 960/961 tests; a focused rerun reproduced the remaining
TERM-resistant process fixture timeout. That assertion timed interpreter/group
startup as part of the cleanup budget. The fixture now bounds startup separately
and measures observation completion/cleanup from the child's monotonic start
record. The 4.5-second assertion, forced-exit checks, process-reaping checks and
production cleanup behavior remain unchanged. The child's timestamp prevents a
late parent poll from hiding elapsed cleanup time. Full checks are repeated on
the corrected test, with the original failure logs retained in the audit folder.
