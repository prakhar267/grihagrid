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

This does not add email verification, MFA, password recovery, account deletion,
or a support override. It also does not conceal registration's existing
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
  claim otherwise; verified-email enrollment is future work.
- An attacker who knows or guesses a registered email can intentionally consume
  its 12 reservations and deny login until the fixed window expires. The window
  does not slide, a valid login clears it once admitted, and password rotation
  clears it for an already-authenticated owner, but targeted lockout remains.
  Risk-based challenges, verified recovery, and customer-safe unlock operations
  require a later product/security design.
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

## Password rotation product decision

GrihaGrid lets an authenticated customer replace a known password and revoke
every session created before that change. This closes a self-service account
security gap without claiming that email-based account recovery exists.

The feature is deliberately narrow:

- it requires the current password, a live same-origin session and valid CSRF;
- a successful change rotates the password record, authentication generation,
  session token and CSRF token as one D1 transaction;
- every older bearer session becomes unusable, including a login that verified
  stale credentials while the change was being committed; and
- it does not change the account email, recover a lost password, send email,
  delete data or alter any project, report, order or entitlement.

Transactional email is not configured. “Forgot password” remains unavailable
and must not be implied by this release.

## Password rotation customer problem and journey

An account owner who still knows the current password has no way to respond to
a suspected credential leak or revoke another signed-in browser. Logging out
only removes the current session.

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
