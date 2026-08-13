PRAGMA foreign_keys = ON;

-- New checkout attempts persist a canonical hash of the complete commercial
-- request. Existing rows remain nullable because their original consent and
-- client request cannot be reconstructed safely after the fact.
ALTER TABLE orders ADD COLUMN request_hash TEXT
  CHECK(request_hash IS NULL OR length(request_hash) = 64);

CREATE INDEX idx_orders_request_hash ON orders(request_hash)
  WHERE request_hash IS NOT NULL;

-- Provider terminal facts must survive out-of-order delivery.  A processed
-- refund is unique by refund id (not webhook delivery id), so separate events
-- for the same refund can never be counted twice.  The payment-id index lets a
-- later capture reconcile terminal evidence that arrived before the order had
-- a provider_payment_id.
CREATE TABLE payment_terminal_records (
  record_type TEXT NOT NULL CHECK(record_type IN ('refund','dispute')),
  provider_object_id TEXT NOT NULL,
  terminal_action TEXT NOT NULL CHECK(terminal_action IN ('refund_processed','entitlement_revoked')),
  provider_event_id TEXT NOT NULL UNIQUE,
  provider_payment_id TEXT NOT NULL,
  order_id TEXT REFERENCES orders(id) ON DELETE SET NULL,
  amount_paise INTEGER CHECK(amount_paise IS NULL OR amount_paise > 0),
  currency TEXT,
  provider_state TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  PRIMARY KEY(record_type,provider_object_id,terminal_action),
  CHECK(
    (record_type='refund' AND terminal_action='refund_processed' AND amount_paise IS NOT NULL AND currency IS NOT NULL)
    OR
    (record_type='dispute' AND terminal_action='entitlement_revoked' AND amount_paise IS NULL AND currency IS NULL)
  )
);

CREATE INDEX idx_payment_terminal_payment
  ON payment_terminal_records(provider_payment_id,record_type,terminal_action,observed_at);
CREATE INDEX idx_payment_terminal_order
  ON payment_terminal_records(order_id,observed_at DESC);

CREATE TRIGGER payment_terminal_records_immutable_update
BEFORE UPDATE ON payment_terminal_records
BEGIN SELECT RAISE(ABORT, 'payment terminal records are immutable'); END;

CREATE TRIGGER payment_terminal_records_immutable_delete
BEFORE DELETE ON payment_terminal_records
BEGIN SELECT RAISE(ABORT, 'payment terminal records are immutable'); END;

-- A second authentic capture after a replacement has already been paid is a
-- financial exception, not another entitlement.  Keep an explicit open case
-- until a processed full refund or an authorised manual finance workflow
-- resolves it.
CREATE TABLE payment_reconciliation_cases (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  conflicting_order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  provider_event_id TEXT NOT NULL UNIQUE,
  provider_payment_id TEXT NOT NULL UNIQUE,
  reason TEXT NOT NULL CHECK(reason IN ('duplicate_late_capture')),
  status TEXT NOT NULL CHECK(status IN ('open','resolved_refunded','resolved_manual')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE INDEX idx_payment_reconciliation_status
  ON payment_reconciliation_cases(status,created_at);
CREATE INDEX idx_payment_reconciliation_orders
  ON payment_reconciliation_cases(order_id,conflicting_order_id);
