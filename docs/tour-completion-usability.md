# Finish a tour or editable download without a detour

## Customer problem and observed journey

On 4 October 2026, the live example was renamed, reviewed and accepted. Downloads
then showed a disabled scene download and “Rebuild for this concept revision”.
Its “Rebuild and review tour” action switched to Camera tour and lost keyboard
focus, requiring a return to Downloads before saving the file. The tour also
repeated status text in a banner and a disabled transport. Opening layout review
left its original review banner visible above the review itself.

## Bounded outcome

A homeowner can finish playing a tour or downloading an editable house from the
chosen task, with one clear next action. Architects retain the existing route,
shot, timing, AI-consent and revision controls.

- On Camera tour, the primary transport action reflects review, update or play.
  Updating a reviewed tour can start playback only on that explicit user action.
- On Downloads, an already-reviewed layout with an out-of-date tour can update
  the tour and download the resulting complete scene in one explicit action.
  Use the newly generated tour in the file, never the previous React state.
- Review remains mandatory for unaccepted layouts. Finishing/cancelling review
  returns focus to the relevant action; the duplicate review banner is hidden
  while its review is open.
- Tour-specific warnings stay with tour-dependent actions. 3D exploration and
  drawing downloads must not appear blocked by a camera-route prerequisite.
- Preserve route choices and duration. Invalid routes must show an actionable
  error and produce no file or playback. Busy, archived, conflict, component-form
  and brief prerequisites retain their existing protections.

## Measure and acceptance

The observed accepted-layout → editable-file recovery took three actions
(update/review tour, return to Downloads, download) and changed tasks. Target:
one explicit update-and-download action, zero task changes, matching model/tour
source revision in the actual downloaded file. This is an interaction count,
not a measured user success-rate or time-saved claim.

Check clean, edited, reviewed, out-of-date, pending-route, invalid-route, conflict,
archived, rendering-error and reduced-motion states as appropriate. Verify
keyboard focus, 390px reflow, 200% native zoom, real playback and file roundtrip.
Retain current typography, colors, spacing, drawings, shared geometry and backend
contracts. No schema, AI-provider, credential, payment or upload activation change.
Physical iPhone, spoken VoiceOver and moderated usability research are not claimed.

## Current-run browser evidence

Verified the two-floor review → update → playback path, pause/resume and completed
42-second playback; the pending-itinerary update-and-download path stayed in
Downloads. Actual exported scenes had matching model/tour revisions (2 and 3),
both floor IDs and the requested duration. A fresh Chrome tab reopened the first
file successfully. After renaming the upper room, review cancellation and
acceptance returned keyboard focus to the editable-download action; the second
file and drawing set contained the renamed room. A one-second invalid duration
produced an error and no playback/download from either entry point.

390px mobile and native 200% Chrome zoom showed no document overflow. Reduced
motion required an explicit play action; navigation did not start motion. Native
print preview hid workspace controls and rendered the drawing. Browser page
printing retains an existing trailing page; use the dedicated drawing-set export
for deliverables. Three.Clock deprecation warnings remain; no application errors
were observed. Archived/conflict/render-failure guards were source-reviewed, not
injected into the browser. Physical iPhone and spoken VoiceOver remain unverified.
