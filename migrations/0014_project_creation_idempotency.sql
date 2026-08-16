PRAGMA foreign_keys = ON;

-- First-party project creation may cross authentication and an ambiguous
-- network boundary. Nullable columns preserve rollback compatibility for an
-- older Worker while allowing the current Worker to replay one exact draft.
ALTER TABLE projects ADD COLUMN creation_key_hash TEXT;
ALTER TABLE projects ADD COLUMN creation_request_hash TEXT;

CREATE UNIQUE INDEX idx_projects_user_creation_key
  ON projects(user_id, creation_key_hash)
  WHERE creation_key_hash IS NOT NULL;
