CREATE TABLE spatial_camera_revisions (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK(revision > 0),
  spatial_revision INTEGER NOT NULL CHECK(spatial_revision > 0),
  input_revision INTEGER NOT NULL CHECK(input_revision > 0),
  viewpoints_json TEXT NOT NULL CHECK(json_valid(viewpoints_json)),
  request_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(project_id,revision),
  UNIQUE(project_id,request_key),
  FOREIGN KEY(project_id,spatial_revision) REFERENCES spatial_revisions(project_id,revision) ON DELETE CASCADE
);
CREATE TRIGGER spatial_cameras_immutable BEFORE UPDATE ON spatial_camera_revisions BEGIN
  SELECT RAISE(ABORT,'camera revisions are immutable');
END;
CREATE TRIGGER spatial_cameras_active BEFORE INSERT ON spatial_camera_revisions
WHEN NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.project_id AND status!='archived' AND input_revision=NEW.input_revision)
BEGIN
  SELECT RAISE(ABORT,'camera source changed');
END;
