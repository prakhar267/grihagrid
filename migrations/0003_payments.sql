PRAGMA foreign_keys = ON;

-- Razorpay Payment Links are deliberately attached to the existing orders
-- table. `provider_order_id` stores the Payment Link id (plink_...), while the
-- browser-facing URL is retained only so an idempotent retry can return the
-- original checkout rather than creating another charge opportunity.
ALTER TABLE orders ADD COLUMN checkout_url TEXT;
ALTER TABLE orders ADD COLUMN provider_status TEXT;
ALTER TABLE orders ADD COLUMN provider_error_code TEXT;
ALTER TABLE orders ADD COLUMN paid_at TEXT;
ALTER TABLE orders ADD COLUMN provider_checkout_order_id TEXT;

-- Webhook bodies are never persisted. A stable event id plus the payload hash
-- is enough to deduplicate delivery and audit a conflicting replay without
-- retaining customer payment data.
CREATE TABLE payment_webhook_events (
  provider_event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  order_id TEXT REFERENCES orders(id) ON DELETE SET NULL,
  provider_payment_id TEXT,
  processing_result TEXT NOT NULL,
  received_at TEXT NOT NULL,
  processed_at TEXT NOT NULL
);

CREATE INDEX idx_orders_user_created ON orders(user_id, created_at DESC);
CREATE INDEX idx_orders_user_project_created ON orders(user_id, project_id, created_at DESC);
CREATE UNIQUE INDEX idx_orders_provider_checkout_order ON orders(provider_checkout_order_id) WHERE provider_checkout_order_id IS NOT NULL;
CREATE INDEX idx_payment_events_order_received ON payment_webhook_events(order_id, received_at DESC);
