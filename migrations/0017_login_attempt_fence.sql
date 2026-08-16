PRAGMA foreign_keys = ON;

-- Login is a credential oracle even when requests arrive from many different
-- IP addresses. Reserve password verification atomically per real account,
-- while storing no email, IP address, or password-derived value. Unknown
-- accounts execute the same Worker statement with a null subject and create no
-- attacker-controlled rows.
CREATE TABLE login_attempt_fences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  window_started_at TEXT NOT NULL
    CHECK(typeof(window_started_at) = 'text'
      AND strftime('%Y-%m-%d %H:%M:%S', window_started_at) IS NOT NULL
      AND window_started_at = strftime('%Y-%m-%d %H:%M:%S', window_started_at)),
  expires_at TEXT NOT NULL
    CHECK(typeof(expires_at) = 'text'
      AND strftime('%Y-%m-%d %H:%M:%S', expires_at) IS NOT NULL
      AND expires_at = strftime('%Y-%m-%d %H:%M:%S', expires_at)),
  request_count INTEGER NOT NULL
    CHECK(typeof(request_count) = 'integer' AND request_count > 0),
  limit_count INTEGER NOT NULL
    CHECK(typeof(limit_count) = 'integer' AND limit_count BETWEEN 1 AND 12),
  updated_at TEXT NOT NULL
    CHECK(typeof(updated_at) = 'text'
      AND strftime('%Y-%m-%d %H:%M:%S', updated_at) IS NOT NULL
      AND updated_at = strftime('%Y-%m-%d %H:%M:%S', updated_at)),
  CONSTRAINT login_attempt_within_limit CHECK(request_count <= limit_count),
  CONSTRAINT login_attempt_window_order CHECK(
    window_started_at <= updated_at AND updated_at < expires_at
  )
);

CREATE INDEX idx_login_attempt_fences_expires
  ON login_attempt_fences(expires_at);
