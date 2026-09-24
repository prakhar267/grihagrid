# Portable component forms

## Customer outcome

A designer can pause before applying incomplete structural or service entries,
download every pending floor form, reopen the same house later, and restore those
entries for review. Previously only a conflicted single form could be downloaded,
and there was no corresponding reopen action.

Journey: enter forms on multiple floors → download component forms → reopen the
saved house → choose the form file → review its floor/component matches → restore
forms → apply valid edits → review and accept Change Study → rebuild tours/export.

Acceptance and KPI: no lost fields across a real download/reopen cycle, including
empty numeric inputs and zero electrical load; no overwritten pending form; no
automatic geometry change or saved revision. Recovered existing components keep
their source fingerprint and use the existing changed/removed conflict checks.
New files include the house ID and name, since generated studies can reuse an ID.
A different name is rejected; reopening a renamed house requires its original name.
The older single-form download remains readable after an explicit original-house
confirmation because those files do not record a name. These local file checks are
recovery safeguards, not proof of project ownership. Wrong houses, missing floors,
duplicate floor forms, unknown fields, oversized files and malformed values must
fail without changing the current house or form entries.

Files remain local and are explicitly downloaded/opened. This is not autosave or
server persistence. A form file does not contain the house geometry; users must
save the house separately. Provider, authentication, revision and deployment
controls remain unchanged. Preserve the existing device-test deferrals, closed
payments/private uploads and professional-design boundaries.

## Verification

Local browser verification on 24 September 2026 covered real downloads and reopen,
three-floor Jaipur and Delhi studies, blank dimensions, multiline notes, zero load,
correct floor/discipline selection and form focus. Wrong-house (including shared
IDs), malformed and missing-floor files leave existing entries untouched. Pending
forms block restore. An open preview rechecks a resized model; restored conflicts
block Apply and Remove. Legacy files require the original-house checkbox.

Recovered changes passed through Change Study into Jaipur revision 9 and Delhi
revision 10. Both rebuilt tours reached 45 seconds; every floor was entered in
walking mode, and a current camera was saved and recalled. Real scene JSON, GLB
and drawing-set downloads were inspected. All 652 Jaipur and 626 Delhi primitive
transforms matched their shared render recipes exactly, as did one saved camera
per house. The 19-/18-sheet A3 sets retain the entered notes; Jaipur retains 0 W.
No new native Blender render was run for this form-only change; the render panel
correctly reported its disconnected local service.

Desktop, 390px (no horizontal overflow), native Chrome 200% zoom (no overflow),
keyboard cancel, focus restoration and the reduced-motion control were checked.
No app console errors were observed; Chrome emitted one unrelated Grammarly
extension error. Physical iPhone and spoken VoiceOver remain deferred. Archive
write fences are covered by the existing authenticated canary and automated suite;
no customer project was modified for browser checks.

Focused form tests: 16 passing. The initial complete suite passed 938 tests before
the shared-ID case was added. The next 939-test run was interrupted while the Mac
was locked: 937 passed and two real-D1 suites timed out. Its output is retained,
and a full rerun is required. Native print preview was also blocked by the locked
Mac; downloaded A3 drawing sets were inspected, but native print is not counted
as passed in this run. Required
migration checks, both Worker dry runs, dependency audit and diff checks are also
part of release validation. Detailed evidence lives in the local report directory
`../reports/component-form-files-2026-09-24/`.
