# Project Decision Home v1

## Product decision

Project Decision Home is the authenticated command centre for one home-planning
project. It brings the existing feasibility report, Gemini planning brief,
Decision Compare, Family Alignment, selection, and purchased evidence into one
truthful state readout.

The release optimizes for one outcome: a returning owner should understand the
project's current decision state and resume the single most useful next action
without reconstructing the journey from separate pages.

This is deliberately not project revision history. The current project row is
mutable, `input_revision` is a concurrency/source counter, and prior free report
inputs are not retained. Saved comparison versions and purchased snapshots are
historical records; old project briefs and free reports are not.

## Core journey

The owner sees four text-labelled stages:

1. Feasibility
2. Compare alternatives
3. Family input (optional)
4. Choose a direction

Family input is always advisory and never blocks progress. The owner's recorded
direction is authoritative for this product. The Home presents exactly one
primary next action, in this order:

1. Generate or open current feasibility.
2. Start a comparison, or recalculate a stale one.
3. Choose a direction from the current comparison.
4. Open the selected direction and professional handoff material.

An archived project remains readable, but Home must not invite generation or
planning/content mutations. Archiving permanently closes outstanding Family
review rooms; choosing, editing, uploading, checkout, new share links, and new
review rooms fail closed until an explicit reopen. Owner-initiated privacy
deletion and link/file revocation remain separately governed controls. Whole-
project deletion is rejected while private files exist, so no R2 object is
removed ahead of a fallible database transaction; the owner must delete each
file explicitly first. Paid checkout, uploads, or professional review must not
appear as next actions while their server capabilities are closed.

## Server projection

`GET /api/projects/:projectId/home` is authenticated, owner-scoped, and returned
with `Cache-Control: no-store`. Missing and foreign projects are indistinguishable.
It is a read-only projection: it must never call the report auto-generation path
or update project status, timestamps, progress, analytics, or any source record.

The response contains:

- the normalized owner project;
- a server-derived lifecycle stage, four display steps, and one bounded action
  code/target;
- currentness metadata for feasibility, AI, comparison, selection, aggregate
  Family state, and paid entitlement;
- bounded counts for saved comparisons, Family rooms, purchased artifacts, and
  orders.

Currentness is derived from source facts rather than a duplicated lifecycle
column:

- feasibility matches the exact current project input and estimate hash;
- AI matches the current report source;
- comparison matches the current project input revision and source hash;
- selection belongs to that exact current comparison;
- Family state belongs to that exact comparison and exposes aggregate counts
  only;
- purchase entitlement belongs to that exact comparison and is paid and not
  revoked.

Historical artifacts may contribute to counts but must never badge a newer
working comparison as purchased or current.

## Archive race fence

Migration `0011_archived_project_write_fence.sql` adds only database triggers;
it adds no table, lifecycle column, or backfill. The triggers close archive-vs-
write races for reports, AI briefs, comparisons, owner selection, checkout,
paid share creation, file uploads, and Family rooms/responses. Application
guards keep normal errors clear; D1 is the final authority if an archive commits
after the initial owner read. `/api/readiness` reports
`archiveSafetySchema=current` only when all 13 named triggers exist.

The migration is forward-compatible with a Worker rollback: older Workers keep
reading the same schema and receive a bounded constraint failure rather than
writing content into an archived project. Deletes, bearer revocations, artifact
reads, refunds/disputes, and existing payment-state updates are not fenced.

## Privacy and security boundary

The Home response must not contain:

- Family bearer links, token hashes, response receipts, individual response
  rows, participant timestamps, or participant identity;
- payment-provider identifiers, checkout URLs, webhook records, request hashes,
  or reconciliation records;
- raw report, comparison, AI, purchase, or Family JSON envelopes;
- input hashes, prompt hashes, provider interaction identifiers, or AI usage;
- arbitrary server-provided navigation URLs.

The browser maps a fixed action enum to same-origin routes. React renders owner
strings as text. Aggregate product events contain no user, project, revision,
stage, or action identifier.

## Out of scope

- Project input editing, change impact, or restore.
- A project revision ledger or historical free-report recovery.
- A second persisted phase/state machine.
- AI-generated next-action selection.
- Collaborator accounts, messaging, notifications, or an architect marketplace.
- Enabling payment, R2 uploads, or professional fulfillment.

Those workflows require separate data, concurrency, privacy, and operational
contracts. In particular, editable history requires a forward-only project
version ledger plus expected-revision compare-and-swap writes; it must not be
inferred from today's revision counter.

## Acceptance and release gates

- State projection covers new, feasible, compared, selected, stale, archived,
  Family-active, paid, refunded, and disputed cases.
- Repeated Home reads produce zero database mutations.
- Cross-owner access returns the same `404` contract as a missing project.
- Post-archive planning/content writes and public Family responses fail without
  changing D1 or R2; privacy deletion and revocation keep their explicit scope.
- Whole-project deletion with any private-file metadata returns
  `409 project_has_files` before R2 is accessed or D1 is mutated.
- A recursive forbidden-key test protects the response boundary.
- Dashboard, registration handoff, report, comparison, and Home navigation are
  coherent and browser history remains functional.
- The lifecycle is an ordered semantic list, every state has visible text, and
  the primary control remains usable at 390 px and 200% zoom.
- Production and staging Worker bundles, the full test suite, fresh migrations,
  dependency audit, browser console/network checks, and paid-closed smoke pass.

The leading product measure is the seven-day decision-ready rate: projects with
a current saved comparison and owner selection within seven days of a generated
feasibility report. V1 records only privacy-safe aggregate Home opens and
next-action clicks; a cohort measure needs a separately reviewed measurement
contract before it is claimed in product reporting.
