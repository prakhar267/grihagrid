PRAGMA foreign_keys = ON;

-- Credentials are deliberately versioned so password parameters can be upgraded
-- without invalidating accounts created by an older release.
ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE users ADD COLUMN password_salt TEXT;
ALTER TABLE users ADD COLUMN password_iterations INTEGER;
ALTER TABLE users ADD COLUMN password_algorithm TEXT;

-- Only hashes of bearer/CSRF secrets are retained in D1.
ALTER TABLE sessions ADD COLUMN csrf_hash TEXT;
ALTER TABLE sessions ADD COLUMN last_seen_at TEXT;

CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK(version > 0),
  input_hash TEXT NOT NULL,
  content_json TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE project_files (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK(size_bytes >= 0),
  kind TEXT NOT NULL,
  checksum_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_reports_user_generated ON reports(user_id, generated_at DESC);
CREATE INDEX idx_project_files_project_created ON project_files(project_id, created_at DESC);
CREATE INDEX idx_project_files_user_created ON project_files(user_id, created_at DESC);
CREATE INDEX idx_sessions_user ON sessions(user_id, created_at DESC);
