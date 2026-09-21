# House studio release review — 21 September 2026

The reviewable candidate is [PR #83](https://github.com/prakhar267/grihagrid/pull/83).
It includes the detailed house studio, editable multi-storey layouts, shared 2D
and 3D geometry, saved cameras and tours, and Cloudflare-first AI with separately
consented Gemini fallback. Implementation and local verification are complete;
this document does not assert that the candidate has been deployed.

## Database change requiring review

Migration `0024_house_design_briefs.sql` adds immutable `house_brief_revisions`,
with an owner-project foreign key and cascading deletion. It adds a non-null
`brief_revision` column to existing spatial revisions with default zero. It does
not delete or rewrite existing project, estimate, report or spatial records.
Insert triggers require an active project, current input revision, sequential
brief history and a model source matching the latest accepted brief.

The prior Worker can continue writing models on projects without detailed house
briefs because their source remains zero. After a detailed brief exists, its old
model writes must fail the source guard; an emergency Worker rollback does not
restore house-brief authoring to that older application. The immutable records
remain available for forward recovery. Do not remove the trigger to permit a
stale write or rewrite migration history as a rollback shortcut.

The protected release workflow exports and encrypts the pre-migration database,
verifies a decrypt/hash round trip, and records its D1 Time Travel bookmark and
previous Worker version. It applies the migration on staging first, rehearses
the rollback Worker against the migrated schema, checks exact synthetic residue,
deploys the candidate, and runs the candidate canary. Production repeats these
controls after its environment hold and requires 30 minutes of observation.

## Candidate checks

- The expanded release canary accepts and reloads generated Jaipur and Delhi
  G+2 models with 16 rooms and two stairs each, three floor camera views, and
  a 45-second tour covering every floor.
- Read-only previews, brief retry idempotency, stale brief/model rejection,
  archive fences and full brief/model/camera/tour persistence are required.
- A test interrupts the response after saving the Delhi brief. The canary must
  fail and clean only its synthetic project and cascading records.
- Both city fixtures are synthetic. Their working setbacks are entered test
  assumptions, not a statement of municipal permission or engineering approval.
- No cloud AI request runs in the privileged deployment canary. Live Workers AI
  and visual 2D/3D/walk/tour evidence is recorded separately in the local report
  and `docs/cloudflare-ai-migration.md`.

## Read-only release preflight

GitHub and Cloudflare identities were checked. Required CI/CodeQL branch
protections and separate staging/production environment secrets are configured;
production has a five-minute environment hold. No credential scope was changed.

Both deployed readiness endpoints returned HTTP 200 and `ready` during preflight:

- Production Worker: `c66fb177-88db-4655-bdb0-30137d345ff4`.
- Staging Worker: `3fdf3566-674f-449a-aeb5-ff981b913b60`.

These are the existing versions, not this candidate. Paid checkout, paid
fulfillment and private uploads remain disabled. No remote migration, merge,
release dispatch or deployment was performed during this preflight.

## Release approval — 22 September 2026

The owner replied “approved u have full access” after being shown this database
review and asked whether the required schema review was completed and PR #83
could be merged and deployed. This approval expands the earlier local/draft
scope to the protected staging-first release, migration and monitoring. It is
recorded in the task and PR description; it is not a GitHub approving-review
event or evidence of deployment completion. Preserve the normal branch checks,
encrypted backup, rollback rehearsal and production observation requirements.

Physical iPhone and spoken VoiceOver checks remain explicitly deferred by the
user. Domain, payment and private-upload activation remain outside this cut.
