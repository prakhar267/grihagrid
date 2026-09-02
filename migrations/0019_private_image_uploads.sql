PRAGMA foreign_keys = ON;

-- Files created before the sanitizing upload boundary are never served as
-- verified private images. A release may delete or manually re-process them,
-- but it must not silently relabel their content.
ALTER TABLE project_files ADD COLUMN storage_state TEXT NOT NULL DEFAULT 'legacy_blocked'
  CHECK(storage_state IN ('ready', 'legacy_blocked'));
ALTER TABLE project_files ADD COLUMN sanitization_profile TEXT NOT NULL DEFAULT 'legacy-unverified';
ALTER TABLE project_files ADD COLUMN original_size_bytes INTEGER NOT NULL DEFAULT 0
  CHECK(original_size_bytes >= 0 AND original_size_bytes <= 10485760);

CREATE TRIGGER project_file_owner_insert_guard
BEFORE INSERT ON project_files
WHEN NOT EXISTS (
  SELECT 1 FROM projects p WHERE p.id=NEW.project_id AND p.user_id=NEW.user_id
)
BEGIN
  SELECT RAISE(ABORT, 'project file owner mismatch');
END;

CREATE TRIGGER project_file_ready_insert_guard
BEFORE INSERT ON project_files
WHEN NEW.storage_state='ready' AND (
  NEW.sanitization_profile!='static-image-v1'
  OR NEW.content_type NOT IN ('image/jpeg', 'image/png', 'image/webp')
  OR NEW.size_bytes<=0
  OR NEW.size_bytes>10485760
  OR NEW.original_size_bytes<=0
  OR NEW.original_size_bytes>10485760
)
BEGIN
  SELECT RAISE(ABORT, 'project file safety evidence invalid');
END;

CREATE TRIGGER project_file_account_limit_insert_guard
BEFORE INSERT ON project_files
WHEN (SELECT COUNT(*) FROM project_files WHERE user_id=NEW.user_id AND storage_state='ready') >= 100
  OR (SELECT COUNT(*) FROM project_files WHERE project_id=NEW.project_id AND storage_state='ready') >= 20
BEGIN
  SELECT RAISE(ABORT, 'project file limit reached');
END;

CREATE TRIGGER project_file_identity_immutable
BEFORE UPDATE ON project_files
WHEN NEW.id!=OLD.id
  OR NEW.project_id!=OLD.project_id
  OR NEW.user_id!=OLD.user_id
  OR NEW.object_key!=OLD.object_key
  OR NEW.file_name!=OLD.file_name
  OR NEW.content_type!=OLD.content_type
  OR NEW.size_bytes!=OLD.size_bytes
  OR NEW.kind!=OLD.kind
  OR NEW.checksum_sha256!=OLD.checksum_sha256
  OR NEW.created_at!=OLD.created_at
  OR NEW.storage_state!=OLD.storage_state
  OR NEW.sanitization_profile!=OLD.sanitization_profile
  OR NEW.original_size_bytes!=OLD.original_size_bytes
BEGIN
  SELECT RAISE(ABORT, 'project file identity is immutable');
END;

CREATE INDEX idx_project_files_ready_created
  ON project_files(project_id, user_id, storage_state, created_at DESC);
