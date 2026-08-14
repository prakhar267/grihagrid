PRAGMA foreign_keys = ON;

-- Brief Check keeps the mutable project row as the current projection while
-- recording every source-changing input revision as an immutable snapshot.
-- Nullable fingerprints/assessments keep this migration forward-compatible
-- with a short rollback to an older Worker that does not know these columns.
ALTER TABLE projects ADD COLUMN input_hash TEXT
  CHECK(input_hash IS NULL OR length(input_hash) = 64);
ALTER TABLE projects ADD COLUMN input_schema_version INTEGER NOT NULL DEFAULT 1
  CHECK(input_schema_version > 0);
ALTER TABLE projects ADD COLUMN estimate_rule_version INTEGER NOT NULL DEFAULT 1
  CHECK(estimate_rule_version > 0);
ALTER TABLE projects ADD COLUMN brief_check_version INTEGER NOT NULL DEFAULT 1
  CHECK(brief_check_version > 0);
ALTER TABLE projects ADD COLUMN brief_check_json TEXT;

-- The current report remains a one-row cache. This nullable source revision is
-- mandatory for new writes, while an older rolled-back Worker can still read
-- and replace the cache without fabricating an immutable historical report.
ALTER TABLE reports ADD COLUMN project_input_revision INTEGER
  CHECK(project_input_revision IS NULL OR project_input_revision > 0);

CREATE TABLE project_revisions (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK(revision > 0),
  provenance TEXT NOT NULL CHECK(provenance IN ('migration_baseline','created','updated')),
  input_schema_version INTEGER NOT NULL CHECK(input_schema_version > 0),
  estimate_rule_version INTEGER NOT NULL CHECK(estimate_rule_version > 0),
  brief_check_version INTEGER NOT NULL CHECK(brief_check_version > 0),
  content_hash TEXT CHECK(content_hash IS NULL OR length(content_hash) = 64),
  input_json TEXT NOT NULL,
  estimate_json TEXT,
  brief_check_json TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY(project_id,revision)
);

CREATE INDEX idx_project_revisions_owner_created
  ON project_revisions(project_id,created_at DESC);

-- Idempotency material is hashed/scoped in the Worker. It contains no raw
-- browser key or project input and is deleted with the parent project.
CREATE TABLE project_revision_requests (
  idempotency_key_hash TEXT PRIMARY KEY,
  request_hash TEXT NOT NULL CHECK(length(request_hash) = 64),
  result_content_hash TEXT NOT NULL CHECK(length(result_content_hash) = 64),
  project_id TEXT NOT NULL,
  expected_revision INTEGER NOT NULL CHECK(expected_revision > 0),
  result_revision INTEGER NOT NULL CHECK(result_revision = expected_revision + 1),
  created_at TEXT NOT NULL,
  FOREIGN KEY(project_id,result_revision)
    REFERENCES project_revisions(project_id,revision) ON DELETE CASCADE
);

CREATE INDEX idx_project_revision_requests_project
  ON project_revision_requests(project_id,result_revision DESC);

-- Deterministic feasibility reports become immutable only after an explicit
-- generation succeeds against one exact project revision. AI remains a
-- regenerable current-only cache and is deliberately absent here.
CREATE TABLE project_revision_reports (
  project_id TEXT NOT NULL,
  project_revision INTEGER NOT NULL CHECK(project_revision > 0),
  report_schema_version INTEGER NOT NULL CHECK(report_schema_version > 0),
  source_report_id TEXT NOT NULL,
  source_content_hash TEXT CHECK(source_content_hash IS NULL OR length(source_content_hash) = 64),
  input_hash TEXT NOT NULL CHECK(length(input_hash) = 64),
  content_json TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  PRIMARY KEY(project_id,project_revision,report_schema_version),
  FOREIGN KEY(project_id,project_revision)
    REFERENCES project_revisions(project_id,revision) ON DELETE CASCADE
);

CREATE INDEX idx_project_revision_reports_source
  ON project_revision_reports(source_report_id);

-- Existing mutable rows reveal only their current snapshot. Do not fabricate
-- missing revisions 1..N when no earlier source was retained.
INSERT INTO project_revisions (
  project_id,revision,provenance,input_schema_version,
  estimate_rule_version,brief_check_version,content_hash,input_json,
  estimate_json,brief_check_json,created_at
)
SELECT
  id,input_revision,'migration_baseline',1,1,1,NULL,input_json,
  estimate_json,NULL,updated_at
FROM projects;

UPDATE reports
   SET project_input_revision=(
     SELECT p.input_revision FROM projects p
      WHERE p.id=reports.project_id AND p.user_id=reports.user_id
   )
 WHERE EXISTS (
   SELECT 1 FROM projects p
    WHERE p.id=reports.project_id AND p.user_id=reports.user_id
 );

INSERT INTO project_revision_reports (
  project_id,project_revision,report_schema_version,source_report_id,
  source_content_hash,input_hash,content_json,generated_at
)
SELECT
  r.project_id,r.project_input_revision,r.version,r.id,NULL,r.input_hash,
  r.content_json,r.generated_at
FROM reports r
WHERE r.project_input_revision IS NOT NULL;

-- New projects, including those created by an older Worker after rollback,
-- receive one honest baseline automatically.
CREATE TRIGGER project_revision_capture_insert
AFTER INSERT ON projects
BEGIN
  INSERT INTO project_revisions (
    project_id,revision,provenance,input_schema_version,
    estimate_rule_version,brief_check_version,content_hash,input_json,
    estimate_json,brief_check_json,created_at
  ) VALUES (
    NEW.id,NEW.input_revision,'created',NEW.input_schema_version,
    NEW.estimate_rule_version,NEW.brief_check_version,NEW.input_hash,
    NEW.input_json,NEW.estimate_json,NEW.brief_check_json,NEW.updated_at
  );
END;

-- The existing projects_input_revision_guard requires exactly +1 for a real
-- source change. This trigger turns that monotonic counter into a durable
-- snapshot ledger. If an older Worker leaves the new derived columns unchanged,
-- record NULL rather than copying a stale hash or assessment.
CREATE TRIGGER project_revision_capture_update
AFTER UPDATE ON projects
WHEN NEW.input_json IS NOT OLD.input_json OR NEW.estimate_json IS NOT OLD.estimate_json
BEGIN
  INSERT INTO project_revisions (
    project_id,revision,provenance,input_schema_version,
    estimate_rule_version,brief_check_version,content_hash,input_json,
    estimate_json,brief_check_json,created_at
  ) VALUES (
    NEW.id,NEW.input_revision,'updated',NEW.input_schema_version,
    NEW.estimate_rule_version,NEW.brief_check_version,
    CASE WHEN NEW.input_hash IS NOT OLD.input_hash THEN NEW.input_hash ELSE NULL END,
    NEW.input_json,NEW.estimate_json,
    CASE WHEN NEW.input_hash IS NOT OLD.input_hash THEN NEW.brief_check_json ELSE NULL END,
    NEW.updated_at
  );

  -- A rolled-back Worker knows neither derived column. If it changes the
  -- source bytes while leaving the prior fingerprint untouched, clear the
  -- current projection as well as recording NULL in history. The secondary
  -- UPDATE changes no source bytes or revision and therefore does not recurse
  -- through this trigger's WHEN clause.
  UPDATE projects
     SET input_hash=NULL,brief_check_json=NULL
   WHERE id=NEW.id AND NEW.input_hash IS OLD.input_hash;
END;

-- Source changes invalidate only mutable/current derivatives. Historical
-- snapshots, comparisons, selections and purchases remain immutable. Active
-- Family links are permanently closed so reviewers cannot answer an obsolete
-- brief after the owner has moved on.
CREATE TRIGGER project_revision_source_change_effects
AFTER UPDATE ON projects
WHEN NEW.input_json IS NOT OLD.input_json OR NEW.estimate_json IS NOT OLD.estimate_json
BEGIN
  DELETE FROM reports WHERE project_id=NEW.id AND user_id=NEW.user_id;
  UPDATE family_alignment_rooms
     SET revoked_at=NEW.updated_at
   WHERE project_id=NEW.id AND user_id=NEW.user_id AND revoked_at IS NULL;
END;

CREATE TRIGGER project_revisions_identity_guard
BEFORE INSERT ON project_revisions
WHEN NOT EXISTS (
  SELECT 1 FROM projects p
   WHERE p.id=NEW.project_id
     AND p.input_revision=NEW.revision
     AND p.input_json IS NEW.input_json
     AND p.estimate_json IS NEW.estimate_json
)
BEGIN
  SELECT RAISE(ABORT, 'project revision does not match the current source');
END;

CREATE TRIGGER archived_project_revision_insert_guard
BEFORE INSERT ON project_revisions
WHEN EXISTS (
  SELECT 1 FROM projects p
   WHERE p.id=NEW.project_id AND p.status='archived'
)
BEGIN
  SELECT RAISE(ABORT, 'archived project is read only');
END;

CREATE TRIGGER project_revisions_immutable_update
BEFORE UPDATE ON project_revisions
BEGIN
  SELECT RAISE(ABORT, 'project revisions are immutable');
END;

-- Direct child deletion is forbidden while the parent exists. SQLite removes
-- the parent before cascading, so authorized whole-project deletion still
-- erases the private history.
CREATE TRIGGER project_revisions_immutable_delete
BEFORE DELETE ON project_revisions
WHEN EXISTS (SELECT 1 FROM projects p WHERE p.id=OLD.project_id)
BEGIN
  SELECT RAISE(ABORT, 'project revisions are immutable');
END;

-- The final statement in a revision-save batch is an unconditional request-map
-- insert. This guard makes a stale/different CAS loser abort the complete batch
-- instead of allowing later statements to commit after a zero-row UPDATE.
CREATE TRIGGER project_revision_request_result_guard
BEFORE INSERT ON project_revision_requests
WHEN NOT EXISTS (
  SELECT 1
    FROM projects p
    JOIN project_revisions r
      ON r.project_id=p.id AND r.revision=p.input_revision
   WHERE p.id=NEW.project_id
     AND p.status!='archived'
     AND p.input_revision=NEW.result_revision
     AND p.input_hash=NEW.result_content_hash
     AND r.content_hash=NEW.result_content_hash
)
BEGIN
  SELECT RAISE(ABORT, 'project revision compare and swap failed');
END;

CREATE TRIGGER project_revision_requests_immutable_update
BEFORE UPDATE ON project_revision_requests
BEGIN
  SELECT RAISE(ABORT, 'project revision requests are immutable');
END;

CREATE TRIGGER project_revision_requests_immutable_delete
BEFORE DELETE ON project_revision_requests
WHEN EXISTS (SELECT 1 FROM projects p WHERE p.id=OLD.project_id)
BEGIN
  SELECT RAISE(ABORT, 'project revision requests are immutable');
END;

-- A historical report can be inserted only while its exact source revision is
-- still current and while the mutable report cache contains those exact bytes.
-- This is the SQL-time fence for report-generation-versus-edit races.
CREATE TRIGGER project_revision_report_source_guard
BEFORE INSERT ON project_revision_reports
WHEN NOT EXISTS (
  SELECT 1
    FROM projects p
    JOIN project_revisions pr
      ON pr.project_id=p.id AND pr.revision=NEW.project_revision
    JOIN reports r
      ON r.project_id=p.id AND r.user_id=p.user_id
   WHERE p.id=NEW.project_id
     AND p.status!='archived'
     AND p.input_revision=NEW.project_revision
     AND r.project_input_revision=NEW.project_revision
     AND r.id=NEW.source_report_id
     AND r.version=NEW.report_schema_version
     AND r.input_hash=NEW.input_hash
     AND r.content_json=NEW.content_json
     AND r.generated_at=NEW.generated_at
     AND (NEW.source_content_hash IS NULL OR pr.content_hash=NEW.source_content_hash)
)
BEGIN
  SELECT RAISE(ABORT, 'report source revision changed');
END;

CREATE TRIGGER project_revision_reports_immutable_update
BEFORE UPDATE ON project_revision_reports
BEGIN
  SELECT RAISE(ABORT, 'project revision reports are immutable');
END;

CREATE TRIGGER project_revision_reports_immutable_delete
BEFORE DELETE ON project_revision_reports
WHEN EXISTS (SELECT 1 FROM projects p WHERE p.id=OLD.project_id)
BEGIN
  SELECT RAISE(ABORT, 'project revision reports are immutable');
END;
