PRAGMA foreign_keys = ON;

-- Verification is an explicit account property. Existing accounts remain
-- unverified until they prove control of their address; this does not revoke
-- their current free-planning access.
ALTER TABLE users ADD COLUMN email_verified_at TEXT;
ALTER TABLE users ADD COLUMN deletion_requested_at TEXT;

CREATE TABLE email_verification_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash)=43),
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_email_verification_user_created
  ON email_verification_tokens(user_id,created_at DESC);
CREATE INDEX idx_email_verification_expiry
  ON email_verification_tokens(expires_at);

CREATE TABLE password_reset_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash)=43),
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_password_reset_user_created
  ON password_reset_tokens(user_id,created_at DESC);
CREATE INDEX idx_password_reset_expiry
  ON password_reset_tokens(expires_at);

-- Delivery evidence contains no address, body, token, provider response, or
-- account-visible secret. The purpose and bounded outcome are sufficient for
-- support without creating a second contact database.
CREATE TABLE transactional_email_events (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  purpose TEXT NOT NULL CHECK(purpose IN (
    'verify_email','password_reset','password_changed',
    'sessions_revoked','account_deletion'
  )),
  outcome TEXT NOT NULL CHECK(outcome IN ('sent','failed','skipped')),
  idempotency_key_hash TEXT NOT NULL CHECK(length(idempotency_key_hash)=43),
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_transactional_email_idempotency
  ON transactional_email_events(idempotency_key_hash);
CREATE INDEX idx_transactional_email_user_created
  ON transactional_email_events(user_id,created_at DESC);

CREATE TABLE account_deletion_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN (
    'requested','blocked_financial_retention','completed'
  )),
  requested_at TEXT NOT NULL,
  completed_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_account_deletion_status_updated
  ON account_deletion_requests(status,updated_at);

-- A completed deletion leaves only an opaque request receipt. It has no user,
-- email, project, order, or content reference and cannot be used to reconstruct
-- the deleted account.
CREATE TABLE account_deletion_receipts (
  request_id TEXT PRIMARY KEY,
  completed_at TEXT NOT NULL
);

-- Tokens may only move once from unused to consumed. Their subject, digest,
-- lifetime, and creation time are immutable even to application mistakes.
CREATE TRIGGER email_verification_token_identity_guard
BEFORE UPDATE ON email_verification_tokens
WHEN NEW.id IS NOT OLD.id
  OR NEW.user_id IS NOT OLD.user_id
  OR NEW.token_hash IS NOT OLD.token_hash
  OR NEW.expires_at IS NOT OLD.expires_at
  OR NEW.created_at IS NOT OLD.created_at
  OR OLD.consumed_at IS NOT NULL
  OR NEW.consumed_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'invalid email verification token transition');
END;

CREATE TRIGGER password_reset_token_identity_guard
BEFORE UPDATE ON password_reset_tokens
WHEN NEW.id IS NOT OLD.id
  OR NEW.user_id IS NOT OLD.user_id
  OR NEW.token_hash IS NOT OLD.token_hash
  OR NEW.expires_at IS NOT OLD.expires_at
  OR NEW.created_at IS NOT OLD.created_at
  OR OLD.consumed_at IS NOT NULL
  OR NEW.consumed_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'invalid password reset token transition');
END;

CREATE TRIGGER transactional_email_events_immutable
BEFORE UPDATE ON transactional_email_events
WHEN NEW.id IS NOT OLD.id
  OR NEW.purpose IS NOT OLD.purpose
  OR NEW.outcome IS NOT OLD.outcome
  OR NEW.idempotency_key_hash IS NOT OLD.idempotency_key_hash
  OR NEW.created_at IS NOT OLD.created_at
  OR (
    NEW.user_id IS NOT OLD.user_id
    AND NOT (
      NEW.user_id IS NULL
      AND OLD.user_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM users WHERE id=OLD.user_id)
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'transactional email evidence is immutable');
END;
