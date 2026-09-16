# Private encrypted backup receiver (manual template)

This is a prepared receiver, **not a verified working private backup destination**.
The private repository `prakhar267/grihagrid-backups` exists. Probe run
[35137667590](https://github.com/prakhar267/grihagrid-backups/actions/runs/35137667590)
was blocked before job steps by GitHub's billing/spending gate. The account's
Actions budget is $0 with stop usage enabled. Do not increase that budget, enable
a schedule, or claim cross-repository artifact download works from this probe.
No backup was transferred by that run.

When the account gate is resolved without an unapproved purchase, copy
`receive_backup.py` to the same `ops/backup-vault/` path in the private repository
and copy `receive-backup.yml` to `.github/workflows/receive-backup.yml`. Review and
commit both on its main branch, then execute one manual probe. The receiver uses
only its job's expiring `GITHUB_TOKEN`, read permissions, system Python, and pinned
checkout/upload actions. No personal OAuth token, encryption passphrase, or
Cloudflare credential belongs in this repository.

The probe must demonstrate that this private repository's token can download the
public source artifact ZIP. Public metadata access alone does not prove ZIP
download permission. A 403 fails closed; do not add a broad token fallback.
Successful execution must be followed by authenticated verification of private
artifact visibility, matching ciphertext/manifest bytes and bounded expiry.
Only then consider a reviewed schedule and failure monitoring.

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
schema with exactly 83 required objects and 173 required columns. Changes to the
backup workflow, key version or schema contract require a reviewed receiver
update. This verifies the trusted source's restore evidence; it does not perform
a new restore. The bounded receipt excludes SQL, customer records, credentials
and the Time Travel bookmark.

**The original encrypted copy remains in the public source repository until its
existing seven-day expiry.** This template adds a private copy; it does not change
the source artifact's visibility, retention or encryption key. Never describe
the backups as exclusively private. Neither Git repository history nor a deploy
key provides the artifact retention/access control needed for this design.

Local verification: `node --test tests/backup-vault.test.mjs`. Tests use generated
synthetic ciphertext containers and fake API responses only, with no customer
data, provider calls or live GitHub writes.
