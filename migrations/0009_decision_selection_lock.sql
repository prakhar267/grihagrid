PRAGMA foreign_keys = ON;

-- A monotonic source revision gives checkout a database-comparable fence.  The
-- content hash remains the semantic integrity check; the revision closes the
-- gap between that application read and the atomic checkout batch.
ALTER TABLE projects ADD COLUMN input_revision INTEGER NOT NULL DEFAULT 1
  CHECK(input_revision > 0);
ALTER TABLE decision_comparisons ADD COLUMN project_input_revision INTEGER NOT NULL DEFAULT 1
  CHECK(project_input_revision > 0);

CREATE TRIGGER projects_input_revision_guard
BEFORE UPDATE ON projects
WHEN (
    (NEW.input_json IS NOT OLD.input_json OR NEW.estimate_json IS NOT OLD.estimate_json)
    AND NEW.input_revision != OLD.input_revision + 1
  ) OR (
    NEW.input_json IS OLD.input_json AND NEW.estimate_json IS OLD.estimate_json
    AND NEW.input_revision != OLD.input_revision
  )
BEGIN
  SELECT RAISE(ABORT, 'project input revision must match the source change');
END;

-- 0007 locked a decision as soon as the owner clicked A or B.  That is too
-- early: the choice remains an editable working preference until checkout
-- atomically freezes it with a purchase snapshot.  This forward migration is
-- required because 0007 has already been applied outside local development.
DROP TRIGGER IF EXISTS decision_selections_immutable_update;

-- Release only selections that have no purchase boundary and no active
-- Decision Compare checkout.  Rows tied to a snapshot or active order remain
-- locked even if their historical `locked_at` value came from 0007.
UPDATE decision_selections
   SET locked_at=NULL
 WHERE locked_at IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM purchased_decision_snapshots s
      WHERE s.comparison_id=decision_selections.comparison_id
   )
   AND NOT EXISTS (
     SELECT 1 FROM orders o
      WHERE o.project_id=decision_selections.project_id
        AND o.user_id=decision_selections.user_id
        AND COALESCE(o.product_code,o.plan)='decision_compare'
        AND o.status IN ('created','paid')
   );

-- An unlocked working choice may change.  Once checkout has set `locked_at`,
-- or durable purchase evidence exists, neither the scenario nor its timestamps
-- may be rewritten.
CREATE TRIGGER decision_selections_locked_update
BEFORE UPDATE ON decision_selections
WHEN OLD.locked_at IS NOT NULL
  OR EXISTS (
    SELECT 1 FROM purchased_decision_snapshots s
     WHERE s.comparison_id=OLD.comparison_id
  )
  OR EXISTS (
    SELECT 1 FROM orders o
     WHERE o.project_id=OLD.project_id
       AND o.user_id=OLD.user_id
       AND COALESCE(o.product_code,o.plan)='decision_compare'
       AND o.status IN ('created','paid')
  )
BEGIN
  SELECT RAISE(ABORT, 'purchased decision selections are immutable');
END;

CREATE TRIGGER decision_selections_locked_delete
BEFORE DELETE ON decision_selections
WHEN EXISTS (
    SELECT 1 FROM purchased_decision_snapshots s
     WHERE s.comparison_id=OLD.comparison_id
  )
  OR EXISTS (
    SELECT 1 FROM orders o
     WHERE o.project_id=OLD.project_id
       AND o.user_id=OLD.user_id
       AND COALESCE(o.product_code,o.plan)='decision_compare'
       AND o.status IN ('created','paid')
  )
BEGIN
  SELECT RAISE(ABORT, 'purchased decision selections are immutable');
END;

-- The snapshot insert is the database-enforced purchase boundary.  It can
-- commit only when the exact selected scenario was locked in the same D1 batch
-- (or was already locked by an earlier failed checkout snapshot).
CREATE TRIGGER purchased_decision_snapshot_requires_locked_selection
BEFORE INSERT ON purchased_decision_snapshots
WHEN NOT EXISTS (
  SELECT 1 FROM decision_selections s
  JOIN decision_comparisons c ON c.id=s.comparison_id
  JOIN projects p ON p.id=s.project_id AND p.user_id=s.user_id
   WHERE s.comparison_id=NEW.comparison_id
     AND s.project_id=NEW.project_id
     AND s.user_id=NEW.user_id
     AND s.scenario_id=NEW.selected_scenario_id
     AND s.locked_at IS NOT NULL
     AND c.project_input_revision=p.input_revision
)
BEGIN
  SELECT RAISE(ABORT, 'purchase snapshot requires the locked decision selection');
END;
