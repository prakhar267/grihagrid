# A clearer house workspace

The customer problem is finding the next useful action among many existing
tools. First-time homeowners need to describe a home, inspect its plan, explore
it and take drawings away. Architects need a direct route to drawing import,
editing, technical coordination and reusable exports.

Preserve the Architectural Monograph styling and shared model. Use a task-based
start screen, plain destination names, compact page headings, and optional
technical panels. Avoid a mandatory tutorial, role gate or separate model for
each audience.

Acceptance:

- A new public visit offers requirements, drawing import and an example without
  requiring an account to try the tools. Private-house routes stay direct.
- Requirements, floor plan, 3D, tour and downloads remain one action apart.
- Brief step, plan subview, pending component entries, floor selection and
  layout changes survive internal view changes.
- Downloads contain drawings, editable scene and 3D model; local rendering is
  explicitly opened before local connection checks begin.
- Tour playback is visible before optional route/AI editing. Pending changes
  and stale-layout review remain visible and enforced.
- Mobile navigation uses readable labels and 44 px targets, with no document
  overflow. Keyboard focus follows explicit task shortcuts; optional panels
  remain keyboard accessible. Reduced-motion and print behavior are retained.

Observable measures: each starting task takes one action; specialist panels are
closed by default; all five workspace destinations remain visible; direct file
downloads do not require navigating through a 3D viewport. These are interface
checks, not claims from moderated usability research.

Guardrails: no backend, permission, AI-consent, payment, upload, migration or
customer-data changes. No automatic approval or construction claims. Preserve
Change Study, save conflicts, draft recovery and exact model exports.

Verification on 2 October 2026:

- Inspected current production and local screenshots at desktop and 390 px.
  All five destinations reflow without document overflow; mobile navigation
  targets are 48 px tall. Chrome's native toolbar confirmed 200% zoom, with
  reflow and keyboard entry to drawing import verified.
- Requirements retained the Jaipur city, three-storey choice and current step
  across view changes. An unfinished component label survived 3D navigation;
  its review action returned focus to Structure & services.
- Added empty floors and inspected layouts/copy/manual-entry paths. An
  unsupported stair connection kept the last valid model and blocked
  acceptance with an explanation. Discard restored the original floor list.
- Generated and accepted a separate Jaipur three-storey requirements study:
  11 spaces, two stairs, validated connectivity, upstairs walking and a complete
  30-second tour. Changed duration to 35 seconds; scene download remained
  blocked until rebuilding. Real downloaded HTML, JSON and GLB were inspected.
  The GLB contains 403 meshes; the scene retains all three floors and the brief.
- Optional local rendering opens an honest unavailable-connection state only
  after expanding its disclosure. No new Blender film or AI-provider request
  was necessary for this navigation change.
- Safari print preview revealed blank interleaved pages at A3 landscape. A
  bounded print container removes the spill without scaling the A3 SVG;
  the same model now produces eight sheets on eight pages at 100%.

Current-run screenshots and command logs are retained in the local
`HouseForge/reports/usability-2026-10-02` evidence directory. These checks are
not moderated usability research, a physical iPhone test, spoken VoiceOver
verification, or a claim of architectural approval. Authenticated conflict,
archive and recovery behavior remains covered by the existing regression and
protected-release canaries; no account or persistence API was changed.
