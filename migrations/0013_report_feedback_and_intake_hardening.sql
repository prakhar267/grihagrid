PRAGMA foreign_keys = ON;

-- Feedback is a mutable owner annotation on one immutable report version. It
-- never changes the project revision or report bytes and stores no free text.
CREATE TABLE report_feedback (
  project_id TEXT NOT NULL,
  project_revision INTEGER NOT NULL CHECK(project_revision > 0),
  report_schema_version INTEGER NOT NULL CHECK(report_schema_version = 2),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  outcome TEXT NOT NULL CHECK(outcome IN ('helpful','unclear','needs_review')),
  sections_json TEXT NOT NULL
    CHECK(json_valid(sections_json))
    CHECK(json_type(sections_json)='array')
    CHECK(json_array_length(sections_json) BETWEEN 1 AND 3),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(project_id,project_revision,report_schema_version),
  FOREIGN KEY(project_id,project_revision,report_schema_version)
    REFERENCES project_revision_reports(project_id,project_revision,report_schema_version)
    ON DELETE CASCADE
);

CREATE INDEX idx_report_feedback_updated
  ON report_feedback(updated_at DESC);
CREATE INDEX idx_report_feedback_outcome
  ON report_feedback(outcome,created_at DESC);

-- The application is owner-scoped, and these triggers keep that invariant at
-- SQL time while also preventing archived records from receiving new content.
-- A feedback response may name the whole report or one-to-three sections, but
-- never both, and every section is a fixed enum rather than customer text.
CREATE TRIGGER report_feedback_insert_guard
BEFORE INSERT ON report_feedback
WHEN NOT EXISTS (
       SELECT 1 FROM projects p
        WHERE p.id=NEW.project_id
          AND p.user_id=NEW.user_id
          AND p.status!='archived'
     )
  OR EXISTS (
       SELECT 1 FROM json_each(NEW.sections_json)
        WHERE type!='text'
           OR value NOT IN ('overall','brief_check','programme','cost_range','assumptions','next_actions')
     )
  OR (SELECT COUNT(DISTINCT value) FROM json_each(NEW.sections_json))
       != json_array_length(NEW.sections_json)
  OR (json_array_length(NEW.sections_json)>1
      AND EXISTS (SELECT 1 FROM json_each(NEW.sections_json) WHERE value='overall'))
BEGIN
  SELECT RAISE(ABORT, 'invalid report feedback');
END;

CREATE TRIGGER report_feedback_update_guard
BEFORE UPDATE ON report_feedback
WHEN NEW.project_id IS NOT OLD.project_id
  OR NEW.project_revision IS NOT OLD.project_revision
  OR NEW.report_schema_version IS NOT OLD.report_schema_version
  OR NEW.user_id IS NOT OLD.user_id
  OR NEW.created_at IS NOT OLD.created_at
  OR NOT EXISTS (
       SELECT 1 FROM projects p
        WHERE p.id=NEW.project_id
          AND p.user_id=NEW.user_id
          AND p.status!='archived'
     )
  OR EXISTS (
       SELECT 1 FROM json_each(NEW.sections_json)
        WHERE type!='text'
           OR value NOT IN ('overall','brief_check','programme','cost_range','assumptions','next_actions')
     )
  OR (SELECT COUNT(DISTINCT value) FROM json_each(NEW.sections_json))
       != json_array_length(NEW.sections_json)
  OR (json_array_length(NEW.sections_json)>1
      AND EXISTS (SELECT 1 FROM json_each(NEW.sections_json) WHERE value='overall'))
BEGIN
  SELECT RAISE(ABORT, 'invalid report feedback');
END;

-- A compromised or rolled-back Worker must not persist hidden project-input
-- fields. This specifically prevents claims such as an unverified soil report
-- from weakening a safety caveat. Existing rows remain readable.
CREATE TRIGGER project_input_allowlist_insert_guard
BEFORE INSERT ON projects
WHEN NOT json_valid(NEW.input_json)
  OR json_type(NEW.input_json)!='object'
  OR EXISTS (
       SELECT 1 FROM json_each(NEW.input_json)
        WHERE key NOT IN (
          'width','length','city','facing','floors','bedrooms','bathrooms','parking',
          'style','quality','roadWidthFt','plotShape','accessibility','futureUse','budgetLakh'
        )
     )
BEGIN
  SELECT RAISE(ABORT, 'project input contains unsupported field');
END;

CREATE TRIGGER project_input_allowlist_update_guard
BEFORE UPDATE OF input_json ON projects
WHEN NEW.input_json IS NOT OLD.input_json
 AND (
   NOT json_valid(NEW.input_json)
   OR json_type(NEW.input_json)!='object'
   OR EXISTS (
        SELECT 1 FROM json_each(NEW.input_json)
         WHERE key NOT IN (
           'width','length','city','facing','floors','bedrooms','bathrooms','parking',
           'style','quality','roadWidthFt','plotShape','accessibility','futureUse','budgetLakh'
         )
      )
 )
BEGIN
  SELECT RAISE(ABORT, 'project input contains unsupported field');
END;

-- Keep an exact database-side ceiling behind the per-hour abuse control so IP
-- rotation or concurrent requests cannot grow one account without bound.
CREATE TRIGGER project_account_limit_insert_guard
BEFORE INSERT ON projects
WHEN (SELECT COUNT(*) FROM projects WHERE user_id=NEW.user_id) >= 50
BEGIN
  SELECT RAISE(ABORT, 'project account limit reached');
END;
