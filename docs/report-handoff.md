# Professional report handoff

Professional Handoff lets a project owner send a licensed architect or engineer
only the selected sections of one exact immutable schema-v2 planning report. It
is a free, paid-closed collaboration aid. It is not professional review,
approval, a construction instruction, or evidence that the recipient opened or
accepted the report.

## Customer contract

From an active saved report, the owner selects one to six unique sections from
`overview`, `programme`, `cost`, `timeline`, `risks`, and `next_actions`, then
chooses a 1, 7, or 30-day expiry. A successful first request returns one bearer
URL. The owner can see bounded metadata, copy the URL during that response, and
revoke the link at any time. Replaying the same idempotency key returns the same
record without returning the bearer URL again. Each project may have at most five
active links.

The public page returns only the expiry and selected report sections. It never
returns account, project, owner, share-record, token/hash, source-hash, input,
estimate-internal, feedback, AI-brief, file, order, payment, or Family Alignment
metadata. Missing or malformed tokens are indistinguishable `404`s. Expired or
revoked links are `410` and cannot be reactivated. The report stays pinned to the
original `(project_id, project_revision, report_schema_version=2)` record even if
the project later changes.

Anyone holding the URL can read the selected material until expiry or revocation.
Owners must therefore send it only to the intended professional. The link does
not identify or authenticate that recipient and must not be used for confidential
files, precise addresses, contact details, or professional sign-off.

## Storage and integrity

Migration `0016_report_handoff_links.sql` adds `report_shares`, bounded
`report_share_read_counters` and `report_share_create_counters` abuse-control
tables, and the single-row `report_handoff_controls` operations switch. D1
stores only SHA-256 token/idempotency/request digests, a secret-keyed hourly HMAC
pseudonym for public-read admission, the exact immutable report coordinates and
content hash, an allowlisted `sections_json`, expiry/revocation state, bounded
access counters, and timestamps. The bearer token and raw request IP are never
stored. Distinct environment-specific `REPORT_SHARE_ABUSE_HMAC_KEY` secrets
prevent cross-environment or cross-window correlation and can be rotated.

The composite foreign key targets `project_revision_reports`; project deletion
cascades the link. The required release objects are:

- indexes `idx_report_shares_owner_created`, `idx_report_shares_expiry`,
  `idx_report_shares_revoked`, `idx_report_share_read_counters_updated`, and
  `idx_report_share_create_counters_updated`;
- triggers `report_share_sections_insert_guard`,
  `report_share_identity_immutable`, `archived_report_share_insert_guard`, and
  `report_share_active_limit_insert`, plus
  `report_handoff_enabled_insert_guard`.

Those five guards independently enforce the section vocabulary, immutable source
and identity, archived-project write fence, monotonic revoke/access state,
supported expiry, five-active-link ceiling, and a strongly consistent enabled
control at the share insert itself. Application checks do not replace them.

## API and browser security

Owner routes require a secure authenticated session and project ownership. POST
and DELETE additionally require a trusted origin and matching CSRF token. POST
requires a bounded `Idempotency-Key`, exact request schema, fail-closed KV, and a
strong D1 quota of 20 admitted creations per account per fixed 24-hour window.
Exact replays are reconciled before normal admission. Foreign and missing owner
resources share the same `404` response.

The public API is `POST /api/shared/report` from the trusted application origin,
with an `application/json` media essence, at most 512 streamed bytes, and the exact body
`{ "token": "<43-character base64url capability>" }`; the customer URL is
`/share/report#<token>`. A URL fragment is retained by the browser and is never
sent in an HTTP request, referrer, Cloudflare Network Error Logging report, or
Worker invocation. The page sends the token only in the anonymous POST body,
with credentials omitted. The exact document route is `no-store`,
`noindex,nofollow,noarchive`, excluded by `robots.txt`, and uses
`Referrer-Policy: no-referrer`; the API is also `no-store` and bounded by public
read rate limiting. KV remains a fail-closed perimeter and uses its own
window-bound HMAC identity; a strongly consistent D1 conditional UPSERT admits
at most 120 reads per keyed, hourly request-IP pseudonym before any bearer
lookup, so parallel requests cannot bypass the ceiling.
Printing temporarily removes the fragment so browser/PDF headers cannot capture
it. Automatic Cloudflare invocation logs remain disabled
as defense in depth. Tokens and raw capability URLs must never enter analytics,
logs, monitor names, release artifacts, print/PDF output, tickets, screenshots,
chat, or referrers.

The only handoff product events are server-generated aggregate counters:
`report_handoff_link_created`, `report_handoff_opened`, and
`report_handoff_link_revoked`. They contain no owner, project, revision, share,
token, recipient, section, IP, user-agent, or free-text value.

## Retention and deletion

An expired or revoked record may remain for bounded support and abuse review.
Production scheduled maintenance deletes it only after the relevant closed
boundary is more than 90 days old. Active and recently closed links remain. A
whole-project privacy deletion cascades its links immediately. Hourly HMAC read
pseudonyms and account creation counters are abuse-control records, not recipient
identity; scheduled maintenance deletes both after two days. Account deletion
cascades its creation counters. Staging has no cron trigger because of the documented
account quota. The local real-D1 workerd gate seeds an over-90-day expired link,
an active historical link, and over-two-day read/create counters, invokes the same
scheduled handler, and proves only the eligible rows are removed. Production
promotion records dated bounded post-canary counts for all three retained stores.

## Operations switch and key

Creation and public redemption require the `report_handoff` control row to be
enabled. Migration `0016` creates that row disabled, and the release workflow
must prove the exact candidate under that closed state before any bounded
activation. Missing or malformed control state fails closed. Operations may set
it to `0` in the environment's D1 without deploying; owner listing and
revocation remain available so owners can close existing links. Readiness
continues to report the core service as ready but exposes
`checks.reportHandoffControl` and sets `capabilities.reportHandoff=false` until
the switch is restored.

Each environment also requires a distinct 64-hex-character
`REPORT_SHARE_ABUSE_HMAC_KEY` Worker secret. Missing or malformed key state fails
closed as `abuse_control_unavailable`; readiness exposes only
`checks.reportShareAbuseHashing=configured|unavailable`. Rotate the secret with a
cryptographically random replacement entered through Wrangler's secret prompt,
then re-run readiness and the public negative canary. Never print, export, copy
between environments, or place the value in a command argument or release artifact.

## Release and rollback gates

Final `GET /api/readiness` must report `checks.reportShareSchema=current` and
`capabilities.reportHandoff=true`. A migration release must also prove:

1. all four tables, every required index/trigger and every required column exist;
2. newly applied `report_shares`, `report_share_read_counters`, and
   `report_share_create_counters` start empty, the one control row exists and is
   disabled, protected user/session/project/report counts and canonical bytes
   are unchanged, the foreign-key check is empty, and no migration remains
   pending; later releases explicitly close the existing row before candidate
   activation;
3. three consecutive public smoke samples correlate the exact candidate Worker
   version while readiness still reports the control disabled and capability
   false;
4. one bounded step enables the control, proves that state, and runs the reviewed
   current authenticated harness, whose EXIT trap re-closes and re-verifies the
   control on both success and failure. The harness creates a share for its exact
   schema-v2 canary report, checks the returned `/share/report#<token>` URL
   without printing it, posts the capability to the constant public API without
   session cookies, proves exact selected-section
   redaction, revokes the link, observes `410`, deletes the synthetic project and
   logs out;
5. while the control remains re-closed, the exact-ID D1 residue query reports
   zero projects, revisions, current and historical reports, feedback, and
   `report_shares`, even after a failed canary; readiness remains false and a
   public redemption returns `503 report_handoff_disabled`;
6. only after those gates pass does a final fail-closed restoration enable the
   control, require readiness true plus missing-token `404`, and record bounded
   post-canary share/read/create counts without identifiers;
7. the previous Worker completes the current harness in legacy mode against the
   expanded schema and leaves the same zero residue before application rollback
   can be automatic.

Legacy mode deliberately skips the new readiness and handoff routes because the
previous Worker does not expose them. Migration `0016` is additive, so that
Worker can continue its older project/report flow during the bounded rehearsal;
it cannot create or serve Professional Handoff links. Roll forward to the current
Worker and recheck readiness before reopening the feature.

## Success and guardrails

The first product question is whether owners use a bounded report to start a
better professional conversation. Measure only aggregate create/open/revoke
counts. The primary KPI is the share of eligible schema-v2 reports with a
handoff created within seven days; public opens are directional only. Guardrails
are zero cross-account reads, zero unselected/private fields,
zero bearer values in telemetry, zero access after closure, zero mutable report
bytes, and timely 90-day cleanup. An opened link is not evidence of professional
acceptance, advice, approval, or a successful project outcome.
