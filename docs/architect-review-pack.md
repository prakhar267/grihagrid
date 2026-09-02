# Architect review pack

The Architect review pack upgrades the saved website report from a short
planning readout into a coordinated client-to-architect brief. It is detailed
enough to reduce re-briefing and expose assumptions before drawing work begins;
it is deliberately not a measured survey, statutory submission, tender set,
engineering design, or construction issue.

## Bounded customer problem

The original report showed the Brief Check, likely built-up area, planning cost
and a short risk note. A family could understand the direction, but an architect
still had to reconstruct the area arithmetic, room schedule, floor intent,
adjacencies, services assumptions, missing evidence and required deliverables.
The result was a useful conversation starter, not an efficient review pack.

This change solves one bounded outcome: after saving a project and explicitly
generating its report, the owner can read, print or selectively share one
coherent architectural brief whose programme reconciles to the same frozen
revision and server-authoritative estimate.

## User journey

1. The owner creates or opens a project and generates the current report.
2. The report retains its existing summary and cost evidence, then presents an
   Architect review pack in plain client language.
3. The owner and architect can trace every room target to the scheduled net
   programme and every scheduled/allowance area to the gross built-up target.
4. They review level zoning, adjacencies, climate response, structure/services
   intent and the verification register before any plan is frozen.
5. The owner prints to PDF or selects **Architectural programme** in a secure
   Professional Handoff link. The selection discloses that city, facing, entered
   plot/road dimensions, room and budget context leave the private workspace;
   it never includes a precise address, project name, account, files, feedback,
   AI content, comparisons, orders or another revision.
6. The architect retrieves current official instruments for the exact plot,
   records departures and issues the professional drawings listed in the pack.

## Content contract

`report.architecturalHandoff` is an additive, versioned subdocument inside the
immutable report schema-v2 bytes. Its own version is `1`. New reports persist
it; the website deterministically derives the same subdocument from an older
schema-v2 report's frozen revision input and estimate so existing owners receive
the richer presentation without rewriting saved report bytes.

The subdocument contains:

- source site/brief facts with client-stated and missing evidence kept distinct;
- plot, working footprint, open-ground, gross built-up, scheduled-net and
  planning-allowance arithmetic;
- a room data sheet with code, level, target area, nominal clear starting
  dimensions and design intent;
- level-by-level zoning and vertical-coordination holds;
- adjacency priorities;
- city-aware climate/site moves to test;
- structural, plumbing, storm-water, electrical, cooling and life-safety
  coordination intents;
- an evidence/status/action/owner/decision-gate verification register;
- a professional drawing and issue register;
- official reference starting points plus explicit applicability caveats; and
- review notes that prevent concept dimensions being treated as measured or
  code-certified dimensions.

The scheduled net programme is 76% of the target gross built-up area, rounded
to five square feet. The balance is an explicit planning allowance for walls,
circulation not separately scheduled, shafts, structure and design development.
Room weights allocate that net target deterministically. This is a transparent
briefing model, not a minimum-area or code-compliance engine.

## Compatibility and immutability

- The top-level report remains schema v2, so report feedback, Professional
  Handoff, professional review, AI-source binding and existing D1 constraints
  remain compatible.
- Schema-v1 historical reports remain legacy-only. The UI does not derive
  modern facts or mount modern feedback/share/review controls for them.
- Existing schema-v2 rows are never updated. Their review pack is a rendering of
  the same immutable revision input, estimate and report identity already
  returned in the atomic report envelope.
- New schema-v2 rows persist the subdocument to make downstream projections
  self-contained.
- Professional Handoff still stores one report-content hash and selected section
  list. For an older schema-v2 row, the public programme is derived from that
  link's exact immutable `project_revisions` input/estimate row.

## Acceptance criteria

- A normal 30 × 50 ft, G+1, 3-bedroom project renders at least fifteen room and
  circulation/programme entries, two level briefs, seven adjacency priorities,
  seven structure/service items, ten verification items and eight professional
  deliverables.
- Room areas sum exactly to scheduled net programme; scheduled net plus planning
  allowance equals target gross built-up; level targets sum to target gross
  built-up; working footprint plus working open ground equals entered plot area.
- Unknown road width, plot shape, accessibility, future use and budget remain
  visibly missing rather than becoming optimistic defaults.
- No output claims feasibility, compliance, approval, safety, sanctioned area,
  exact cost, or construction readiness.
- Delhi reports link to DDA's UBBL compendium and Master Plan starting points,
  while every authority reference says the local architect must confirm current
  applicability to the exact plot.
- Private style text and arbitrary/unrecognised nested fields do not enter the
  public handoff projection.
- Desktop, 390 px mobile, 200% zoom and A4 print remain readable with no document
  horizontal overflow; keyboard focus and existing report controls remain intact.
- Legacy report, missing report, archived report, historical report and public
  handoff failure states preserve their existing semantics.

## KPI and guardrails

The leading KPI is the share of eligible saved reports whose owner prints the
pack or creates a Professional Handoff containing `programme` within seven days.
Existing aggregate share/create/open/revoke counts remain the only available
handoff measurement; print is not newly tracked in this release.

Guardrails are zero mutation of existing report/revision bytes, zero
cross-account reads, zero precise address/project/account/free-text style in a
public handoff, zero unselected sections, zero unsupported professional claims,
and no change to paid-checkout, fulfillment or private-upload controls.

## Professional boundary

An architect cannot responsibly only “review and sign” a plan created from the
current fifteen project fields. Boundary/level survey, title and cadastral
evidence, current plot-specific controls, neighbours, utilities, soil,
structural design and coordinated service drawings are absent. The pack makes
those gaps actionable and minimizes brief rework, but the licensed professionals
remain responsible for design, dimensions, safety, submissions and issued
drawings.
