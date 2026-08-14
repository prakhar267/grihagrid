PRAGMA foreign_keys = ON;

-- Archiving is a database-enforced planning/content write fence. Application
-- guards provide clear errors for normal requests; these triggers close the
-- read-then-write race when an archive commits between an owner check and the
-- final mutation. Privacy-reducing deletes/revocations and paid-state updates
-- remain intentionally available.

CREATE TRIGGER archived_decision_comparison_insert_guard
BEFORE INSERT ON decision_comparisons
WHEN EXISTS (SELECT 1 FROM projects p WHERE p.id=NEW.project_id AND p.status='archived')
BEGIN
  SELECT RAISE(ABORT, 'archived project is read only');
END;

CREATE TRIGGER archived_decision_selection_insert_guard
BEFORE INSERT ON decision_selections
WHEN EXISTS (SELECT 1 FROM projects p WHERE p.id=NEW.project_id AND p.status='archived')
BEGIN
  SELECT RAISE(ABORT, 'archived project is read only');
END;

CREATE TRIGGER archived_decision_selection_update_guard
BEFORE UPDATE ON decision_selections
WHEN EXISTS (SELECT 1 FROM projects p WHERE p.id=OLD.project_id AND p.status='archived')
BEGIN
  SELECT RAISE(ABORT, 'archived project is read only');
END;

CREATE TRIGGER archived_project_file_insert_guard
BEFORE INSERT ON project_files
WHEN EXISTS (SELECT 1 FROM projects p WHERE p.id=NEW.project_id AND p.status='archived')
BEGIN
  SELECT RAISE(ABORT, 'archived project is read only');
END;

CREATE TRIGGER archived_order_insert_guard
BEFORE INSERT ON orders
WHEN EXISTS (SELECT 1 FROM projects p WHERE p.id=NEW.project_id AND p.status='archived')
BEGIN
  SELECT RAISE(ABORT, 'archived project is read only');
END;

CREATE TRIGGER archived_decision_share_insert_guard
BEFORE INSERT ON decision_shares
WHEN EXISTS (SELECT 1 FROM projects p WHERE p.id=NEW.project_id AND p.status='archived')
BEGIN
  SELECT RAISE(ABORT, 'archived project is read only');
END;

CREATE TRIGGER archived_report_insert_guard
BEFORE INSERT ON reports
WHEN EXISTS (SELECT 1 FROM projects p WHERE p.id=NEW.project_id AND p.status='archived')
BEGIN
  SELECT RAISE(ABORT, 'archived project is read only');
END;

CREATE TRIGGER archived_report_update_guard
BEFORE UPDATE ON reports
WHEN EXISTS (SELECT 1 FROM projects p WHERE p.id=OLD.project_id AND p.status='archived')
BEGIN
  SELECT RAISE(ABORT, 'archived project is read only');
END;

CREATE TRIGGER archived_ai_brief_insert_guard
BEFORE INSERT ON ai_planning_briefs
WHEN EXISTS (SELECT 1 FROM projects p WHERE p.id=NEW.project_id AND p.status='archived')
BEGIN
  SELECT RAISE(ABORT, 'archived project is read only');
END;

CREATE TRIGGER archived_ai_brief_update_guard
BEFORE UPDATE ON ai_planning_briefs
WHEN EXISTS (SELECT 1 FROM projects p WHERE p.id=OLD.project_id AND p.status='archived')
BEGIN
  SELECT RAISE(ABORT, 'archived project is read only');
END;

CREATE TRIGGER archived_family_room_insert_guard
BEFORE INSERT ON family_alignment_rooms
WHEN EXISTS (SELECT 1 FROM projects p WHERE p.id=NEW.project_id AND p.status='archived')
BEGIN
  SELECT RAISE(ABORT, 'archived project is read only');
END;

CREATE TRIGGER archived_family_response_insert_guard
BEFORE INSERT ON family_alignment_responses
WHEN EXISTS (
  SELECT 1 FROM family_alignment_rooms r
  JOIN projects p ON p.id=r.project_id AND p.user_id=r.user_id
  WHERE r.id=NEW.room_id AND p.status='archived'
)
BEGIN
  SELECT RAISE(ABORT, 'archived project is read only');
END;

CREATE TRIGGER archived_family_response_update_guard
BEFORE UPDATE ON family_alignment_responses
WHEN EXISTS (
  SELECT 1 FROM family_alignment_rooms r
  JOIN projects p ON p.id=r.project_id AND p.user_id=r.user_id
  WHERE r.id=OLD.room_id AND p.status='archived'
)
BEGIN
  SELECT RAISE(ABORT, 'archived project is read only');
END;
