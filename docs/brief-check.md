# Brief Check and revision history

Brief Check is a deterministic, customer-facing check of whether the saved
home brief is complete enough for a useful professional conversation and
whether its stated programme contains obvious rule-based tensions. It is not a
feasibility approval, code check, design, structural opinion, or contractor
quote.

The first release deliberately combines three capabilities:

- a cautious current assessment;
- a read-only Change Study before an edit is accepted; and
- append-only snapshots of accepted project-input revisions and explicitly
  generated reports.

Restore/revert is not part of v1. Historical records can be read but never
  promoted back into the mutable project.

## Editable brief

Revision requests are partial updates over this exact allowlist. Unknown
proposed keys are rejected. Unknown keys already stored by an older Worker are
preserved in D1 when a known field changes, but are omitted from every new
revision API response.

| Field | Accepted value |
| --- | --- |
| `width`, `length` | number, 10–500 ft |
| `city` | `Pune`, `Bengaluru`, `Mumbai`, `Delhi`, `Hyderabad`, `Chennai`, `Jaipur`, `Other` |
| `facing` | `North`, `East`, `South`, `West` |
| `floors` | `G`, `G+1`, `G+2` |
| `bedrooms` | integer 1–10 or `5+` |
| `bathrooms` | integer 1–12 or `null` |
| `parking` | boolean, `None`, `1 car`, or `2 cars` |
| `style` | normalized non-empty text, at most 80 characters |
| `quality` | `Essential`, `Signature`, `Premium`, `Luxury` |
| `roadWidthFt` | number 6–200 or `null` |
| `plotShape` | `regular`, `irregular`, `corner`, `unknown` |
| `accessibility` | `none`, `step_free`, `wheelchair_ready`, `unknown` |
| `futureUse` | `none`, `rental`, `home_office`, `vertical_expansion`, `unknown` |
| `budgetLakh` | number 5–10,000 or `null` |

Numeric fields use `null` for “not sure.” The three categorical questions use
the explicit `unknown` value. The server never converts an unknown answer into
an optimistic default.

## Assessment contract

`briefCheck` has the exact shape:

```json
{
  "version": 1,
  "status": "programme_tension",
  "headline": "The brief contains decisions that need resolution.",
  "summary": "The inputs can support a useful architect conversation, but the highlighted trade-offs should be resolved first.",
  "missingFields": [
    { "field": "roadWidthFt", "label": "Approach-road width", "prompt": "Add the measured or best-known approach-road width." }
  ],
  "tensions": [
    { "code": "budget_below_range", "label": "The budget sits below the planning range", "detail": "Reduce area, floors, or finish scope before treating the programme as financially aligned." }
  ],
  "professionalChecks": ["Measured boundary, levels, access, and site conditions"]
}
```

The only statuses are:

- `insufficient_information`: at least one of bathrooms, road width, plot
  shape, accessibility, future use, or budget is not known;
- `programme_tension`: required facts are present and at least one deterministic
  tension rule fires; or
- `directionally_plausible`: no current rule fires, with an explicit reminder
  that measured-site and professional validation remain necessary.

Missing information takes precedence over tensions. Neither status nor report
copy uses an unqualified claim of feasibility, compliance, approval, safety,
parking fit, or constructability.

## Change Study

Preview and accepted revision responses contain:

```json
{
  "hasChanges": true,
  "changedFields": [
    { "field": "quality", "label": "Finish", "before": "Signature", "after": "Premium" }
  ],
  "estimateDeltas": {
    "plotSqft": { "before": 1500, "after": 1500, "delta": 0 },
    "builtUpSqft": { "before": 1830, "after": 1830, "delta": 0 },
    "lowInr": { "before": 3703920, "after": 4791432, "delta": 1087512 },
    "highInr": { "before": 4428600, "after": 5729490, "delta": 1300890 }
  },
  "status": {
    "before": "directionally_plausible",
    "after": "directionally_plausible",
    "changed": false
  },
  "consequences": [
    { "code": "feasibility_refresh", "label": "Planning report must be regenerated", "detail": "The current planning report is cleared; an earlier generated report remains attached to its original revision." },
    { "code": "comparison_historical", "label": "Current comparisons become historical", "detail": "Saved options, choices, and purchases remain immutable but do not become current for the new brief." },
    { "code": "family_rooms_closed", "label": "Open Family rooms close", "detail": "Review links for an earlier brief are permanently revoked so they cannot collect answers against obsolete inputs." },
    { "code": "purchases_unchanged", "label": "Purchased evidence stays unchanged", "detail": "A revision never rewrites, unlocks, or re-entitles a purchased artifact." }
  ]
}
```

Preview performs no D1 writes. Commit rejects a no-op with
`409 no_revision_changes`.

## API

Every route is session- and owner-scoped. Both POST routes also require a
trusted origin, CSRF cookie/header equality, and the KV abuse-control binding.

### Preview

`POST /api/projects/:projectId/revisions/preview`

The body must contain exactly:

```json
{ "expectedInputRevision": 3, "input": { "quality": "Premium" } }
```

Response:

```json
{
  "baseRevision": 3,
  "proposedRevision": 4,
  "input": {},
  "estimate": {},
  "briefCheck": {},
  "changeStudy": {}
}
```

### Accept and save

`POST /api/projects/:projectId/revisions`

Send an `Idempotency-Key` header containing 8–128 safe characters. The body
may contain only, and must contain, these fields:

```json
{
  "expectedInputRevision": 3,
  "input": { "quality": "Premium" },
  "acceptedImpact": true
}
```

The first successful write returns `201`; an exact same-key replay returns
`200` with `idempotentReplay: true`. Reusing the key for different request
bytes returns `409 idempotency_conflict`.

```json
{
  "project": {},
  "revision": {},
  "briefCheck": {},
  "changeStudy": {},
  "idempotentReplay": false
}
```

### History

- `GET /api/projects/:projectId/revisions?limit=20&beforeRevision=8`
  returns newest first. `limit` is 1–50. The response is
  `{ project, briefCheck, revisions, pagination, historyStartsAtRevision }`.
  `pagination` is
  `{ limit, beforeRevision, nextBeforeRevision, hasMore }`.
- `GET /api/projects/:projectId/revisions/:revision` returns
  `{ project, revision, previousRevision, changeStudy }`. `previousRevision`
  and `changeStudy` are `null` at the honest beginning of retained history.
- `GET /api/projects/:projectId/revisions/:revision/report` returns the highest
  available report schema version as `{ project, revision, report,
  cached: true }`. `project`, the full `revision` facts, and `report` are read
  from one owner-scoped immutable envelope so the UI cannot combine facts from
  one revision with report bytes or feedback identity from another.

A revision detail contains
`revision,current,provenance,createdAt,inputSchemaVersion,estimateRuleVersion,input,estimate,briefCheck,report`.
A list item replaces `input` with an allowlisted `inputSummary`. `report` is
`{ available, schemaVersion, generatedAt }`.

## Existing PATCH and reports

Any input-changing `PATCH /api/projects/:projectId` now requires a top-level
`expectedInputRevision`. It uses the same allowlist, compare-and-swap,
derived-data recomputation, report invalidation, and Family-room revocation as
revision commit. Rename and status-only PATCHes do not require the revision.

`GET /api/projects/:projectId/report` is strictly read-only and returns
`404 report_not_found` until the current revision has an explicit v2 report.
`POST` generates it. Both return the atomic
`{ project, revision, report, cached }` envelope. The report is staged in the
mutable `reports` cache and captured into immutable
`project_revision_reports` in one D1 batch. A concurrent edit returns
`409 project_revision_conflict`; a concurrent identical report generation
reads and returns the winning immutable bytes.

Report schema v2 includes `briefCheck` and a verdict derived from its status.
It may also include the additive `architecturalHandoff.version=1` subdocument
described in `docs/architect-review-pack.md`. Older immutable schema-v2 bytes do
not contain that subdocument; the website may derive the same presentation only
from the exact frozen revision input and estimate returned in the report
envelope. This does not update the stored report or relax the schema-v1 legacy
boundary.
Migrated report v1 bytes remain available only through historical-report APIs.
The historical UI labels them as legacy and renders only fields persisted in
those v1 bytes; it does not recompute Brief Check, planning facts, risks, next
actions, cost categories, or feedback from the revision snapshot. Report
feedback is schema-v2-only.
AI generation requires an explicit current v2 report and returns
`409 report_required` otherwise; it never silently generates a report.

## Storage and transaction invariants

- `projects` remains the mutable current projection and carries monotonic
  `input_revision`, deterministic input fingerprint, rule versions, and the
  current Brief Check.
- `project_revisions` is append-only and keyed by `(project_id, revision)`.
- `project_revision_requests` stores only a user-scoped hash of the browser's
  idempotency key, a canonical request hash, and the result mapping. It stores
  no raw bearer value or user identifier.
- `project_revision_reports` is append-only and keyed by project, revision, and
  report schema version.
- Project deletion is the authoritative cascade for all three tables. Their
  immutable-delete triggers allow only that parent-driven cascade.
- A conditional project update followed by an unconditional request-map insert
  is deliberate. The map's insert trigger verifies the exact current revision
  and content hash. A zero-row stale update therefore makes the last statement
  abort and D1 rolls back the complete batch.
- Readiness treats the pre-existing `projects_input_revision_guard` as part of
  the revision schema: append-only snapshots are unsafe unless source changes
  must advance the monotonic revision exactly once.
- The project source-change trigger runs only for the winning UPDATE. It records
  the revision, removes the mutable report cache, and permanently revokes active
  Family links. Historical reports, comparisons, selections, and purchases do
  not change.
- Report history insertion is allowed only while the project, revision, and
  staged cache bytes still match. That SQL-time fence prevents attaching an
  Rn report to Rn+1.

The application's legacy financial-retention schema uses
`projects.user_id ON DELETE SET NULL`; consequently, direct SQL deletion of a
user is not an account-erasure operation. Do not use it as one. Authorized
project deletion cascades Brief Check data. A complete account-erasure workflow
must separately distinguish deletable projects from finance-retained evidence
and apply an approved redaction/retention policy.

## Migration, release, and rollback

Migration `0012_brief_check_revision_history.sql` is additive. It backfills one
honest snapshot at each existing project's current revision; it never invents
missing revisions. Existing current reports are captured as immutable v1
history. New and rolled-back old Workers are covered by D1 triggers that capture
future project creates/source updates. When an old Worker changes source bytes,
the new fingerprint and Brief Check are recorded as `NULL` instead of copying a
stale value, and the same derived fields are cleared on the mutable current
projection. The current Worker recomputes them on read.

Release order:

1. apply migration 0012;
2. verify `GET /api/readiness` reports `checks.revisionSchema=current` and
   `capabilities.briefCheck=true`;
3. deploy the Worker;
4. deploy the UI; and
5. monitor 409, 429, and 5xx rates by templated route.

The safe short rollback is Worker-only. The additive nullable columns and D1
capture/invalidation triggers keep history honest while the old Worker runs.
Do not down-migrate or drop the append-only tables. Re-deploy the current Worker
to recover; it will recompute current Brief Check and generate a v2 report only
after an explicit POST.

Migration `0013_report_feedback_and_intake_hardening.sql` adds a mutable,
structured owner annotation beside—but never inside—one immutable revision
report. The six bounded sections and three outcomes contain no free text. D1
guards reject foreign ownership, archived writes, duplicate/unknown sections,
and changes to report identity or creation time. The same migration adds a
database allowlist for persisted project input and a 50-project account ceiling;
the Worker adds strict typed creation validation and per-account abuse control.
See [report-feedback.md](report-feedback.md) for the full contract.
