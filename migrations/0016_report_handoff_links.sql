PRAGMA foreign_keys = ON;

-- A Professional Handoff link is pinned to one exact immutable schema-v2
-- report revision. Only digests of bearer and idempotency secrets are stored.
CREATE TABLE report_shares (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_revision INTEGER NOT NULL CHECK(project_revision > 0),
  report_schema_version INTEGER NOT NULL CHECK(report_schema_version = 2),
  sections_json TEXT NOT NULL
    CHECK(json_valid(sections_json))
    CHECK(json_type(sections_json) = 'array')
    CHECK(json_array_length(sections_json) BETWEEN 1 AND 6),
  report_content_hash TEXT NOT NULL
    CHECK(length(report_content_hash) = 64)
    CHECK(report_content_hash NOT GLOB '*[^0-9a-f]*'),
  token_hash TEXT NOT NULL UNIQUE
    CHECK(length(token_hash) = 64)
    CHECK(token_hash NOT GLOB '*[^0-9a-f]*'),
  idempotency_key_hash TEXT NOT NULL UNIQUE
    CHECK(length(idempotency_key_hash) = 43),
  request_hash TEXT NOT NULL
    CHECK(length(request_hash) = 64)
    CHECK(request_hash NOT GLOB '*[^0-9a-f]*'),
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  access_count INTEGER NOT NULL DEFAULT 0 CHECK(access_count >= 0),
  last_accessed_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(project_id,project_revision,report_schema_version)
    REFERENCES project_revision_reports(project_id,project_revision,report_schema_version)
    ON DELETE CASCADE,
  CHECK(datetime(created_at) IS NOT NULL),
  CHECK(datetime(expires_at) IS NOT NULL AND expires_at > created_at),
  CHECK(revoked_at IS NULL OR (datetime(revoked_at) IS NOT NULL AND revoked_at >= created_at)),
  CHECK(last_accessed_at IS NULL OR (datetime(last_accessed_at) IS NOT NULL AND last_accessed_at >= created_at))
);

CREATE INDEX idx_report_shares_owner_created
  ON report_shares(user_id,project_id,created_at DESC,id DESC);
CREATE INDEX idx_report_shares_expiry
  ON report_shares(expires_at,revoked_at);
CREATE INDEX idx_report_shares_revoked
  ON report_shares(revoked_at) WHERE revoked_at IS NOT NULL;

-- The public bearer endpoint retains the KV perimeter and also uses this
-- strongly consistent hourly admission counter. The subject is a keyed HMAC
-- over the hour and request IP; raw IPs and bearer tokens are never stored,
-- and the pseudonym cannot be linked across hourly windows.
CREATE TABLE report_share_read_counters (
  subject_hash TEXT NOT NULL
    CHECK(length(subject_hash) = 64)
    CHECK(subject_hash NOT GLOB '*[^0-9a-f]*'),
  window_start TEXT NOT NULL CHECK(datetime(window_start) IS NOT NULL),
  request_count INTEGER NOT NULL CHECK(request_count BETWEEN 1 AND limit_count),
  limit_count INTEGER NOT NULL CHECK(limit_count BETWEEN 1 AND 120),
  updated_at TEXT NOT NULL CHECK(datetime(updated_at) IS NOT NULL),
  PRIMARY KEY(subject_hash,window_start)
);

CREATE INDEX idx_report_share_read_counters_updated
  ON report_share_read_counters(updated_at);

-- A strongly consistent account quota bounds create/revoke churn even when
-- eventually consistent KV increments race. Replays are reconciled before this
-- admission is consumed, and account deletion cascades its quota rows.
CREATE TABLE report_share_create_counters (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  window_start TEXT NOT NULL CHECK(datetime(window_start) IS NOT NULL),
  request_count INTEGER NOT NULL CHECK(request_count BETWEEN 1 AND limit_count),
  limit_count INTEGER NOT NULL CHECK(limit_count BETWEEN 1 AND 20),
  updated_at TEXT NOT NULL CHECK(datetime(updated_at) IS NOT NULL),
  PRIMARY KEY(user_id,window_start)
);

CREATE INDEX idx_report_share_create_counters_updated
  ON report_share_create_counters(updated_at);

-- Operations can stop new external sharing and public redemption immediately
-- with one D1 update, without a Worker deploy. Listing and revocation remain
-- available while this switch is closed. Missing or malformed state fails shut.
CREATE TABLE report_handoff_controls (
  control_key TEXT PRIMARY KEY CHECK(control_key = 'report_handoff'),
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  updated_at TEXT NOT NULL CHECK(datetime(updated_at) IS NOT NULL)
);

INSERT INTO report_handoff_controls(control_key,enabled,updated_at)
VALUES ('report_handoff',0,datetime('now'));

-- The control check that precedes a create request is only an early rejection.
-- This trigger is the write-time linearization point: once an operations
-- disable commits, no later report-share insert can cross it.
CREATE TRIGGER report_handoff_enabled_insert_guard
BEFORE INSERT ON report_shares
WHEN NOT EXISTS (
  SELECT 1 FROM report_handoff_controls
   WHERE control_key='report_handoff' AND enabled=1
)
BEGIN
  SELECT RAISE(ABORT, 'report handoff is disabled');
END;

-- The source and selected sections are checked again at SQL time. Historical
-- schema-v2 revisions remain intentionally shareable while their project is
-- active because the composite foreign key pins the exact immutable source.
CREATE TRIGGER report_share_sections_insert_guard
BEFORE INSERT ON report_shares
WHEN EXISTS (
       SELECT 1 FROM json_each(NEW.sections_json)
        WHERE type != 'text'
           OR value NOT IN ('overview','programme','cost','timeline','risks','next_actions')
     )
  OR (SELECT COUNT(DISTINCT value) FROM json_each(NEW.sections_json))
       != json_array_length(NEW.sections_json)
  OR NOT EXISTS (
       SELECT 1
         FROM projects p
         JOIN project_revision_reports rr
           ON rr.project_id=p.id
          AND rr.project_revision=NEW.project_revision
          AND rr.report_schema_version=NEW.report_schema_version
        WHERE p.id=NEW.project_id
          AND p.user_id=NEW.user_id
          AND rr.report_schema_version=2
     )
  OR NEW.expires_at NOT IN (
       datetime(NEW.created_at,'+1 day'),
       datetime(NEW.created_at,'+7 days'),
       datetime(NEW.created_at,'+30 days')
     )
BEGIN
  SELECT RAISE(ABORT, 'invalid report share source or sections');
END;

CREATE TRIGGER archived_report_share_insert_guard
BEFORE INSERT ON report_shares
WHEN EXISTS (
  SELECT 1 FROM projects p
   WHERE p.id=NEW.project_id AND p.user_id=NEW.user_id AND p.status='archived'
)
BEGIN
  SELECT RAISE(ABORT, 'archived project is read only');
END;

-- Five concurrent active links are sufficient for a small professional team.
-- D1 evaluates this guard in the serialized write transaction, so distinct
-- idempotency keys cannot race the project beyond its cap.
CREATE TRIGGER report_share_active_limit_insert
BEFORE INSERT ON report_shares
WHEN NEW.revoked_at IS NULL
  AND NEW.expires_at>datetime('now')
  AND (
  SELECT COUNT(*) FROM report_shares existing
   WHERE existing.project_id=NEW.project_id
     AND existing.user_id=NEW.user_id
     AND existing.revoked_at IS NULL
     AND existing.expires_at>datetime('now')
) >= 5
BEGIN
  SELECT RAISE(ABORT, 'report share active limit reached');
END;

-- A link can only record a monotonic view counter or transition once to
-- revoked. Its report, selected sections, token, expiry, and replay identity
-- can never be retargeted or extended.
CREATE TRIGGER report_share_identity_immutable
BEFORE UPDATE ON report_shares
WHEN NEW.id IS NOT OLD.id
  OR NEW.project_id IS NOT OLD.project_id
  OR NEW.user_id IS NOT OLD.user_id
  OR NEW.project_revision != OLD.project_revision
  OR NEW.report_schema_version != OLD.report_schema_version
  OR NEW.sections_json IS NOT OLD.sections_json
  OR NEW.report_content_hash IS NOT OLD.report_content_hash
  OR NEW.token_hash IS NOT OLD.token_hash
  OR NEW.idempotency_key_hash IS NOT OLD.idempotency_key_hash
  OR NEW.request_hash IS NOT OLD.request_hash
  OR NEW.expires_at IS NOT OLD.expires_at
  OR NEW.created_at IS NOT OLD.created_at
  OR NEW.access_count < OLD.access_count
  OR NEW.access_count > OLD.access_count + 1
  OR (OLD.last_accessed_at IS NOT NULL
      AND (NEW.last_accessed_at IS NULL OR NEW.last_accessed_at < OLD.last_accessed_at))
  OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NOT OLD.revoked_at)
BEGIN
  SELECT RAISE(ABORT, 'report share identity is immutable');
END;
