# A useful next action after the house brief

The review step must help a first-time homeowner continue without locating
technical fields by trial and error. Architects also need a direct drawing path
for site and project types outside the automatic starter.

Acceptance: show the next action before the detailed checks; explain missing
plot-edge spaces before offering generation; open the correct section and
focus its field or heading from a review shortcut; preserve entered values;
offer drawing import for unsupported projects without changing their brief;
keep current-model comparisons separate from creating a new layout. Invalid
input, failed geometry and Change Study acceptance must remain enforced.

Measure: one action from a setback or empty-floor warning to its editable
section; one action from an unsupported project review to drawing import;
generation errors visible with recovery actions. Preserve the existing visual
system, private-house behavior, exports, provider consent and launch controls.

Browser verification on 3 October 2026 (India):

- Captured the deployed review screen and its hidden generation error before
  implementation. The automatic action previously remained available with
  unknown setbacks, below the findings and example-model comparison.
- Enter activated the new setback shortcut, expanded its enclosing panel and
  focused the setback heading. The local-limits shortcut expanded both nested
  panels, and Tab continued to the first FAR input. An initial focus race was
  found and fixed by applying focus after React commits the destination.
- An empty first floor led directly to that floor's room section. After room
  assignments, a three-storey Jaipur study with 11 spaces and two stairs was
  generated, reviewed and accepted. Its rebuilt 30-second tour completed.
- A Delhi renovation brief led directly to drawing import. Returning retained
  its location and project type. No drawing was uploaded or provider called.
- A valid but narrow plot caused the real layout generator to reject the
  geometry. The error received focus and offered room editing and drawing
  import. Invalid blank width still prevented generation.
- Mobile error/invalid states reflowed at 390 px without document overflow.
  Native Chrome confirmed 200% zoom and the setback shortcut worked; zoom was
  restored to 100%. The in-app viewport override was also reset.
- Actual downloaded scene JSON retained Jaipur, all three floors, two stairs
  and the 30-second tour. The Markdown brief retained the professional rule
  and road checks even while those panels were collapsed in the interface.
  No browser console errors were observed in the local test tab.

Evidence is in `HouseForge/reports/usability-2026-10-03`, including numbered
before/after screenshots. This is a browser and regression check, not moderated
usability research or physical-device/VoiceOver certification. No geometry,
save-conflict, archive, AI-consent, payment or upload policy was changed.
