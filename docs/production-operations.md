# Production operations follow-up — 17 September 2026

## Customer outcome and scope

The deployed free planning and spatial studio already passed the protected PR
#81 release. This follow-up concerns detecting an outage, retaining an encrypted
recovery copy with private access, and rehearsing recovery without touching the
live databases. It excludes custom domains, payment activation, private
uploads, purchases, and the previously deferred iPhone/VoiceOver checks.

The operator journey is: receive an actionable failure alert, select a recent
verified encrypted backup, restore into a newly created isolated D1 database,
verify it, and remove only that drill resource after reviewing its evidence.

## Acceptance and guardrails

- Production and staging continue serving the previously accepted Worker
  versions with payment and private-upload controls closed.
- An independent monitor checks the production readiness URL and has an
  owner-controlled alert destination. A submitted setup request or configured
  cron is not evidence of active monitoring or delivered alerts.
- Private backup storage requires verified private access, an intact encrypted
  envelope, matching SHA-256, and a bounded retention period. The source workflow continues publishing encrypted public artifacts for its
  original seven-day retention. A private copy restricts only that additional
  copy; it does not make source artifacts private.
- Remote recovery must target a fresh database UUID, never an existing
  production or staging binding. Check capacity before exporting customer data.
  Validate the recovered schema, local integrity, remote quick-check, foreign keys and table-count
  parity with the exact captured export. Record elapsed time and evidence.
- Deletion is a separate operation fenced by the newly created resource's
  exact name/UUID and reviewed evidence hash. Never remove an existing database
  to make room. Never expose restored customer data through a public app route.
- Missing capacity, credentials or owner activation is recorded as blocked,
  not passed. No subscription upgrade, broad persistent token, credential
  disclosure or new provider account is inferred from a successful local test.

Success means verified monitoring, privately retained and verified ciphertext,
and a completed non-destructive remote recovery rehearsal. Recovery SQL checks
alone do not establish application canaries or the full four-hour recovery
objective. These changes do not modify application behavior, but the existing
protected release workflow classifies operational scripts as deployable. Follow
its staging-first validation and production observation before closing the release.

## Current infrastructure constraints

The authenticated Cloudflare account lists 10 D1 databases. Cloudflare documents
[10 databases on Workers Free](https://developers.cloudflare.com/d1/platform/limits/).
The restore tool must refuse to export or create a database at this configured
limit. Free capacity must become available through an independently approved
resource decision before the remote exercise can run.

The existing OAuth grant has D1 access but no R2 access. Private uploads remain
closed. Backup setup must not activate R2, change account billing, reuse another
project's resources, or copy a personal GitHub token into automation.

For independent monitoring, the public endpoint is
`https://grihagrid.prakhargupta267.workers.dev/api/readiness`.
[UptimeRobot's documented free agent setup](https://uptimerobot.com/quick-monitor-setup/)
can request five-minute HTTPS checks without a persistent API credential, but
requires the owner to confirm the activation email. Until the monitor is
activated and its alert path is exercised, external monitoring remains open.

## Dated verification and owner dependencies

At 2026-09-16 18:56 UTC (17 September local time), production and staging both
returned HTTP 200 with all expected schemas current. Production Worker remained
`74add775-956d-44e8-bc15-97b03bc898a5`; staging remained
`70ba7d78-f04c-4448-b4d8-d7dfc53ec6bb`. Paid checkout, paid fulfillment and private
uploads were false, while Professional Handoff retained its enabled state.

The private repository
[`prakhar267/grihagrid-backups`](https://github.com/prakhar267/grihagrid-backups)
was created and its private visibility verified. GitHub's signed-in Billing UI
showed a $0 Actions budget with Stop usage enabled. The manual read-only
[permission probe](https://github.com/prakhar267/grihagrid-backups/actions/runs/35137667590)
was rejected before any job step ran: GitHub reported an account payment or
spending restriction. Therefore cross-repository artifact access is **untested**,
no private backup artifact exists, and no receiver schedule is enabled. An empty
private repository is not a completed private backup service.

The unchanged source backup workflow continues publishing encrypted artifacts
in the public repository with seven-day retention. This includes future backups
as well as existing artifacts; a private receiver cannot change source access. The latest observed successful production export is
[run 35130082296](https://github.com/prakhar267/grihagrid/actions/runs/35130082296),
with artifact `10460952185`, created 2026-09-16 17:50 UTC and expiring September
23. This observation is not a new decryption or remote-restore verification.

Remaining owner dependencies are independent-monitor email activation, a usable
private backup runner/storage credential, and a spare D1 database slot. Neither
raising spending limits nor deleting an existing database is authorized by this
follow-up. Domain-dependent recovery mail remains outside scope.

## Recovery tool

`node scripts/remote-restore-drill.mjs preflight --directory <new-directory>`
only lists database metadata and writes a protected receipt. Its parent directory
must already exist; it never exports, creates or imports data, even when capacity
is available. At the current account limit it reports `capacity_blocked`.

Once capacity is separately available, the `run --directory <new-directory>`
command creates a new clone and validates the exact export against that clone.
The local copy gets full integrity checking; remote D1 gets `PRAGMA quick_check`.
Both get foreign-key and required-schema checks. Aggregate parity covers every
non-internal table in that export, including spatial and account-lifecycle data.
Wrangler disk logs are disabled, customer values never enter the public summary,
and the plaintext file is removed in the handled success/failure paths. A forced
process or machine termination may require protected-directory cleanup by the
operator; do not assume a finally block survives a power loss.

A creation timeout is explicitly uncertain and requires name/UUID reconciliation.
Successful core verification is `core_verified_pending_app_canaries`, not a full
recovery pass. Login/ownership/report/cache route canaries still need a separately
reviewed private runner bound only to the clone, with outbound providers disabled.

Cleanup is deliberately separate. After independent evidence review, supply the
receipt path, its SHA-256, exact clone database ID/name, and reviewer identity to
`cleanup`. The tool rejects production/staging IDs, pre-existing IDs, changed
receipts, mismatched names and missing remote identity. No automatic cleanup is
permitted when the outcome of creation is unknown.


The live capacity-only preflight subsequently returned `capacity_blocked` with
10 databases and performed no export, create, import or deletion. The receiver
verifier also validated real source artifact `10460952185` using the existing
operator CLI session: archive SHA-256
`4ce3e4bb7bc2e05b132ff8c83cfe8f96c7cb67e5dfdf59c70dc1663ea7c5692b`,
ciphertext SHA-256
`5a45f5072c1554b5b59746fbb391a4c7c0dd63abb0d3e6fa567e703e200b068b`,
and source restore manifest for 83 required objects and 173 columns matched.
The temporary local ciphertext copy was removed after verification. No SQL was
decrypted, private artifact uploaded or remote recovery performed by that check.
The calculated private retention was six days, conservatively bounded by the
source's original expiry. See `ops/backup-vault/README.md` for the manual receiver
activation and verification contract.
