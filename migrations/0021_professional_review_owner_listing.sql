PRAGMA foreign_keys = ON;

-- Owner review history is listed newest-first and uses the request id as a
-- stable tie-breaker. Keep that path indexed without rewriting existing rows.
CREATE INDEX idx_professional_reviews_owner_requested
  ON professional_review_requests(owner_id, requested_at DESC, id DESC);
