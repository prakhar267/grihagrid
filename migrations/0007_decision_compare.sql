PRAGMA foreign_keys = ON;

-- `orders.plan` remains constrained to the historical plan identifiers.  The
-- new product code gives the public API a stable Decision Compare SKU without
-- rebuilding a live financial table or making old orders unreadable.
ALTER TABLE orders ADD COLUMN product_code TEXT;
ALTER TABLE orders ADD COLUMN entitlement_revoked_at TEXT;
ALTER TABLE orders ADD COLUMN entitlement_revocation_reason TEXT;
ALTER TABLE orders ADD COLUMN terms_version TEXT;
ALTER TABLE orders ADD COLUMN terms_accepted_at TEXT;

UPDATE orders SET product_code=plan WHERE product_code IS NULL;
CREATE INDEX idx_orders_product_status ON orders(product_code,status,created_at DESC);

-- 0004 keyed active entitlement uniqueness by the legacy `plan` column.  The
-- Decision Compare SKU deliberately reuses the legacy `plan` value so the
-- financial table's CHECK constraint remains intact; uniqueness must therefore
-- use the public product code introduced above.
DROP INDEX idx_orders_one_active_or_paid_per_plan;
CREATE UNIQUE INDEX idx_orders_one_active_or_paid_per_product
  ON orders(user_id,project_id,COALESCE(product_code,plan))
  WHERE user_id IS NOT NULL AND status IN ('created','paid');

-- Each save creates a new immutable comparison version.  Scenarios and all
-- derived calculations live in the canonical JSON envelope so a later pricing
-- or calculation release cannot mutate what the owner evaluated.
CREATE TABLE decision_comparisons (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK(version > 0),
  priority TEXT NOT NULL CHECK(priority IN ('balanced','budget','space','speed')),
  content_hash TEXT NOT NULL CHECK(length(content_hash) = 64),
  content_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(project_id,version),
  UNIQUE(project_id,content_hash)
);

CREATE INDEX idx_decision_comparisons_owner_created
  ON decision_comparisons(user_id,project_id,created_at DESC);

CREATE TABLE decision_selections (
  comparison_id TEXT PRIMARY KEY REFERENCES decision_comparisons(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scenario_id TEXT NOT NULL,
  selected_at TEXT NOT NULL,
  locked_at TEXT
);

CREATE INDEX idx_decision_selections_project
  ON decision_selections(user_id,project_id,selected_at DESC);

-- The purchased snapshot is the entitlement boundary.  It contains only the
-- versioned comparison artifact, never a pointer to mutable project inputs.
CREATE TABLE purchased_decision_snapshots (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  comparison_id TEXT NOT NULL REFERENCES decision_comparisons(id) ON DELETE RESTRICT,
  selected_scenario_id TEXT NOT NULL,
  snapshot_schema_version INTEGER NOT NULL CHECK(snapshot_schema_version > 0),
  content_hash TEXT NOT NULL CHECK(length(content_hash) = 64),
  artifact_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_purchased_decision_owner_created
  ON purchased_decision_snapshots(user_id,created_at DESC);

CREATE TABLE decision_shares (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  snapshot_id TEXT NOT NULL REFERENCES purchased_decision_snapshots(id) ON DELETE RESTRICT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash) = 64),
  idempotency_key TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL CHECK(length(request_hash) = 64),
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  access_count INTEGER NOT NULL DEFAULT 0 CHECK(access_count >= 0),
  last_accessed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_decision_shares_owner_created
  ON decision_shares(user_id,project_id,created_at DESC);
CREATE INDEX idx_decision_shares_expiry ON decision_shares(expires_at);

-- Analytics stores allowlisted low-cardinality dimensions only.  There is no
-- event stream, IP, user id, project id, email, free text, or raw request body.
CREATE TABLE product_event_aggregates (
  event_day TEXT NOT NULL,
  event_name TEXT NOT NULL,
  surface TEXT NOT NULL,
  outcome TEXT NOT NULL,
  event_count INTEGER NOT NULL CHECK(event_count > 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(event_day,event_name,surface,outcome)
);

-- Minimal paid-cohort progression. Opaque financial/snapshot keys are already
-- retained for entitlement; timestamps are monotonic and contain no project
-- inputs or identity data.
CREATE TABLE decision_progress (
  snapshot_id TEXT PRIMARY KEY REFERENCES purchased_decision_snapshots(id) ON DELETE RESTRICT,
  order_id TEXT NOT NULL UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
  first_opened_at TEXT,
  first_printed_at TEXT,
  first_shared_at TEXT,
  professional_handoff_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TRIGGER decision_comparisons_immutable_update
BEFORE UPDATE ON decision_comparisons
BEGIN SELECT RAISE(ABORT, 'decision comparisons are immutable'); END;

CREATE TRIGGER decision_comparisons_immutable_delete
BEFORE DELETE ON decision_comparisons
WHEN EXISTS (
  SELECT 1 FROM purchased_decision_snapshots s
  JOIN orders o ON o.id=s.order_id
  WHERE s.comparison_id=OLD.id AND o.status IN ('paid','refunded')
)
BEGIN SELECT RAISE(ABORT, 'purchased decision comparisons are immutable'); END;

CREATE TRIGGER decision_selections_immutable_update
BEFORE UPDATE ON decision_selections
BEGIN SELECT RAISE(ABORT, 'decision selections are immutable'); END;

CREATE TRIGGER purchased_decision_snapshots_immutable_update
BEFORE UPDATE ON purchased_decision_snapshots
BEGIN SELECT RAISE(ABORT, 'purchased decision snapshots are immutable'); END;

CREATE TRIGGER purchased_decision_snapshots_immutable_delete
BEFORE DELETE ON purchased_decision_snapshots
WHEN EXISTS (
  SELECT 1 FROM orders o WHERE o.id=OLD.order_id AND o.status IN ('paid','refunded')
)
BEGIN SELECT RAISE(ABORT, 'purchased decision snapshots are immutable'); END;

-- Failed/expired checkout attempts are not financial records and must not trap
-- an owner in an undeletable draft project.  Paid/refunded rows remain locked.
DROP TRIGGER purchased_report_snapshots_immutable_delete;
CREATE TRIGGER purchased_report_snapshots_immutable_delete
BEFORE DELETE ON purchased_report_snapshots
WHEN EXISTS (
  SELECT 1 FROM orders o WHERE o.id=OLD.order_id AND o.status IN ('paid','refunded')
)
BEGIN SELECT RAISE(ABORT, 'purchased report snapshots are immutable'); END;
