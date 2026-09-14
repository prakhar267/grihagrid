-- Spatial concepts have their own immutable history, bound to the brief that
-- informed them. They do not change deterministic cost/report inputs.
CREATE TABLE spatial_revisions (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK(revision > 0),
  input_revision INTEGER NOT NULL CHECK(input_revision > 0),
  model_json TEXT NOT NULL CHECK(json_valid(model_json)),
  request_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(project_id,revision),
  UNIQUE(project_id,request_key)
);
CREATE TABLE spatial_tour_revisions (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK(revision > 0),
  spatial_revision INTEGER NOT NULL,
  input_revision INTEGER NOT NULL,
  tour_json TEXT NOT NULL CHECK(json_valid(tour_json)),
  request_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(project_id,revision),
  UNIQUE(project_id,request_key),
  FOREIGN KEY(project_id,spatial_revision) REFERENCES spatial_revisions(project_id,revision) ON DELETE CASCADE
);
CREATE TRIGGER spatial_revisions_immutable BEFORE UPDATE ON spatial_revisions BEGIN
  SELECT RAISE(ABORT,'spatial revisions are immutable');
END;
CREATE TRIGGER spatial_tours_immutable BEFORE UPDATE ON spatial_tour_revisions BEGIN
  SELECT RAISE(ABORT,'spatial tours are immutable');
END;
CREATE TRIGGER spatial_revisions_active BEFORE INSERT ON spatial_revisions
WHEN NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.project_id AND status!='archived' AND input_revision=NEW.input_revision)
BEGIN
  SELECT RAISE(ABORT,'spatial source changed');
END;
CREATE TRIGGER spatial_tours_active BEFORE INSERT ON spatial_tour_revisions
WHEN NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.project_id AND status!='archived' AND input_revision=NEW.input_revision)
BEGIN
  SELECT RAISE(ABORT,'spatial source changed');
END;
