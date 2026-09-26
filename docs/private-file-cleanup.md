# Recoverable private-file removal

## Customer outcome

An eligible owner can close their account or remove an uploaded image even
when object storage is temporarily unavailable. Access ends at the committed
database deletion; a durable journal retries removal of the private bytes.

The journey is password-confirmed account deletion → atomic authorization and
record removal → an honest confirmation that private-byte cleanup may remain
pending. Financial retention and professional offboarding remain separate
blocking paths. No customer or provider account is modified by this change.

Acceptance requires real local D1 coverage of authorization races, transaction
rollback, storage failure, repeated cleanup, late uploads, tenant isolation and
legacy blocked files. A failed database transaction must produce zero storage
deletions. A failed storage deletion must retain a retry record. No successful
API response may promise that pending bytes have already been removed.

The operating KPI is zero overdue cleanup records after a healthy maintenance
run, with no readable deleted files. Monitor count and oldest age, never raw
object keys. Missing storage must preserve the journal. Activation additionally
requires verified private buckets, recurring maintenance in each environment,
capacity limits and actual provider tests; adding this code alone does not
enable uploads.

## Implementation contract

Migration 0025 adds an outbox outside account/project cascades. File metadata
deletion writes its storage key to that outbox in the same D1 transaction.
Account receipts retain counts and completion times, not identities or keys.
The worker deletes R2 only after the metadata commit; confirmed R2 removal and
journal completion are idempotent. Failed attempts retry with bounded backoff.

Uploads first record a delayed cleanup intent. Publishing ready metadata and
retiring that intent are one atomic batch, limited to the original live session
and a one-hour publication window. Expired or failed uploads cannot publish
after cleanup has claimed them. A bounded, cursor-based inventory reconciliation
also journals unreferenced canonical objects older than 24 hours, covering late
storage completion and database outages. Existing metadata always protects an
object from automatic orphan cleanup; arbitrary or legacy key formats are not
inventory candidates, but explicit owner deletion journals their exact keys.

Inventory admission uses one JSON-backed SQL insert per page, and cleanup
claims/completes up to 100 keys in bulk. A full inventory plus cleanup page uses
at most seven D1 statements, leaving room for existing maintenance under the
[free plan's 50-query invocation limit](https://developers.cloudflare.com/d1/platform/limits/).
R2's documented bulk delete accepts up to 1,000 keys; this path uses at most 100.

The existing production daily maintenance runs a bounded batch. Staging has no
cron slot today; do not activate staging uploads without arranging recurring
maintenance and verifying it. Restore procedures must reconcile cleanup intents
against restored metadata before processing them.

## Verification — 26 September 2026

Local `npm ci`, `npm run check` (949 tests), all 25 forward migrations, both
Worker deployment dry runs, operational checks, dependency audit (zero
vulnerabilities) and whitespace checks passed. Focused D1 tests cover storage
outages, rollback, stale inventory cursors, session races, late files, in-flight
uploads, legacy references and bounded bulk cleanup.

Actual local browser uploads and deletions against D1/R2 verified pending removal
with storage disconnected, incorrect-password preservation and focused errors,
confirmation surviving navigation/reload, 390px and desktop layout, and an empty
console error log. Restoring storage and invoking scheduled maintenance drained
both synthetic accounts' remaining objects and completed both receipts. No real
customer data was used. The shared login layout also has zero overflow at native
Chrome 200% zoom; that separate check did not include the deletion confirmation.
Physical iPhone, spoken VoiceOver, and print/reduced-motion inspection of the new
confirmation state remain unverified. CI and protected release evidence belong
to the exact PR and workflow run, not this local verification record.
