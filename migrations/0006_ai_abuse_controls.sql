PRAGMA foreign_keys = ON;

-- Strongly consistent admission counters for paid third-party AI work.  Each
-- counter is advanced with one conditional UPSERT ... RETURNING statement so
-- concurrent Workers cannot all observe and increment the same stale value.
CREATE TABLE ai_generation_counters (
  scope TEXT NOT NULL CHECK(scope IN ('user_hour','platform_day')),
  subject_id TEXT NOT NULL,
  window_start TEXT NOT NULL,
  request_count INTEGER NOT NULL CHECK(request_count > 0),
  limit_count INTEGER NOT NULL CHECK(limit_count > 0),
  updated_at TEXT NOT NULL,
  CONSTRAINT ai_generation_counter_within_limit CHECK(request_count <= limit_count),
  PRIMARY KEY (scope, subject_id, window_start)
);

-- One expiring lease per project prevents concurrent refresh/generation calls
-- from issuing duplicate provider requests. A unique opaque token makes lease
-- release ownership-safe; an abandoned lease can be replaced after expiry.
CREATE TABLE ai_generation_leases (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lease_token TEXT NOT NULL UNIQUE,
  source_input_hash TEXT NOT NULL CHECK(length(source_input_hash) = 64),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_ai_generation_counters_updated
  ON ai_generation_counters(updated_at);
CREATE INDEX idx_ai_generation_leases_expiry
  ON ai_generation_leases(expires_at);
