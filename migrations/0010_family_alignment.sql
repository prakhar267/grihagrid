PRAGMA foreign_keys = ON;

-- A Family Alignment room is pinned to one immutable Decision Compare version.
-- Only a SHA-256 digest of the seven-day bearer token is retained.
CREATE TABLE family_alignment_rooms (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  comparison_id TEXT NOT NULL UNIQUE REFERENCES decision_comparisons(id) ON DELETE CASCADE,
  comparison_version INTEGER NOT NULL CHECK(comparison_version > 0),
  token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash) = 64),
  idempotency_key TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL CHECK(length(request_hash) = 64),
  response_count INTEGER NOT NULL DEFAULT 0 CHECK(response_count BETWEEN 0 AND 5),
  access_count INTEGER NOT NULL DEFAULT 0 CHECK(access_count >= 0),
  last_accessed_at TEXT,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_family_alignment_owner_created
  ON family_alignment_rooms(user_id,project_id,created_at DESC);
CREATE INDEX idx_family_alignment_expiry
  ON family_alignment_rooms(expires_at);

-- Browser response tokens are hashed with the room id, preventing the stored
-- receipt from becoming a cross-room browser correlation identifier.
CREATE TABLE family_alignment_responses (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES family_alignment_rooms(id) ON DELETE CASCADE,
  receipt_hash TEXT NOT NULL CHECK(length(receipt_hash) = 64),
  role TEXT NOT NULL CHECK(role IN ('spouse','parent','sibling','advisor','other')),
  preference TEXT NOT NULL CHECK(preference IN ('A','B','not_ready')),
  confidence TEXT NOT NULL CHECK(confidence IN ('high','medium','low')),
  reasons_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(room_id,receipt_hash)
);

CREATE INDEX idx_family_alignment_responses_room_updated
  ON family_alignment_responses(room_id,updated_at DESC);

CREATE TRIGGER family_alignment_response_insert_guard
BEFORE INSERT ON family_alignment_responses
WHEN NOT EXISTS (
    SELECT 1 FROM family_alignment_rooms r
     WHERE r.id=NEW.room_id
       AND r.revoked_at IS NULL
       AND r.expires_at>datetime('now')
       AND r.response_count<5
  )
BEGIN
  SELECT RAISE(ABORT, 'family alignment room cannot accept another response');
END;

CREATE TRIGGER family_alignment_response_update_guard
BEFORE UPDATE ON family_alignment_responses
WHEN NOT EXISTS (
    SELECT 1 FROM family_alignment_rooms r
     WHERE r.id=OLD.room_id
       AND r.revoked_at IS NULL
       AND r.expires_at>datetime('now')
  )
  OR NEW.room_id IS NOT OLD.room_id
  OR NEW.receipt_hash IS NOT OLD.receipt_hash
  OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'family alignment response is not editable');
END;

CREATE TRIGGER family_alignment_room_identity_immutable
BEFORE UPDATE ON family_alignment_rooms
WHEN NEW.project_id IS NOT OLD.project_id
  OR NEW.user_id IS NOT OLD.user_id
  OR NEW.comparison_id IS NOT OLD.comparison_id
  OR NEW.comparison_version != OLD.comparison_version
  OR NEW.token_hash IS NOT OLD.token_hash
  OR NEW.idempotency_key IS NOT OLD.idempotency_key
  OR NEW.request_hash IS NOT OLD.request_hash
  OR NEW.expires_at IS NOT OLD.expires_at
  OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'family alignment room identity is immutable');
END;

CREATE TRIGGER family_alignment_response_count_insert
AFTER INSERT ON family_alignment_responses
BEGIN
  UPDATE family_alignment_rooms
     SET response_count=response_count+1
   WHERE id=NEW.room_id;
  SELECT CASE WHEN changes()!=1
    THEN RAISE(ABORT, 'family alignment response count was not recorded') END;
END;

CREATE TRIGGER family_alignment_response_active_after_insert
AFTER INSERT ON family_alignment_responses
WHEN NOT EXISTS (
  SELECT 1 FROM family_alignment_rooms r
   WHERE r.id=NEW.room_id AND r.revoked_at IS NULL AND r.expires_at>datetime('now')
)
BEGIN
  SELECT RAISE(ABORT, 'family alignment room cannot accept another response');
END;

CREATE TRIGGER family_alignment_response_active_after_update
AFTER UPDATE ON family_alignment_responses
WHEN NOT EXISTS (
  SELECT 1 FROM family_alignment_rooms r
   WHERE r.id=NEW.room_id AND r.revoked_at IS NULL AND r.expires_at>datetime('now')
)
BEGIN
  SELECT RAISE(ABORT, 'family alignment response is not editable');
END;

CREATE TRIGGER family_alignment_response_count_delete
AFTER DELETE ON family_alignment_responses
BEGIN
  UPDATE family_alignment_rooms
     SET response_count=response_count-1
   WHERE id=OLD.room_id AND response_count>0;
  -- A direct response deletion must reconcile its surviving room. During a
  -- parent-room/project cascade SQLite may already have removed the room, in
  -- which case there is intentionally no counter left to update.
  SELECT CASE WHEN changes()!=1 AND EXISTS (
    SELECT 1 FROM family_alignment_rooms WHERE id=OLD.room_id
  )
    THEN RAISE(ABORT, 'family alignment response count was not removed') END;
END;
