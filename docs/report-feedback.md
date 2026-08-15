# Report feedback

Report feedback is a small learning loop on a saved planning report. It asks
whether one exact report was useful, unclear, or needs checking, and which
bounded part shaped that answer. It is not a support ticket, professional-review
request, rating of a person, or input to report generation.

## Product contract

- A signed-in owner sees the control only after both the project revision and
  supported report schema v2 are known. Legacy schema-v1 artifacts predate
  Brief Check and never show or accept this vocabulary. Their historical page
  uses only the bytes persisted in that v1 artifact; it must not recompute or
  inherit today's Brief Check, input facts, cost fallbacks, risks, or actions.
- Outcomes are `helpful`, `unclear`, and `needs_review`.
- Sections are `overall`, `brief_check`, `programme`, `cost_range`,
  `assumptions`, and `next_actions`. Choose one to three; `overall` is exclusive.
- There is no free-text field. The UI explains that the report remains
  immutable and that feedback does not replace professional review.
- Existing archived feedback is readable; archived projects cannot add or
  change a response. Feedback controls do not enter the printed report.

## Data and API boundary

`report_feedback` is keyed by `(project_id, project_revision,
report_schema_version)` and has a foreign key to the immutable
`project_revision_reports` row. `user_id` must match the active project owner at
insert/update time. The schema check accepts report schema v2 only. D1 triggers
freeze identity and `created_at`, reject archived writes and enforce the exact
vocabulary, uniqueness, size and `overall` exclusivity rules. Project deletion
cascades feedback.

`GET|PUT /api/projects/:projectId/revisions/:revision/reports/:schemaVersion/feedback`
is owner-scoped. PUT requires trusted origin, session/CSRF, KV and a per-account
60/hour best-effort edge throttle whose key contains only a digest. KV
read/write failure returns fail-closed `503 abuse_control_unavailable`; SQL
ownership, archive, identity and vocabulary guards remain the hard boundary.
An exact replay preserves `updatedAt`; a changed response updates it. Neither
path reads or writes report JSON. Operational logs template project, revision
and report-schema segments.

The protected aggregate endpoint returns only response counts by outcome and
section for a bounded window. It never returns identity, project, revision,
report, IP, free text or individual response rows.

## Intake hardening shipped with the schema

Migration `0013_report_feedback_and_intake_hardening.sql` also prevents hidden
project-input claims from weakening a safety caveat. The Worker accepts only
the 15 versioned input fields and validates their exact type/range/category.
D1 repeats the field allowlist for inserts and source updates, and caps each
account at 50 projects behind the Worker's best-effort 20/hour per-account edge
throttle. The D1 ceiling—not KV—is the exact concurrency-safe storage bound.
Every deterministic report states that foundation assumptions require a
geotechnical investigation; no client-provided `soilReport` flag can suppress
that boundary.

## Release and rollback

The migration is additive and backfills no feedback. Before applying it, make
the encrypted D1 recovery point required by the operations runbook. The strict
pre-migration audit must find zero invalid/non-object project inputs, unknown
input keys, `soilReport` keys, unsafe schema-v2 revision reports and unsafe
schema-v2 current reports. Record canonical ordered `projects`/`reports` row
counts and hashes from mode-0600 raw evidence outside the repository. Afterward,
require the table, two indexes, five triggers, zero feedback rows when `0013`
was newly applied, an empty foreign-key check, unchanged core hashes and
`reportFeedbackSchema=current`. The global queries are not a transactional
snapshot, so a legitimate concurrent write can fail the invariance gate; stop
and rerun from fresh evidence in a quiet window instead of waiving the mismatch.
Unconditional runner cleanup removes all raw query and backup material, and no
customer row enters an artifact.

Deploy staging before production. The authenticated canary must create an exact
schema-v2 report, read null feedback, save/read the bounded response, prove
report bytes unchanged, and delete the synthetic project. The cleanup gate runs
even after a failed canary and queries only the harness-reported project IDs;
`projects`, `project_revisions`, `reports`, `project_revision_reports`, and
`report_feedback` must all return zero matching rows. Missing ID evidence is a
failure, and unrelated customer writes do not weaken this marker-specific proof.

Before candidate deployment, run the reviewed current smoke harness in
legacy-Worker mode against the still-active previous Worker and exact previous
version. It must pass on the expanded schema and leave the same exact-ID zero
residue. Only that successful compatibility rehearsal permits automatic Worker
rollback after `0013`; otherwise stop and roll forward with a compatibility fix.
The old Worker ignores the additive feedback table while D1 continues enforcing
project-input and account guards. Do not execute the previous commit's harness,
down-migrate, or drop the table/triggers.
