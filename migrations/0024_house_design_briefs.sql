-- Additive storage for detailed architectural requirements. The legacy project
-- input allowlist and all earlier reports remain intact.
CREATE TABLE house_brief_revisions (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK(revision > 0),
  input_revision INTEGER NOT NULL CHECK(input_revision > 0),
  brief_json TEXT NOT NULL CHECK(json_valid(brief_json) AND json_type(brief_json)='object'
    AND json_extract(brief_json,'$.version')=1 AND length(brief_json)<=24000),
  request_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(project_id,revision),
  UNIQUE(project_id,request_key)
);
ALTER TABLE spatial_revisions ADD COLUMN brief_revision INTEGER NOT NULL DEFAULT 0 CHECK(brief_revision>=0);
CREATE TRIGGER house_briefs_immutable BEFORE UPDATE ON house_brief_revisions BEGIN
  SELECT RAISE(ABORT,'house briefs are immutable');
END;
CREATE TRIGGER house_briefs_active BEFORE INSERT ON house_brief_revisions
WHEN NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.project_id AND status!='archived' AND input_revision=NEW.input_revision)
  OR NEW.revision!=COALESCE((SELECT MAX(revision) FROM house_brief_revisions WHERE project_id=NEW.project_id),0)+1
BEGIN
  SELECT RAISE(ABORT,'house brief source changed');
END;
CREATE TRIGGER spatial_brief_source_guard BEFORE INSERT ON spatial_revisions
WHEN NEW.brief_revision!=COALESCE((SELECT MAX(revision) FROM house_brief_revisions WHERE project_id=NEW.project_id),0)
BEGIN
  SELECT RAISE(ABORT,'spatial house brief source changed');
END;
