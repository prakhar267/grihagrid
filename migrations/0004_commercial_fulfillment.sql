PRAGMA foreign_keys = ON;

-- Every checkout freezes the exact project inputs, estimate, and generated
-- report that the customer evaluated.  The application never updates this
-- table; the triggers make that invariant explicit at the database boundary.
CREATE TABLE purchased_report_snapshots (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  source_report_id TEXT,
  snapshot_schema_version INTEGER NOT NULL CHECK(snapshot_schema_version > 0),
  report_version INTEGER NOT NULL CHECK(report_version > 0),
  input_hash TEXT NOT NULL,
  project_name TEXT NOT NULL,
  input_json TEXT NOT NULL,
  estimate_json TEXT,
  report_json TEXT NOT NULL,
  project_updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE order_fulfillments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
  snapshot_id TEXT NOT NULL UNIQUE REFERENCES purchased_report_snapshots(id) ON DELETE RESTRICT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  plan TEXT NOT NULL CHECK(plan IN ('plan','site_plus','expert')),
  status TEXT NOT NULL CHECK(status IN ('awaiting_input','queued','in_progress','ready','failed','cancelled')),
  status_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  ready_at TEXT
);

-- Existing installations may already contain an order.  Backfill an immutable
-- envelope from the best information retained at migration time.  New orders
-- are snapshotted by the Worker before a provider checkout is created.
INSERT INTO purchased_report_snapshots (
  id,order_id,project_id,user_id,source_report_id,snapshot_schema_version,
  report_version,input_hash,project_name,input_json,estimate_json,report_json,
  project_updated_at,created_at
)
SELECT
  'snapshot-' || o.id,
  o.id,
  o.project_id,
  o.user_id,
  r.id,
  1,
  COALESCE(r.version, 1),
  COALESCE(r.input_hash, 'legacy-' || o.id),
  p.name,
  p.input_json,
  p.estimate_json,
  COALESCE(r.content_json, '{}'),
  p.updated_at,
  COALESCE(o.paid_at, o.created_at)
FROM orders o
JOIN projects p ON p.id = o.project_id
LEFT JOIN reports r ON r.project_id = o.project_id;

-- Reconstruct fulfillment state for any payment committed before this
-- migration.  The unique order key keeps webhook retries idempotent.
INSERT INTO order_fulfillments (
  id,order_id,snapshot_id,project_id,user_id,plan,status,status_reason,
  created_at,updated_at,ready_at
)
SELECT
  'fulfillment-' || o.id,
  o.id,
  s.id,
  o.project_id,
  o.user_id,
  o.plan,
  CASE o.plan WHEN 'plan' THEN 'ready' WHEN 'site_plus' THEN 'awaiting_input' ELSE 'queued' END,
  CASE o.plan WHEN 'plan' THEN 'baseline_report_ready' WHEN 'site_plus' THEN 'awaiting_site_materials' ELSE 'expert_review_queue' END,
  COALESCE(o.paid_at, o.updated_at),
  COALESCE(o.paid_at, o.updated_at),
  CASE WHEN o.plan = 'plan' THEN COALESCE(o.paid_at, o.updated_at) ELSE NULL END
FROM orders o
JOIN purchased_report_snapshots s ON s.order_id = o.id
WHERE o.status = 'paid';

-- A different browser key must not create another payable link for the same
-- product.  Failed and refunded attempts remain retryable.
CREATE UNIQUE INDEX idx_orders_one_active_or_paid_per_plan
  ON orders(user_id, project_id, plan)
  WHERE user_id IS NOT NULL AND status IN ('created','paid');

CREATE INDEX idx_purchased_snapshots_user_created
  ON purchased_report_snapshots(user_id, created_at DESC);
CREATE INDEX idx_fulfillments_user_updated
  ON order_fulfillments(user_id, updated_at DESC);
CREATE INDEX idx_fulfillments_project_updated
  ON order_fulfillments(project_id, updated_at DESC);

CREATE TRIGGER purchased_report_snapshots_immutable_update
BEFORE UPDATE ON purchased_report_snapshots
BEGIN
  SELECT RAISE(ABORT, 'purchased report snapshots are immutable');
END;

CREATE TRIGGER purchased_report_snapshots_immutable_delete
BEFORE DELETE ON purchased_report_snapshots
BEGIN
  SELECT RAISE(ABORT, 'purchased report snapshots are immutable');
END;
