PRAGMA foreign_keys = ON;

-- AI briefs are a regenerable, owner-scoped cache. Each row records the exact
-- deterministic report, prompt revision, model, and provider interaction that
-- produced it. The provider request is sent with store=false, so no API key or
-- full prompt is retained here.
CREATE TABLE ai_planning_briefs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  schema_version INTEGER NOT NULL CHECK(schema_version > 0),
  prompt_version TEXT NOT NULL,
  prompt_sha256 TEXT NOT NULL CHECK(length(prompt_sha256) = 64),
  model TEXT NOT NULL,
  source_report_id TEXT NOT NULL,
  source_report_version INTEGER NOT NULL CHECK(source_report_version > 0),
  source_input_hash TEXT NOT NULL,
  content_json TEXT NOT NULL,
  usage_json TEXT,
  provider_interaction_id TEXT,
  generated_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_ai_briefs_user_updated
  ON ai_planning_briefs(user_id, updated_at DESC);
CREATE INDEX idx_ai_briefs_project_source
  ON ai_planning_briefs(project_id, source_input_hash);
CREATE UNIQUE INDEX idx_ai_briefs_provider_interaction
  ON ai_planning_briefs(provider_interaction_id)
  WHERE provider_interaction_id IS NOT NULL;
