PRAGMA foreign_keys = ON;

ALTER TABLE users ADD COLUMN account_role TEXT NOT NULL DEFAULT 'customer'
  CHECK(account_role IN ('customer', 'reviewer', 'admin'));

CREATE TABLE professional_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 2 AND 100),
  discipline TEXT NOT NULL CHECK(discipline IN ('architect', 'structural_engineer')),
  license_jurisdiction TEXT NOT NULL CHECK(length(license_jurisdiction) BETWEEN 2 AND 100),
  license_reference TEXT NOT NULL CHECK(length(license_reference) BETWEEN 2 AND 100),
  verification_status TEXT NOT NULL CHECK(verification_status IN ('pending', 'verified', 'suspended')),
  verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK((verification_status='verified' AND verified_at IS NOT NULL) OR verification_status!='verified')
);

CREATE TABLE professional_review_requests (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reviewer_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  project_revision INTEGER NOT NULL CHECK(project_revision > 0),
  report_schema_version INTEGER NOT NULL CHECK(report_schema_version > 0),
  report_content_hash TEXT NOT NULL CHECK(length(report_content_hash)=64),
  owner_note TEXT NOT NULL DEFAULT '' CHECK(length(owner_note) <= 1000),
  reviewer_summary TEXT CHECK(reviewer_summary IS NULL OR length(reviewer_summary) BETWEEN 20 AND 4000),
  status TEXT NOT NULL CHECK(status IN ('requested', 'assigned', 'needs_owner_input', 'reviewed', 'cancelled')),
  idempotency_key_hash TEXT NOT NULL CHECK(length(idempotency_key_hash)=64),
  requested_at TEXT NOT NULL,
  assigned_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(owner_id, idempotency_key_hash),
  CHECK((status='requested' AND reviewer_id IS NULL AND assigned_at IS NULL)
    OR (status='cancelled')
    OR (status IN ('assigned', 'needs_owner_input', 'reviewed') AND reviewer_id IS NOT NULL AND assigned_at IS NOT NULL)),
  CHECK((status='reviewed' AND completed_at IS NOT NULL AND reviewer_summary IS NOT NULL)
    OR status!='reviewed')
);

CREATE UNIQUE INDEX idx_professional_reviews_active_source
  ON professional_review_requests(project_id, project_revision, report_schema_version)
  WHERE status IN ('requested', 'assigned', 'needs_owner_input');
CREATE INDEX idx_professional_reviews_owner_updated
  ON professional_review_requests(owner_id, updated_at DESC);
CREATE INDEX idx_professional_reviews_reviewer_updated
  ON professional_review_requests(reviewer_id, status, updated_at DESC);
CREATE INDEX idx_professional_reviews_queue
  ON professional_review_requests(status, requested_at ASC);

CREATE TABLE professional_review_messages (
  id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL REFERENCES professional_review_requests(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  author_role TEXT NOT NULL CHECK(author_role IN ('owner', 'reviewer')),
  body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),
  created_at TEXT NOT NULL
);

CREATE INDEX idx_professional_review_messages_review_created
  ON professional_review_messages(review_id, created_at ASC, id ASC);

CREATE TABLE professional_review_events (
  id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL REFERENCES professional_review_requests(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK(action IN ('requested', 'claimed', 'message_added', 'owner_response', 'reviewed', 'cancelled')),
  detail_hash TEXT NOT NULL CHECK(length(detail_hash)=64),
  created_at TEXT NOT NULL
);

CREATE INDEX idx_professional_review_events_review_created
  ON professional_review_events(review_id, created_at ASC, id ASC);

CREATE TRIGGER professional_profile_role_guard
BEFORE INSERT ON professional_profiles
WHEN NOT EXISTS (
  SELECT 1 FROM users WHERE id=NEW.user_id AND account_role IN ('reviewer', 'admin') AND deleted_at IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'professional profile role invalid');
END;

CREATE TRIGGER professional_review_owner_guard
BEFORE INSERT ON professional_review_requests
WHEN NOT EXISTS (
  SELECT 1 FROM projects p
   WHERE p.id=NEW.project_id AND p.user_id=NEW.owner_id AND p.status!='archived'
)
BEGIN
  SELECT RAISE(ABORT, 'professional review owner invalid');
END;

CREATE TRIGGER professional_review_assignment_guard
BEFORE UPDATE OF reviewer_id,status ON professional_review_requests
WHEN NEW.reviewer_id IS NOT NULL AND NOT EXISTS (
  SELECT 1
    FROM users u JOIN professional_profiles p ON p.user_id=u.id
   WHERE u.id=NEW.reviewer_id AND u.account_role IN ('reviewer', 'admin')
     AND u.deleted_at IS NULL AND p.verification_status='verified'
)
BEGIN
  SELECT RAISE(ABORT, 'professional reviewer is not verified');
END;

CREATE TRIGGER professional_review_source_immutable
BEFORE UPDATE ON professional_review_requests
WHEN NEW.id!=OLD.id OR NEW.project_id!=OLD.project_id OR NEW.owner_id!=OLD.owner_id
  OR NEW.project_revision!=OLD.project_revision
  OR NEW.report_schema_version!=OLD.report_schema_version
  OR NEW.report_content_hash!=OLD.report_content_hash
  OR NEW.owner_note!=OLD.owner_note
  OR NEW.idempotency_key_hash!=OLD.idempotency_key_hash
  OR NEW.requested_at!=OLD.requested_at
BEGIN
  SELECT RAISE(ABORT, 'professional review source is immutable');
END;

CREATE TRIGGER professional_review_messages_immutable_update
BEFORE UPDATE ON professional_review_messages
BEGIN
  SELECT RAISE(ABORT, 'professional review messages are immutable');
END;

CREATE TRIGGER professional_review_events_immutable_update
BEFORE UPDATE ON professional_review_events
BEGIN
  SELECT RAISE(ABORT, 'professional review events are immutable');
END;
