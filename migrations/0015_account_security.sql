PRAGMA foreign_keys = ON;

-- Authentication generations make credential changes an immediate revocation
-- boundary. Existing accounts and sessions begin in generation 1 so this
-- migration is forward-only and remains readable by the previous Worker.
ALTER TABLE users ADD COLUMN auth_generation INTEGER NOT NULL DEFAULT 1
  CHECK(auth_generation BETWEEN 1 AND 2147483647);
ALTER TABLE users ADD COLUMN auth_revision_id TEXT
  CHECK(auth_revision_id IS NULL OR length(auth_revision_id) BETWEEN 16 AND 128);
ALTER TABLE users ADD COLUMN password_changed_at TEXT;

ALTER TABLE sessions ADD COLUMN auth_generation INTEGER NOT NULL DEFAULT 1
  CHECK(auth_generation BETWEEN 1 AND 2147483647);
ALTER TABLE sessions ADD COLUMN auth_revision_id TEXT
  CHECK(auth_revision_id IS NULL OR length(auth_revision_id) BETWEEN 16 AND 128);

-- Current-password verification is a credential oracle even behind a live
-- session. KV remains the fail-closed IP perimeter, while this D1 counter is
-- the strongly consistent per-account admission boundary. The conditional
-- UPSERT in the Worker never advances a row beyond its stored limit.
CREATE TABLE password_change_attempt_counters (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  window_start TEXT NOT NULL,
  request_count INTEGER NOT NULL CHECK(request_count > 0),
  limit_count INTEGER NOT NULL CHECK(limit_count > 0),
  updated_at TEXT NOT NULL,
  CONSTRAINT password_change_attempt_within_limit CHECK(request_count <= limit_count),
  PRIMARY KEY (user_id, window_start)
);

CREATE INDEX idx_password_change_attempts_updated
  ON password_change_attempt_counters(updated_at);

-- A credential rewrite must advance exactly one generation, receive a new
-- opaque revision id, and record when the password changed. Generation-only
-- bumps remain available for a future revoke-all-sessions control, but they
-- must also use a fresh revision id. Rewrites from a rolled-back Worker that
-- does not know this protocol therefore fail closed.
CREATE TRIGGER users_auth_state_update_guard
BEFORE UPDATE OF password_hash,password_salt,password_iterations,password_algorithm,
                 auth_generation,auth_revision_id,password_changed_at ON users
WHEN NEW.auth_generation < OLD.auth_generation
  OR NEW.auth_generation > OLD.auth_generation + 1
  OR (
    (NEW.password_hash IS NOT OLD.password_hash
      OR NEW.password_salt IS NOT OLD.password_salt
      OR NEW.password_iterations IS NOT OLD.password_iterations
      OR NEW.password_algorithm IS NOT OLD.password_algorithm)
    AND (
      NEW.auth_generation != OLD.auth_generation + 1
      OR NEW.auth_revision_id IS OLD.auth_revision_id
      OR NEW.password_changed_at IS NULL
    )
  )
  OR (
    NEW.password_hash IS OLD.password_hash
    AND NEW.password_salt IS OLD.password_salt
    AND NEW.password_iterations IS OLD.password_iterations
    AND NEW.password_algorithm IS OLD.password_algorithm
    AND NEW.password_changed_at IS NOT OLD.password_changed_at
  )
  OR (
    NEW.auth_generation = OLD.auth_generation
    AND NEW.auth_revision_id IS NOT OLD.auth_revision_id
  )
  OR (
    NEW.auth_generation = OLD.auth_generation + 1
    AND NEW.auth_revision_id IS OLD.auth_revision_id
  )
BEGIN
  SELECT RAISE(ABORT, 'invalid user authentication state transition');
END;

-- New Workers conditionally insert only a session matching the current user
-- generation/revision. Keep that fence in application SQL instead of an insert
-- trigger: during a verified rollback, the previous Worker can still create a
-- legacy session after checking the current password. A forward-restored Worker
-- will reject that legacy generation rather than reviving an old session.
CREATE TRIGGER session_auth_state_immutable
BEFORE UPDATE OF user_id,auth_generation,auth_revision_id ON sessions
WHEN NEW.user_id IS NOT OLD.user_id
  OR NEW.auth_generation != OLD.auth_generation
  OR NEW.auth_revision_id IS NOT OLD.auth_revision_id
BEGIN
  SELECT RAISE(ABORT, 'session authentication state is immutable');
END;
