# Free-production readiness — 16 September 2026

## Scope and customer outcome

A household can use the deployed free planning and spatial studio, recover
from a temporary network or page-load failure, and retain control of its account
when authentication changes race with a destructive action. Operators can
detect missing spatial capabilities and inspect current recovery evidence.

This cut excludes custom-domain and payment activation. It preserves the
existing concept-planning boundary, deterministic geometry and estimates,
private project ownership, immutable revisions, and closed private uploads.
Physical iPhone and spoken VoiceOver testing remain explicitly deferred by the
user. A new release does not turn those deferrals into passes.

## Acceptance criteria

- An account deletion authorized with an old password/session cannot commit
  after password reset, password change or session revocation wins. Its losing
  transaction leaves the account, projects and deletion receipts unchanged.
  Ordinary valid deletion still succeeds. Accounts with private file records
  fail closed before object deletion until a durable cross-store cleanup
  workflow is available; uploads must remain closed until that separate gate
  is met.
- A transient initial authentication failure exposes an accessible retry
  without falsely declaring the customer signed out or showing private content
  under an unknown session. Stale asynchronous replies cannot override a newer
  authentication decision.
- Password changes invalidate previously issued password-reset links in the
  same authentication transaction. Gemini brief responses have a streamed
  byte limit and bounded failure handling before parsing.
- A failed spatial page import offers an explicit safe recovery action rather
  than removing the entire application. Recovery does not run an automatic
  reload loop, discard saved browser drafts or expose raw errors/capabilities.
- Failed project-list requests offer an explicit retry. Leaving the spatial
  studio with unsaved layout, tour or camera edits warns before navigation or
  browser unload; clean views navigate normally.
- Current-worker public smoke checks require the spatial schema and expected
  capabilities. Explicit historical rollback checks retain their compatibility
  contract. Payments and private uploads stay closed in both environments.
- Restored backups pass the existing integrity/foreign-key checks and the
  shared required application schema contract. Missing tables, columns,
  indexes or immutable triggers fail verification even if SQLite itself reports
  `ok`. Only schema status and the number of required objects/columns checked
  enter the bounded manifest; customer rows and counts stay out.
- Exact-head and merged-main CI/CodeQL pass, including locked dependencies,
  local Worker/D1 race tests, migrations, build, both Worker dry runs and the
  high-severity dependency audit. The protected release then passes staging,
  authenticated canaries, production and a continuous 30-minute version-bound
  observation.

The release KPI is zero failures in these acceptance checks, zero high-severity
dependency advisories, zero synthetic test residue, and no unintended changes
to real customer records or external-service controls. Local timings and
bounded smoke checks are not a sustained-load SLA.

## Existing verified baseline

The preceding release is PR [#80](https://github.com/prakhar267/grihagrid/pull/80),
source `bc84a8c940675c5e21a07c20072762ea00bbb113`, production Worker
`ecf4ce8b-08f7-443b-a90f-dd93de305e57`. Its protected
[release](https://github.com/prakhar267/grihagrid/actions/runs/35008307975)
passed 623 tests and CodeQL, full V2 preview/save/reload checks in staging and
production, and one uninterrupted 1,800,556 ms observation with 231 successful
checks. The polished 20-second film and real production Gemini verification
remain preserved evidence; they are not new provider/render executions in this
cut.

## Operational boundaries

- Transactional email depends on a verified sender domain and delivery
  credentials. Password recovery and email verification remain visibly
  unavailable while that domain-related setup is excluded. Authenticated
  password rotation is not lost-password recovery.
- The paired Blender renderer runs on the customer's computer. A local service
  and pairing are required; production does not claim hosted GPU rendering.
- Browser-local drawing import does not enable server uploads. Private R2
  storage, its access grant, cross-store deletion and provider checks remain
  a separate activation gate.
- The GitHub smoke workflow is a best-effort hourly regression backstop;
  delayed or missed scheduled runs do not provide continuous two-region
  monitoring. Record actual successful run times, not only cron configuration.
- Scheduled production backups are encrypted and restore-checked. This is a
  public repository: encrypted Actions artifacts must not be described as
  operator-restricted storage. The encryption key remains separately protected;
  a private backup destination and a governed remote restore drill are separate
  operational decisions.
- Human legal/privacy review, practitioner review, incident staffing and
  independent security/accessibility certification are not supplied by passing
  automated tests. Do not advertise those services or approvals.

## Release evidence

This document defines the acceptance contract for this cut; it does not itself
certify a deployed version. The linked pull request and the exact merged-main
[protected release runs](https://github.com/prakhar267/grihagrid/actions/workflows/deploy.yml)
provide the authoritative CI, environment-version, canary and observation
evidence. The corresponding
[backup runs](https://github.com/prakhar267/grihagrid/actions/workflows/production-backup.yml)
must include successful integrity, foreign-key and required-schema verification.
Release sign-off records those exact run IDs and versions after completion.


## Subsequent operations follow-up

The [17 September operations record](production-operations.md) tracks independent
monitor activation, private backup storage and the non-destructive remote drill.
It distinguishes tested recovery tools and source-artifact verification from
service activation, account capacity and private-runner execution.
