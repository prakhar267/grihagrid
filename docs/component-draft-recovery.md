# Component form recovery

## Bounded outcome

A homeowner or designer may enter a component, inspect another module, resize
the house, open drawing import, or discard a layout study before returning to
Structure & services. These transitions must neither lose unapplied input nor
leave an old form able to restore or overwrite a changed component silently.

The acceptance metric is zero lost draft fields and zero stale component writes
across the transition matrix below. This is a local UI recovery correction;
component specifications, geometry schemas, APIs, AI providers, saved revisions,
and deployment controls are unchanged.

## Acceptance cases

- Opening and cancelling drawing import preserves component forms and undo state.
- Unedited selected forms follow external resize, layout undo and study discard;
  removed selections become empty forms, never implicit re-creations.
- Pending forms keep every entered field when their source changes or disappears.
  Apply and Remove are blocked until the designer explicitly loads the current
  component or discards the form. Unrelated changes do not create conflicts.
- Drafts remain independent on each floor and survive 2D, 3D and tour navigation.
- Replacing a house, generating a new brief layout, or discarding a study requires
  resolving unapplied component forms first. Merely inspecting an import does not.
- Accepted geometry continues through measured drawings, 3D, tour rebuild and
  scene/model export. Draft-only metadata never enters the shared model.
- Errors, conflict recovery and empty forms remain usable by keyboard, at 390 px,
  at 200% zoom and with reduced motion. Physical iPhone and spoken VoiceOver
  remain deferred under the existing task agreement.

## Baseline reproduction — 24 September 2026

On main `6b1a549`, entering a component label, opening drawing import, closing it
and returning to Structure & services produced an empty label. Adding a column
then discarding the study showed zero components while retaining the old label,
dimensions, Apply and Remove controls. These were reproduced in an isolated
local browser tab with synthetic data.

## Verification — 24 September 2026

The updated UI was exercised using the retained Jaipur (three floors / 16 rooms)
and Delhi (three floors / 15 rooms) scenes:

- Jaipur: import/cancel retained the exact draft text; scaling kept pending input
  and blocked Apply/Remove; a downloaded form retained its text and conflict;
  keyboard recovery loaded the current coordinates. Fractional coordinates from
  scaling remained editable. Component undo/redo and study discard restored the
  accepted source. Discarding a newly added column cleared its old selection.
- Independent ground/second-floor forms survived 3D and Camera Tour navigation.
  The pending notice returned focus to Structure & services. Study discard and
  review were blocked until pending entries were resolved.
- Delhi: clearing the second floor retained its pending form with a removal
  conflict; layout Undo restored the exact source, resolved the conflict and kept
  entered notes. The recovered edit was applied, reviewed and accepted.
- Both accepted edits rebuilt a 45-second tour covering three populated floors;
  playback advanced, upper-floor walking opened, and a current viewpoint saved.
  Both real browser scene JSON/GLB downloads were verified: Jaipur 652 and Delhi
  626 geometry nodes, zero transform error, matching floor/object identifiers,
  matching native Blender recipe primitives, and no draft metadata in the model.
  Native Blender jobs were not rerun for this form-only correction.
- Desktop and 390-pixel reflow passed. Actual Chrome 200% zoom showed a 735-pixel
  CSS viewport with scroll width 735; conflict controls remained readable and
  keyboard focus was visible. Zoom was restored afterward. Reduced motion,
  empty forms, conflict recovery, stale cameras/tours and renderer-offline state
  were checked. No browser console errors were captured; the existing Three.js
  Clock deprecation warning remains.
- The Delhi model-derived structure sheet and downloadable drawing/print set
  retained the accepted second-floor component. Print styling and drawing
  generation were unchanged.

Local exported evidence is retained outside the repository under
`reports/component-recovery-2026-09-24` in the enclosing HouseForge workspace.
Seven focused regression tests cover source reconciliation, independent floors,
resize, deletion, undo, missing sources and electrical load changes. Existing
archived/ownership/API protection is unchanged and remains in the full suite.
