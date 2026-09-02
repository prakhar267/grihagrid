# Account lifecycle

Migration `0018_account_lifecycle.sql` adds one-time verification and recovery
tokens, bounded delivery-event evidence, deletion requests/receipts, and the
verified/deletion timestamps on users.

## Customer flow

- `POST /api/auth/email-verification/request` requires an authenticated session.
- `POST /api/auth/email-verification/confirm` consumes the one-time token and
  records `email_verified_at`.
- `POST /api/auth/password-reset/request` returns the same accepted response for
  known and unknown addresses. The token is never stored in clear text.
- `POST /api/auth/password-reset/confirm` replaces the password and revokes prior
  sessions atomically.
- `GET /api/account/export` returns an authenticated no-store JSON export of the
  account's owned data, including professional-review history.
- `DELETE /api/account` requires the current password and literal `DELETE`. It
  revokes sessions and deletes the account-owned graph transactionally. It
  refuses deletion while governed financial records or a professional profile
  require an operator-led retention/offboarding decision.

## Email boundary

The Worker uses Resend only when both `RESEND_API_KEY` and a syntactically valid
`TRANSACTIONAL_EMAIL_FROM` are configured. Links use a constant application path
and keep the secret in the URL fragment so it does not enter server access logs.
Delivery evidence stores purpose, bounded outcome, the idempotency-key hash,
and timestamps—not message bodies, provider payloads, addresses, or token values. Missing configuration
keeps readiness capabilities false and returns a stable unavailable result.

The provider sender domain, secret, staging/production separation, delivery
canary, bounce handling, and support ownership are operational prerequisites;
the repository does not claim those external checks are complete.
