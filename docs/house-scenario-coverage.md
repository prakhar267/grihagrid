# House briefs and scenario coverage — 21 September 2026

## Outcome and acceptance

A homeowner, homebuyer, architect or builder can capture a real room programme,
retain the actual location, assign rooms across floors, and compare the current
model with those requirements. A bounded rectangular starter produces editable
geometry from the programme. Requests outside its capabilities give an explicit
reason and keep the brief available for a measured drawing and manual editing.

The accepted Architectural Monograph appearance is preserved. This is local
implementation and a draft review; it is not a production deployment.

Acceptance measures: no dropped requested rooms in a successful generation;
all generated rooms connected; all supported floors reachable; unknown site
limits never reported as approved; exactly one brief revision per accepted
request/retry; other owners cannot read or change it. These are tested product
invariants, not production conversion or professional-certification metrics.

## Journey audit

| Step | Before | Implemented and verified |
| --- | --- | --- |
| 1. Describe the site | Eight city choices and a width/depth reference | Free-text city/village and authority, feet/metres, climate, road edge/width, survey north, shape/terrain, explicit setbacks and entered FAR/coverage/height/source |
| 2. Specify the household | No detailed room programme | 26 room types plus editable names, 1–36 requirements, floor allocation, target area and priority, four floors, family composition, access needs, parking, services, notes |
| 3. Resolve preferences | No orientation-based comparison | Optional editable Vastu directions, explicit unknown north, household/service/climate questions, budget using the user's own rate |
| 4. Develop a plan | New houses began from the same sample | Rectangular layout study with requested spaces, openings, furniture and stairs; numeric/manual editor and drawing import retained |
| 5. Test the actual result | No brief-to-model match | Floor-aware room matching, area/direction/name mismatch, model extents and entered limit checks, missing-window questions, programme and actual-model budget allowances |
| 6. Save and return | Geometry history only | Separate immutable brief history, Change Study, safe retries, concurrent-change fencing, stale model/tour states, owner export, archived read-only access and portable Markdown/JSON |

A new private house displays its requested floor/room counts and “No geometry
saved.” Sample geometry is labelled, excluded from its requirements comparison,
and cannot be accepted through an untouched initial Change Study. A generated
study focuses the plan heading. Review panels receive keyboard focus when ready.
A dirty private brief must be saved before its concept can be accepted.

## Scenario matrix and boundaries

| Scenarios | Result / boundary |
| --- | --- |
| 34 named locations, including Hindi, Tamil, Kannada and a village | Names round-trip; unknown adopted local rules remain unresolved. This tests location capture, not 34 municipal approvals. |
| One through four floors × four road edges | Valid geometry, unique IDs, connected rooms/stairs and validated tour routes |
| Default four-floor camera tour | Prioritizes requested rooms across every floor; up to 12 stops per tour, editable by the user |
| Living, dining, kitchens, bedrooms, elder/guest/children's rooms, bathrooms, puja, office, utility, pantry, store, staff, family, gym, media, garage, shop and custom spaces | Requirements retained; generated sizes are assumptions, not code minima or complete fit-out design |
| Courtyard, balcony and terrace | Brief capture and manual/drawing workflow; automatic enclosed-room substitution is refused |
| 20 ft × 50 ft narrow single-floor site | Single-bank starter preserves requested rooms |
| 20 ft × 30 ft overfull site | Fails with a fit explanation; no shrinking or sample substitution |
| Large rural plot | A smaller footprint is allowed; the house starter remains bounded to 40 m depth |
| Empty upper floors / reducing occupied floors | Explicit correction required; no silent deletion or relocation |
| Corner / irregular / sloping plots | Measured site drawing and manual review required; automatic starter rejects these shapes |
| Renovation, apartment buying, rental units, mixed use | Saved brief, role-specific review and model comparison; survey/import/manual design required |
| Five climate categories plus unknown | Different envelope/ventilation review questions; no energy simulation or assumed city mapping |
| Elders, wheelchair or step-free request | Flags missing ground-floor daily living and upper-floor lift strategy; camera navigation never certifies accessibility |
| Strict/flexible/no Vastu; unknown and rotated north | Editable direction checks distinguish unknown, matched and mismatch; strictness survives presets |
| Entered FAR, coverage, height, setbacks and budget | Oversized programme/model checks; no invented local rules or market prices |
| Privacy, drainage, water, rainwater, solar, EV, noise, expansion | Explicit handoff questions; no implied installed infrastructure or structural design |
| Revised room names, duplicated names, removed windows, enlarged geometry | Comparison follows stable room identity and floor, prevents double matching, and surfaces gaps |
| Create/retry, read-only preview, accepted model, concurrent brief changes, malformed requests, ownership, CSRF, archive, account export | Exercised with the actual Worker handlers and fresh D1 migrations |

The generator is a space-allocation starter, not an architectural optimizer.
Upper floors may use smaller footprints; remaining areas are named “Unassigned
space” instead of inflating bathrooms to occupy the whole bank. Structure,
wet-stack alignment, shafts, detailed kitchen/bathroom fit-out, parking manoeuvres,
terrain, basements, fire engineering, municipal submission drawings, construction
BOQs and automatic compliant design across all jurisdictions remain outside the
automatic generator. Manual design and professional review remain necessary.

## Reference material

Reviewed primary references informed the questions, not an automatic compliance
claim or a copied statutory rules database:

- [BIS homeowner and homebuyer guides](https://www.bis.gov.in/guide-for-homeowners-and-homebuyers/?lang=en): separate permit/build/buy journeys and professional document checks.
- [BEE Eco-Niwas Samhita 2024](https://beeindia.gov.in/sites/default/files/publications/files/BEE%20ENS%202024.pdf): climate, envelope, shading and ventilation questions.
- [Harmonised universal accessibility guidelines 2021](https://divyangjan.depwd.gov.in/content/upload/uploadfiles/files/HG2021_MOHUAN_merged.pdf): routes, access and usable fit-out require more than a room-area check.

Vastu directions are household preferences. The UI labels the common preset as
editable; it is not a safety, scientific or statutory score.

## Persistence and API

Migration `0024_house_design_briefs.sql` adds `house_brief_revisions` and the
`spatial_revisions.brief_revision` source fence. Earlier migrations and project
input allowlists are unchanged. Project creation accepts an optional top-level
`houseBrief` and atomically writes the project plus brief revision 1. Its initial
legacy planning input receives dimensions/floors and a supported city or `Other`;
the full city stays in the architectural brief. G+3 is now an explicit supported
legacy estimate/report input, using the existing indicative heuristic extended
to factor 2.08. That estimate is not a model-derived construction quote.

- `GET /api/projects/:id/spatial` returns `houseBrief`, `briefRevision`,
  `briefStale`, `sourceBriefRevision`, model/tour staleness and the existing spatial data.
- `POST /api/projects/:id/spatial/brief-preview` accepts `brief` and
  `expectedInputRevision`, `expectedSpatialRevision`, `expectedBriefRevision`.
  It is read-only and returns the assessment and Change Study.
- `POST /api/projects/:id/spatial/brief` additionally requires `acceptedImpact:
  true` and `Idempotency-Key`; SQL fences owner, archive state and all source
  revisions. Accepted history cannot be updated.
- Spatial model, tour, camera and AI-direction requests include
  `expectedBriefRevision`. Older clients may omit it only while no detailed
  brief exists. A brief change invalidates pending saves and old model/tour
  sources, including AI direction that completed after the change.
- A change to the separate legacy planning input marks the detailed brief for
  reconciliation. The same brief may be reaccepted against that new input.
- `/api/account/export` includes owner-only `houseBriefs` and each model’s source
  `briefRevision`. Project deletion
  cascades through the new table. Readiness, release schema evidence, canary
  residue checks and the isolated Sites package include the new contract.

Brief saves preserve old estimates, reports and geometry. The user accepts a
new concept separately. JSON downloads are editable, strictly validated and
limited to 64 KB on import; files are read locally. Markdown includes site
assumptions, room schedule, review questions, model comparison and references.
No brief or location is added to Gemini payloads or analytics.

## Verification evidence

Automated cases live in `tests/house-scenarios.test.mjs` and
`tests/house-brief-api.test.mjs`; spatial geometry/tour and full repository
regressions are also run. The API suite uses disposable real D1 storage with all
24 migrations, not a success-only network mock.

Browser evidence uses the real Vite/Worker preview at `http://127.0.0.1:5277/`
and synthetic local data. It includes a two-floor family brief with elders and
Vastu mismatch, a private four-floor architect brief with eleven requested rooms,
accept/revise/save/reopen, keyboard focus, responsive layouts, and console checks.
Screenshots and the detailed local audit are in
`../reports/house-scenarios-2026-09-21/` relative to the repository root.
Physical iPhone and spoken VoiceOver remain explicitly deferred by the user.

The focused scenario/API suite passes **122 tests**. Native Chrome zoom at
**200%** retained equal document and viewport widths (735 CSS px); 390px mobile
also had no horizontal page overflow. Printed review and table pages were
visually inspected. The browser JSON import/download matched every requirement
in the original synthetic file. Private creation, two model revisions, brief
revision, library reopen and logout were exercised against local D1. No browser
console errors were recorded; Three.js emitted its existing Clock deprecation
warning. Temporary viewport/zoom overrides were reset after testing.

A full 821-test checkpoint passed before the final additional cases. A later
824-test run had 823 passes and one local D1 setup failure caused by `ENOSPC`
(disk full), not an assertion about payment behavior. No tests were skipped or
weakened; the full check was rerun after available disk space recovered. Use the
exact draft PR head checks and the local audit report for final run status.
