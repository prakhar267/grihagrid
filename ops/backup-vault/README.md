# Private encrypted backup receiver

On 2 October 2026, the existing private repository
`prakhar267/grihagrid-backups` successfully retained a verified copy using only
its expiring `GITHUB_TOKEN`. No billing limit or credential scope was changed.
[Manual run 36932350443, attempt 2](https://github.com/prakhar267/grihagrid-backups/actions/runs/36932350443)
retained artifact `11196941803` from source run `36911420019`. Authenticated
verification confirmed exact ciphertext and manifest bytes, anonymous access
returned 404, and private expiry (7 October 22:02:42 UTC) precedes source expiry
(8 October 19:08:43 UTC). SQL was not decrypted during this copy verification.

The first attempt rejected a stale/future timestamp without retaining an
artifact. The same source passed the preceding permission probe and the single
rerun. Its cause remains unconfirmed; do not call it a resolved provider issue.
The receiver now identifies the exact rejected timestamp boundary using a
constant error code, while retaining all age checks and no automatic retry.

The reviewed workflow runs twice daily at 03:23 and 15:23 UTC and can also be
started manually. Keep `receive_backup.py` and this README at their matching
`ops/backup-vault/` paths in the private repository, and the workflow template at
`.github/workflows/receive-backup.yml`. Changes require a reviewed branch and
verification against the private repository's exact main commit.

The receiver uses read permissions, system Python, and pinned checkout/upload
actions. No personal OAuth token, encryption passphrase, or Cloudflare credential
belongs in the private repository. A 403 fails closed; never add a broad token
fallback. Failure creates a failed workflow with an error annotation and a
bounded job summary. Source backup incident monitoring remains in the public
application repository. Private-copy notification delivery to a human and an
independent uptime monitor remain unverified; a job summary is not an alert
receipt. GitHub documents that schedules can be delayed and notifications depend
on the owner's settings:
[scheduled workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule),
[workflow notifications](https://docs.github.com/en/actions/concepts/workflows-and-actions/notifications-for-workflow-runs).

The receiver pins the source repository ID, workflow ID/name/path and exact
workflow SHA-256. It accepts only a completed successful scheduled/manual main
run whose commit remains on main, with a uniquely named unexpired artifact from
that run. It checks the GitHub archive SHA-256, a maximum 16 MiB archive/member
size, a 16 KiB manifest limit, exact two regular filenames, ZIP CRC, GGRIDBK1
header and ciphertext SHA-256. It never extracts arbitrary archive paths or
decrypts SQL. Capture time must be within the run and no older than 26 hours
(five minutes of clock skew allowed); copying does not reset that time.
Private retention is a whole number of days, at most seven, calculated from the
source expiry with a three-minute margin exceeding the job's two-minute limit.
It normally yields five or six days and never extends the source retention.
A source with less than one whole safe day remaining fails closed.

Restore evidence must say integrity ok, zero foreign-key violations and current
schema with exactly 93 required objects and 192 required columns. Changes to the
backup workflow, key version or schema contract require a reviewed receiver
update. This verifies the trusted source's restore evidence; it does not perform
a new restore. The bounded receipt excludes SQL, customer records, credentials
and the Time Travel bookmark.

**The original encrypted copy remains in the public source repository until its
existing seven-day expiry.** This template adds a private copy; it does not change
the source artifact's visibility, retention or encryption key. Never describe
the backups as exclusively private. Neither Git repository history nor a deploy
key provides the artifact retention/access control needed for this design.

A regression check builds every current migration in SQLite and compares the
resulting restore contract with the receiver pins. A schema change therefore
requires an explicit receiver review instead of silently rejecting new backups.

Local verification: `node --test tests/backup-vault.test.mjs`. Tests use generated
synthetic ciphertext containers and fake API responses only, with no customer
data, provider calls or live GitHub writes.
