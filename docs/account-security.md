# Account authentication security

## Login defense product decision

### Bounded problem

The existing per-IP login limit cannot bound password verification for one
account when an attacker distributes requests across many addresses. Login also
must not expose whether an email belongs to an active, deleted, malformed, or
temporarily fenced credential record through its status, code, message, or
PBKDF2 work.

Migration `0017_login_attempt_fence.sql` adds one narrow control for the
email-and-password login endpoint:

- KV is a fail-closed 12-attempt, fixed-15-minute per-IP perimeter;
- D1 reserves at most 12 password-verification attempts for a real `user_id`
  in one fixed, non-sliding 15-minute window, even across concurrent IPs;
- the D1 reservation happens before PBKDF2;
- an unknown account, deleted account, invalid password shape, malformed stored
  credential, wrong password, or closed account fence performs exactly one real
  or dummy PBKDF2 derivation and returns the same `401 invalid_credentials`;
- a successful exact-state session transaction and a successful password
  rotation clear the account fence; and
- the fence stores no email, IP address, IP-derived value, password-derived
  value, bearer, or free text in D1 or operational logs.

The 0017 login-fence control itself does not add email verification, MFA,
password recovery, account deletion, or a support override. The separate 0018
account-lifecycle migration now supplies verification, recovery, export, and
ordinary deletion without changing this fence. Registration's existing
`409 email_in_use` response; that residual enumeration surface is explicit
below.

### Strict registration and login schemas

`POST /api/auth/register` accepts one JSON object with only `email`, `password`,
and optional `name`. `email` and `password` must be present primitive strings;
if `name` is present, it must also be a primitive string. Missing required
fields, unknown fields, arrays, objects, booleans, numbers, or null in those
positions return `400 invalid_registration`. Value validation remains separate:
email normalization/errors use `invalid_email`, password length uses
`invalid_password`, and a supplied non-empty normalized name must be 2–80
characters or returns `invalid_name`. Passwords are 10–128 characters; emails
are trimmed, lower-cased, syntactically validated, and capped at 254 characters.

`POST /api/auth/login` accepts exactly two own fields, `email` and `password`,
both primitive strings. Missing, extra, or non-string fields return
`400 invalid_login`; a syntactically invalid email string remains
`400 invalid_email`. A primitive password string outside 10–128 characters is
not a structural oracle: it follows the same one-derivation and generic-401 path
as every other credential failure.

Malformed JSON, a non-object root, an oversized body, or the wrong media type
continues to use the common JSON boundary errors. Neither endpoint accepts
client-supplied user IDs, session state, fence values, roles, generations, or
credential parameters. Registration also requires its healthy fail-closed
8-attempt per-IP KV perimeter; missing or failing KV is
`503 abuse_control_unavailable` before account creation.

### Login journey

1. The customer submits the exact login object from a trusted origin.
2. The Worker requires healthy `GRIHAGRID_CACHE` and reserves the request at the
   fixed per-IP boundary. Missing or failing KV returns
   `503 abuse_control_unavailable`; an exhausted IP perimeter remains the
   documented `429 rate_limited` response.
3. After strict shape and email validation, the Worker looks up the candidate
   credential state. Unknown emails execute the same reservation statement with
   no subject and create no attacker-controlled D1 row.
4. For a real subject, one conditional UPSERT creates, advances, or atomically
   resets `login_attempt_fences`. The first reservation fixes `expires_at` 15
   minutes later; later requests do not slide it. Request 13 is not admitted.
   A missing table or failed D1 reservation returns
   `503 abuse_control_unavailable` before PBKDF2.
5. The request performs exactly one bounded PBKDF2-SHA256 derivation. Only an
   active admitted user with a valid stored record uses that record; every
   other credential state uses the dummy verifier. Credential failures and a
   closed account fence all return the same status, code, and message.
6. A valid password creates a generation- and opaque-revision-fenced
   session. The session insert and deletion of that user's login fence are one
   D1 batch; the delete is gated by the exact session inserted by this request.
   A failed or stale session transaction therefore cannot erase another
   request's fence.

### Login security invariants

- The account window admits at most 12 reservations, not 12 per IP. Wrong and
  correct submitted credentials both consume a reservation until an exact
  successful session commit clears it.
- `login_attempt_fences` is keyed only by `user_id` and contains canonical
  window timestamps, count, and limit. It has no email/IP/password material;
  the existing short-lived KV perimeter uses a SHA-256-derived IP key and is
  never an account or entitlement ledger.
- The fence is fixed and non-sliding. An expired row is reset atomically by the
  next reservation even if scheduled cleanup has not yet removed it.
- Active, wrong-password, unknown, soft-deleted, malformed-credential, and
  account-fenced paths each perform one real-or-dummy derivation before the
  generic credential response. Logs record only the templated route, bounded
  outcome/status, release, duration, and opaque request ID.
- A successful password rotation deletes the same user's login fence inside
  the exact replacement-session transaction. Failure or a losing concurrent
  rotation leaves the fence and authentication state consistent.
- The foreign key cascades the fence on an authorized user-row deletion. It
  does not create an account-erasure workflow or authorize direct user deletes.
- Login defense never changes project, report, feedback, order, payment,
  fulfillment, file, or upload state.

### Login acceptance criteria

1. Exact registration/login objects accept the documented primitive strings;
   every missing, extra, confused-type, malformed, oversized, or wrong-media
   request receives its bounded structural/value error with zero credential,
   session, or fence mutation beyond the earlier per-IP admission where
   applicable.
2. Twelve concurrent distributed requests for one real account reserve at most
   12 PBKDF2 checks in one fixed window. Request 13 and later account-fenced
   requests still perform one dummy derivation and return the same generic 401;
   their requests do not extend `expires_at`.
3. Unknown, wrong-password, deleted, malformed-record, short/long-password, and
   fenced fixtures have identical `401 invalid_credentials` envelopes and one
   derivation each. No test asserts wall-clock equality as a security proof;
   code-path and call-count evidence is required instead.
4. Missing/failing KV or a missing/failing/contended D1 admission query returns
   `503 abuse_control_unavailable` before credential verification or session
   mutation. The fail-open path is zero.
5. A correct login inserts exactly one auth-state-fenced session and deletes
   its fence in the same successful batch. Injected batch failure, a concurrent
   password change, or a non-matching insert cannot clear the fence or leave a
   usable stale session.
6. A committed password rotation clears the fence with its exact replacement
   session; a rolled-back or losing rotation changes neither authentication
   state nor fence state.
7. Readiness is current only with the complete migration 0015 authentication
   inventory plus the migration 0017 fence columns and expiry index, and with
   configured KV. Paid checkout, fulfillment, plan allowlist, and private
   uploads remain closed throughout release testing.

### Login KPI and guardrails

The security KPI is zero real-account windows with more than 12 admitted
password verifications. Release and operational measurement uses aggregate
templated login route/status/outcome counts and latency only; it does not emit a
product event or retain an account, email, IP, fence key, password shape, or
credential-derived dimension.

Guardrails are zero fail-open KV/D1 paths, zero stale-session acceptance, zero
successful-session/fence split commits, zero auth material in output or logs,
no meaningful regression in successful-login availability/latency, and no
change to commerce/upload containment. A rise in generic 401s can trigger
aggregate investigation, but operators must not create per-email monitoring to
make attribution easier.

### Residual risks

- Registration still returns `409 email_in_use` for an existing normalized
  email, so account enumeration remains possible there. This release does not
  claim otherwise. Verified-email enrollment is implemented, but does not
  conceal registration and remains unavailable for delivery until its provider
  sender and secret are configured.
- An attacker who knows or guesses a registered email can intentionally consume
  its 12 reservations and deny login until the fixed window expires. The window
  does not slide, a valid login clears it once admitted, and password rotation
  clears it for an already-authenticated owner, but targeted lockout remains.
  Verified password recovery is now available when email delivery is configured;
  risk-based challenges and a customer-safe unlock design remain future work.
- The controls bound online password checks; they do not provide MFA, breached-
  password screening, offline hash resistance beyond the versioned PBKDF2
  record, or proof against all network-level timing analysis.

### Migration, readiness, cleanup, release and rollback

`0017_login_attempt_fence.sql` creates `login_attempt_fences` with only
`user_id`, `window_started_at`, `expires_at`, `request_count`, `limit_count`,
and `updated_at`, plus `idx_login_attempt_fences_expires`. It rewrites no user,
session, project, report, order, or payment row and must start with zero fence
rows on first application. `GET /api/readiness` reports `authSchema=current`
only when this exact table/column/index contract and migration 0015's account,
session, password-change-admission, and authentication-guard inventory all
exist. The folded inventory remains one bounded readiness query; account
security still requires healthy KV.

The daily scheduled handler runs:

```sql
DELETE FROM login_attempt_fences WHERE expires_at<=datetime('now');
```

Cleanup is retention only: an expired row already permits an atomic fresh
window. Release evidence must include the first-apply zero-row assertion,
`loginAttemptFenceRows`, `loginAttemptFenceMigrationPending`, exact table/index/
column inventory, no pending migration, an empty foreign-key check, unchanged
canonical users/sessions and protected row counts/hashes, encrypted backup and
Time Travel evidence, local concurrent reservation/derivation tests, staging
synthetic fence/reset/success/rotation cleanup, normal production login/session
canary, privacy-safe logs, exact-version readiness, and the 30-minute
observation. No release may generate account-specific evidence from a real
customer.

The migration is additive and the prior Worker can read the expanded database,
but it ignores the new table: it neither reserves nor clears the D1 account
fence and may restore the older authentication-abuse behavior. That is an
explicit security downgrade, not transparent rollback. Keep paid/upload
controls closed, use a quiet bounded emergency window with incident authority,
prove the current harness against the exact old Worker, and roll forward as
soon as possible. Existing fence rows remain data, expire naturally, and are
honored after roll-forward. Never drop the table, weaken its constraints, or
rewrite migration history to make an old Worker appear equivalent.

## ID-06 session review and password-confirmed bulk revocation

### Product decision and bounded scope

An authenticated customer can review the account's valid session boundaries
and close every pre-existing session without changing a password they still
trust. This is intentionally a privacy-minimized security control, not a device
inventory or an account-recovery flow.

- Review includes the current session first and at most the 20 newest other
  unexpired sessions that match the current authentication generation and
  opaque revision. `hasMore` says whether still earlier matching sessions were
  omitted.
- Every public row contains exactly `current`, `startedAt`, and `expiresAt`.
  The response never exposes a session/account ID, bearer or CSRF value,
  user-agent, browser, device, IP address, location, last-active value,
  authentication generation, or authentication revision.
- “Sign out other sessions” requires the exact current password. Success
  replaces this browser profile's session boundary, revokes every session that
  existed before the transaction, and leaves the password record unchanged.
- The action remains available when review shows only the current row. A copied
  current bearer is the same server session and cannot truthfully be rendered
  as a separate device; replacing the boundary still invalidates every copy.
- Anyone who knows the unchanged password may sign in again after revocation.
  If access is unfamiliar or the credential may be known, the customer should
  use the separate password-rotation control immediately afterward.
- No email, push, in-product inbox, or other important-security-event
  notification is sent. That part of ID-06 remains future work, so ID-06 is
  implemented only partially.

### Customer journey and interaction contract

1. The customer opens **Account security** from the private workspace.
2. The page loads a read-only session review. The current cookie is represented
   first; other rows are ordered newest first and described only by start and
   expiry time. Copy explicitly explains that device and location labels are
   unavailable.
3. The customer can open **Sign out other sessions** even when the list contains
   only the current row. The password field receives focus and has the
   `current-password` autocomplete hint.
4. The customer enters only the current password. The browser sends no session
   ID, target list, device selection, or replacement credential.
5. On confirmed success, both secure cookies are replaced, the review collapses
   to one current row, focus moves to the success message, and the copy warns
   that the unchanged password can be used for a new login.
6. A known validation/authentication failure is actionable. A response-loss or
   unexpected server/network failure is treated as ambiguous: the UI does not
   claim success, clears and collapses the password field, and blocks another
   revocation attempt until the customer reloads the security check or signs
   in again. Reload immediately moves focus to its loading status, then to the
   refreshed summary or bounded error instead of dropping keyboard focus.

Session review and password rotation cannot submit concurrently. Loading,
empty/current-only, truncated, wrong-password, fail-closed, success, conflict,
expired-session, and ambiguous states remain keyboard-operable and announced.
Print excludes the session list, sign-in times, password control, and result
details.

The complete Account Security page is keyed to the authenticated account ID.
If another tab changes the browser profile from one account to another, focus
or resume reconciliation remounts the page before rendering the replacement
account. That clears the prior account's session timestamps, password fields,
pending requests, and result messages instead of carrying private state across
the account boundary.

### `GET /api/auth/sessions`

Requires a live session and returns `Cache-Control: no-store`. The successful
shape is exact:

```json
{
  "sessions": [
    {
      "current": true,
      "startedAt": "2026-08-17 10:00:00",
      "expiresAt": "2026-09-16 10:00:00"
    },
    {
      "current": false,
      "startedAt": "2026-08-16 08:30:00",
      "expiresAt": "2026-09-15 08:30:00"
    }
  ],
  "hasMore": false
}
```

The current session is always the first and only `current: true` row. The
remaining list contains at most 20 current-authentication, unexpired rows,
newest first. The Worker reads one extra row only to derive `hasMore`; it never
returns that sentinel. Expired rows and rows from older generation/revision
boundaries are excluded.

The read is observational: it does not update `last_seen_at`, delete expired
rows, rotate a token, or mutate the user/session records. Missing authentication
is `401 unauthenticated`. A database/query failure, missing current row,
duplicate/malformed shape, invalid canonical timestamp, or expiry not later
than start fails closed as `503 session_review_unavailable` instead of returning
a plausible partial list.

### `POST /api/auth/sessions/revoke-others`

The request body must be one JSON object with exactly one primitive-string
field:

```json
{ "currentPassword": "the customer's current password" }
```

The endpoint requires a trusted same-origin request, live session, matching
CSRF cookie/header/hash, and healthy KV before it will verify the password. Its
endpoint-specific KV perimeter admits at most 10 attempts per IP in 15 minutes.
The same strongly consistent D1 `password_change_attempt_counters` admission
used by `PUT /api/auth/password` admits at most five total current-password
checks per account in each fixed 15-minute window across both controls. Six
mixed password-change/revocation attempts therefore cannot yield six password
verifications. Missing or failing KV/D1 admission is
`503 abuse_control_unavailable`; exhaustion is `429 rate_limited`.

Missing, extra, inherited, or non-string fields return
`400 invalid_session_revocation`. A supplied string outside the 10–128
character credential boundary receives dummy PBKDF2 work and follows the
incorrect-current-password path. A wrong password returns
`401 current_password_incorrect`; a lost authentication race returns bounded
`401 unauthenticated` or `409 auth_state_changed`. None of those paths may
claim revocation or partially mutate authentication state.

After password confirmation, one D1 batch:

1. conditionally advances `users.auth_generation` by exactly one and installs a
   fresh `auth_revision_id`, fenced by the prior generation/revision and the
   complete existing password record;
2. deletes every session for the account only if that new generation/revision
   and password hash are current; and
3. inserts one replacement session fenced by the new generation/revision and
   unchanged password hash.

The batch does not write `password_hash`, `password_salt`,
`password_iterations`, `password_algorithm`, or `password_changed_at`. It also
does not delete or reset `login_attempt_fences`; revoking sessions must not
silently reopen login. Any batch failure rolls back the generation/revision
bump, all deletes, and replacement insert together. Concurrent requests have
one winner; the loser cannot delete the winner's replacement.

Success returns `200`, replaces both secure cookies, and returns only the
public user, replacement CSRF token, one current session projection, and
`hasMore: false`:

```json
{
  "user": {
    "id": "account UUID",
    "email": "owner@example.com",
    "name": "Owner",
    "createdAt": "2026-08-16 00:00:00"
  },
  "csrfToken": "replacement browser token",
  "sessions": [
    {
      "current": true,
      "startedAt": "2026-08-17 10:05:00",
      "expiresAt": "2026-09-16 10:05:00"
    }
  ],
  "hasMore": false
}
```

### Acceptance criteria

1. Review returns exactly one current row followed by no more than 20 newest
   other current-authentication, unexpired rows; `hasMore` is true exactly when
   another matching row exists beyond the cap.
2. Review is byte-shape bounded and read-only. It exposes only
   current/start/expiry and contains no identifier, user-agent, device, IP,
   location, last-active, token, email, generation, or revision data.
3. The revoke request accepts only `currentPassword` and fails closed on
   origin, session, CSRF, KV, D1 admission, password, malformed-body, or
   authentication-race failure with no false success.
4. Password rotation and bulk revocation share one five-per-account/15-minute
   D1 password-verification boundary, including concurrent mixed requests.
5. A successful revoke advances only authentication generation/revision,
   deletes every pre-existing session, creates exactly one replacement, and
   leaves every password field, `password_changed_at`, and the login-attempt
   fence byte-equivalent.
6. Every retained old bearer returns `401`; the replacement works. A later
   login with the unchanged password succeeds and appears as a new
   post-boundary session.
7. Two concurrent revocations yield one committed boundary. Injected failure
   at update, delete, or replacement insert leaves the complete prior boundary
   usable and cannot clear or mutate the login-attempt fence.
8. The current-only UI retains the action and explains copied-bearer limits;
   desktop, 390 px, keyboard, screen reader, 200% zoom/text spacing, high
   contrast, reduced motion, slow/error states, and print pass without leakage.

### KPI and guardrails

The launch KPI is the aggregate count of confirmed customer-initiated bulk
revocations, with session-review success rate and latency as operational
diagnostics. Measurement uses only templated route, bounded outcome/status,
release and duration. It creates no product event and retains no account,
session, password, IP, timestamp-list, or device dimension.

Guardrails are zero old-bearer acceptance after a confirmed boundary, zero
password or `password_changed_at` mutation, zero login-fence clears, zero
split generation/session commits, zero session-identifying or fingerprinting
data in API/UI/logs, zero false-success UI states, p95 below the normal 500 ms
API target, zero accessibility-critical defects, and no change to paid,
fulfillment, allowlist, upload, project, report, order, or payment state.

### Migration, release, rollback, and manual QA

This cut adds **no D1 migration**. Migration `0015_account_security.sql`
already documents and permits a generation-only increment with a fresh opaque
revision while prohibiting `password_changed_at` changes when the credential is
unchanged. The existing session-generation columns, immutable-session trigger,
password-change admission table, and migration `0017` login fence are the exact
schema used here. Do not add an empty migration, change an applied migration,
or reset either admission table for this feature.

Release evidence must show zero unexpected pending migrations in staging and
production, `authSchema=current`, healthy KV, exact-SHA CI/CodeQL, real-D1
bounded-list/privacy/atomicity/race tests, production and staging Worker dry
runs, an authenticated synthetic with exact account-scoped cleanup, public
smoke, the serving Worker version, privacy-safe route logs, and the 30-minute
exact-version observation. Real-local D1 tests prove current-plus-20
truncation, read purity and byte-equivalent credential, timestamp and login-
fence state. The deployed synthetic deliberately uses two sessions and proves
identifier-free review, boundary rotation, both old-bearer rejections, one
working replacement, unchanged-password post-boundary login, password rotation
and paid/upload controls still closed. Its bounded evidence never contains the
raw account ID; operations must privately resolve the unique synthetic, match
the returned ID hash, prove zero customer-owned rows, delete only that exact
account and verify user/session/auth-counter absence. An ambiguous registration
without a verified ID hash stops for manual investigation and is never automatic
deletion authority.

Rollback uses the prior known-good Worker; there is no migration to reverse.
A completed generation-only boundary is durable: rollback must not restore an
old bearer, password, or session row, and the unchanged password remains the
credential. The older UI/Worker may temporarily remove the review/revoke
capability but remains compatible with the unchanged 0015/0017 schema. Record
that active prior version and its successful release evidence as the known-good
rollback target. The workflow's previous-Worker compatibility rehearsal runs
only when a migration is present; if any migration enters this release, that
rehearsal becomes mandatory. Roll forward to restore ID-06; never decrement a
generation, reuse a revision, rewrite migration history, or manually recreate
deleted sessions.

Manual QA must use only synthetic accounts and retained synthetic cookies:

| Area | Required check |
|---|---|
| List boundaries | Exercise current-only, 1/20/21+ other sessions, expired and stale-generation rows; require current first, newest matching others, exact `hasMore`, and no read mutation. |
| Privacy | Inspect DOM, API, print, storage, analytics and logs; require only current/start/expiry with no IDs, UA/browser/device, IP, location or last-active data. |
| Copied bearer | Copy the current bearer, keep the visible list current-only, revoke, and require both retained copies to fail while the replacement succeeds. |
| Step-up and shared limit | Mix password rotation and revoke guesses from concurrent IP fixtures; exactly five account checks are admitted per 15-minute window and every fail-closed path makes no boundary claim. |
| Atomicity and races | Inject each batch failure and race two revokes/login; require one winner or complete rollback, one replacement, no stale login, and an unchanged login fence. |
| Credential boundary | Compare every password field and `password_changed_at` before/after, then log in with the same password; all remain unchanged and the post-boundary login is valid. |
| Interaction | Test loading, retry, current-only, truncated, wrong-password, expired-session, response-loss/ambiguous, conflict and success states with keyboard and screen-reader announcements. |
| Responsive/print | Verify 390 px, 200% zoom/text spacing, contrast, reduced motion, no horizontal overflow, stable focus, and print exclusion of session/password details. |
| Release containment | Record exact SHA/version and no-pending-migration evidence; confirm checkout, fulfillment, allowlist and private uploads remain closed before and after the canary. |

## Password rotation product decision

GrihaGrid lets an authenticated customer replace a known password and revoke
every session created before that change. This known-password path remains
separate from the one-time-token recovery flow added by migration 0018.

The feature is deliberately narrow:

- it requires the current password, a live same-origin session and valid CSRF;
- a successful change rotates the password record, authentication generation,
  session token and CSRF token as one D1 transaction;
- every older bearer session becomes unusable, including a login that verified
  stale credentials while the change was being committed; and
- it does not change the account email, recover a lost password, send email,
  delete data or alter any project, report, order or entitlement.

“Forgot password” is implemented as a non-enumerating, one-time fragment-token
flow. It remains fail-closed until a verified sender, Resend secret, and provider
delivery evidence are configured.

## Password rotation customer problem and journey

Session-only bulk revocation closes every bearer that exists at its boundary,
but anyone who knows the unchanged password may immediately sign in again.
Password rotation is therefore the stronger response to a suspected credential
leak. Ordinary logout still removes only the current session.

1. The authenticated customer opens **Account security** from the private
   workspace account control.
2. The page explains that the current browser receives one replacement session
   and all sessions created before the change are revoked.
3. The customer enters the current password, a new password and confirmation.
   Confirmation is browser-only and is never sent to the Worker.
4. `PUT /api/auth/password` verifies origin, session, CSRF, strict request shape,
   fail-closed abuse control and the current password.
5. D1 conditionally advances the user's authentication generation, writes a new
   independently salted password record, deletes every earlier session and
   inserts exactly one replacement session in one batch.
6. The response replaces both secure cookies. The current workspace remains
   open; older copied cookies and other browsers receive `401 unauthenticated`.

Cookies are shared between tabs in one browser profile. Those tabs receive the
replacement cookie and may remain signed in; the product therefore says
“older sessions and other browsers,” not that every same-browser tab closes.

## Password rotation API contract

### `PUT /api/auth/password`

Request body:

```json
{
  "currentPassword": "the customer's current password",
  "newPassword": "a new password between 10 and 128 characters"
}
```

The root object must contain exactly those two string fields. The endpoint
requires a live session, trusted same-origin request and CSRF header/cookie/hash
agreement. KV is the fail-closed IP perimeter. A strongly consistent D1
conditional UPSERT admits no more than five password-verification attempts for
the account in each fixed 15-minute window, including concurrent requests.
Missing or failing KV or D1 admission returns `503 abuse_control_unavailable`
before password verification or credential mutation.

The current password is checked through the same bounded PBKDF2-SHA256 verifier
as login. The new password must meet the 10–128 character contract and differ
from the current password. Errors never return password material, hashes,
salts, generation values, session identifiers or account-discovery facts.

Success returns `200`:

```json
{
  "user": {
    "id": "account UUID",
    "email": "owner@example.com",
    "name": "Owner",
    "createdAt": "2026-08-16 00:00:00"
  },
  "csrfToken": "replacement browser token"
}
```

It also replaces `__Host-grihagrid_session` and `grihagrid_csrf` with the same
attributes used at login. Responses are `Cache-Control: no-store`.

## Password rotation concurrency and security invariants

- `users.auth_generation` and `sessions.auth_generation` are positive integers;
  their opaque `auth_revision_id` values also match exactly. The generation is
  monotonic while the revision makes every transition request-specific.
  A session authenticates only while both values exactly equal its owner.
- Registration starts both generations at one. Login snapshots the generation
  used for password verification and conditionally inserts only while that
  generation is still current.
- Password change compares and swaps from the authenticated generation. The
  session delete and replacement insert are gated by the newly written password
  record as well as the next generation, so a losing concurrent change cannot
  delete or replace the winner's session.
- A D1 batch failure leaves the old password and old sessions usable; a committed
  batch leaves only the new password and replacement session usable. There is no
  split state.
- The exact replacement-session batch also clears `login_attempt_fences` for
  this user. The delete is gated by the replacement session inserted by this
  request, so a failed or losing change cannot clear another request's fence.
- Reusing the current password is rejected. Neither password is logged, placed
  in a URL, analytics event, browser storage or error response.
- Ownership is established only from the session cookie. The request cannot
  name an account, session or generation.
- Password change never opens checkout, fulfillment or uploads and never alters
  project, report, feedback, family, payment or order records.

## Password rotation accessibility and interaction contract

- Current, new and confirmation fields have persistent labels and password
  autocomplete hints.
- Browser validation explains length and mismatch without sending the request.
- Pending, success and failure are announced; the form prevents duplicate
  submission, preserves input on a recoverable failure and clears all password
  fields after success.
- Focus moves only for route entry or an actionable validation/result message.
- The page remains keyboard-operable with visible focus, reflows at 390 px and
  200% zoom, has no horizontal overflow, respects reduced motion and hides the
  credential form when printed.

## Password rotation acceptance criteria

1. The correct current password and a valid different new password produce one
   replacement session; the old password and every pre-change bearer fail.
2. Wrong current password, same password, invalid lengths, scalar confusion,
   unknown fields, missing CSRF, cross-origin requests and missing/failing abuse
   control produce bounded errors with zero credential or session mutation.
3. Two concurrent changes have one winner. A login paused after old-password
   verification cannot create a surviving stale-generation session.
4. An injected D1 failure rolls back the password, generation, session delete
   replacement insert, and login-fence clear together.
5. Existing users and sessions remain valid immediately after migration 0015;
   both new and prior Workers can read the expanded schema for rollback.
6. Readiness reports `authSchema=current` only when both generation/revision
   pairs, the password-change timestamp, password-change admission table/index,
   login-fence table/index and both authentication-state guard triggers exist.
   Account security is available only when that schema and KV abuse control are
   ready.
7. The private `/security` route works on desktop, 390 px mobile, keyboard,
   screen reader, 200% zoom, text spacing, high contrast, reduced motion and
   print without exposing a password or token.

## Password rotation KPI and guardrails

The launch KPI is the count of successful customer-initiated password changes,
measured only through bounded operational route/status telemetry. No product
event is needed, and no account, session or password-derived value enters the
metric.

Guardrails are zero stale-session acceptance, zero split credential/session
transactions, zero password or bearer material in logs, zero account-security
cross-owner surface, zero accessibility-critical defects and no change to the
paid/upload fail-closed controls.

## Password rotation migration, release and rollback

`0015_account_security.sql` adds `users.auth_generation`,
`users.auth_revision_id`, `users.password_changed_at`,
`sessions.auth_generation`, `sessions.auth_revision_id`, the bounded
`password_change_attempt_counters` table with its retention index, and two
transition guards. Existing rows take generation one and a null legacy revision
while retaining their current password and session. The new counter table starts
empty and scheduled maintenance removes its rows after two days. No customer
row, project, report or order is rewritten.

Before remote migration, preserve the normal encrypted D1 export, checksum,
permissions, Time Travel bookmark and prior Worker version. After migration,
prove protected row counts and canonical project/report hashes are unchanged,
foreign-key checks return no rows and no migration remains pending. Rehearse
the prior Worker against the expanded schema before promotion.

Application rollback may use the prior Worker because the added columns have
compatible defaults and older explicit inserts ignore them. A session created
by the prior Worker for a generation greater than one may require a fresh login
after the current Worker is restored; it does not restore any pre-change bearer
or old password. Never remove the columns or rewrite D1 migration history.
