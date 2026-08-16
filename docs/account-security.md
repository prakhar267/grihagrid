# Account security and password rotation

## Product decision

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

## Customer problem and journey

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

## API contract

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

## Concurrency and security invariants

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
- Reusing the current password is rejected. Neither password is logged, placed
  in a URL, analytics event, browser storage or error response.
- Ownership is established only from the session cookie. The request cannot
  name an account, session or generation.
- Password change never opens checkout, fulfillment or uploads and never alters
  project, report, feedback, family, payment or order records.

## Accessibility and interaction contract

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

## Acceptance criteria

1. The correct current password and a valid different new password produce one
   replacement session; the old password and every pre-change bearer fail.
2. Wrong current password, same password, invalid lengths, scalar confusion,
   unknown fields, missing CSRF, cross-origin requests and missing/failing abuse
   control produce bounded errors with zero credential or session mutation.
3. Two concurrent changes have one winner. A login paused after old-password
   verification cannot create a surviving stale-generation session.
4. An injected D1 failure rolls back the password, generation, session delete
   and replacement insert together.
5. Existing users and sessions remain valid immediately after migration 0015;
   both new and prior Workers can read the expanded schema for rollback.
6. Readiness reports `authSchema=current` only when both generation/revision
   pairs, the password-change timestamp, D1 admission table/index and both
   authentication-state guard triggers exist. Account security is available
   only when that schema and KV abuse control are ready.
7. The private `/security` route works on desktop, 390 px mobile, keyboard,
   screen reader, 200% zoom, text spacing, high contrast, reduced motion and
   print without exposing a password or token.

## KPI and guardrails

The launch KPI is the count of successful customer-initiated password changes,
measured only through bounded operational route/status telemetry. No product
event is needed, and no account, session or password-derived value enters the
metric.

Guardrails are zero stale-session acceptance, zero split credential/session
transactions, zero password or bearer material in logs, zero account-security
cross-owner surface, zero accessibility-critical defects and no change to the
paid/upload fail-closed controls.

## Migration, release and rollback

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
