PRAGMA foreign_keys = ON;

-- Deliberately no owner/project foreign key: cleanup survives their deletion.
CREATE TABLE private_file_cleanup (
  object_key TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK(state IN ('upload', 'delete')),
  receipt_id TEXT,
  created_at TEXT NOT NULL,
  next_attempt_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0)
);
CREATE INDEX idx_private_file_cleanup_due ON private_file_cleanup(next_attempt_at, object_key);
CREATE INDEX idx_private_file_cleanup_receipt ON private_file_cleanup(receipt_id);

CREATE TABLE private_file_maintenance (
  id INTEGER PRIMARY KEY CHECK(id=1),
  inventory_cursor TEXT,
  updated_at TEXT NOT NULL
);

ALTER TABLE account_deletion_receipts ADD COLUMN private_files_count INTEGER NOT NULL DEFAULT 0 CHECK(private_files_count >= 0);
ALTER TABLE account_deletion_receipts ADD COLUMN private_files_completed_at TEXT;

CREATE TRIGGER project_file_cleanup_after_delete
AFTER DELETE ON project_files
BEGIN
  INSERT OR IGNORE INTO private_file_cleanup(object_key,state,receipt_id,created_at,next_attempt_at)
  VALUES(OLD.object_key,'delete',
    (SELECT id FROM account_deletion_requests WHERE user_id=OLD.user_id AND status='requested'),
    datetime('now'),datetime('now'));
END;

CREATE TRIGGER project_file_cleanup_insert_guard
BEFORE INSERT ON project_files
WHEN EXISTS (SELECT 1 FROM private_file_cleanup WHERE object_key=NEW.object_key AND state='delete')
BEGIN
  SELECT RAISE(ABORT, 'file cleanup already claimed');
END;
