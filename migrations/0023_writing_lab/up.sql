-- 0023_writing_lab :: up
-- Phase 3 unfreeze (Writing Lab, Task 2 MVP). Four additive tables for AI essay
-- evaluation. Core Reading/Listening grading/import stays LLM-free and untouched.
-- RLS mirrors existing tables: writing_task is published-gated (like content_item),
-- submission/feedback are owner-read (like annotation), and writing_feedback_debug
-- is hard-locked (like answer_key) so raw model output never reaches the client.
-- Tables 19-22 (see SCHEMA_NOTES.md "Phase 3 Writing").

CREATE TYPE writing_category          AS ENUM ('academic', 'general');
CREATE TYPE writing_task_status       AS ENUM ('draft', 'published');
CREATE TYPE writing_submission_status AS ENUM ('pending', 'evaluating', 'completed', 'failed');
CREATE TYPE writing_confidence        AS ENUM ('low', 'medium', 'high');

-- writing_task: admin-authored essay prompt. Published-gated like content_item;
-- drafts are read via the owner-path (admin), never the anon/authenticated client.
CREATE TABLE writing_task (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category      writing_category NOT NULL,
  prompt        text NOT NULL,
  tier_required user_tier NOT NULL DEFAULT 'ultra',   -- AI = Ultra (BRIEF §4.8)
  status        writing_task_status NOT NULL DEFAULT 'draft',
  created_by    uuid REFERENCES profile(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX writing_task_status_idx ON writing_task (status, category);

ALTER TABLE writing_task ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON writing_task TO authenticated;
GRANT ALL ON writing_task TO service_role;
CREATE POLICY writing_task_select_published ON writing_task
  FOR SELECT TO authenticated USING (status = 'published');

-- writing_submission: a user's essay attempt. Owner-read like annotation; writes
-- go through the owner-path server action (no insert/update grant). updated_at
-- drives the reaper: a row stuck in 'evaluating' past a threshold is failed.
CREATE TABLE writing_submission (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES profile(id) ON DELETE CASCADE,
  task_id    uuid NOT NULL REFERENCES writing_task(id) ON DELETE CASCADE,
  essay_text text NOT NULL,
  word_count integer NOT NULL,
  status     writing_submission_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX writing_submission_user_created_idx ON writing_submission (user_id, created_at);
-- Reaper scan: find rows stuck in a non-terminal state by age.
CREATE INDEX writing_submission_status_updated_idx ON writing_submission (status, updated_at);

ALTER TABLE writing_submission ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON writing_submission TO authenticated;
GRANT ALL ON writing_submission TO service_role;
CREATE POLICY writing_submission_select_own ON writing_submission
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- writing_feedback: the user-visible snapshot of the analysis. Owner-read THROUGH
-- the submission (EXISTS join, like passage→content_item). One row per submission.
-- Does NOT hold raw model output (that lives in writing_feedback_debug).
CREATE TABLE writing_feedback (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id  uuid NOT NULL UNIQUE REFERENCES writing_submission(id) ON DELETE CASCADE,
  band_low       numeric(2,1) NOT NULL,
  band_high      numeric(2,1) NOT NULL,
  confidence     writing_confidence NOT NULL,
  criteria       jsonb NOT NULL,
  top_fixes      jsonb NOT NULL,
  annotations    jsonb NOT NULL,
  rewrite        jsonb NOT NULL,
  checklist      jsonb NOT NULL,
  provider       text NOT NULL,
  model          text NOT NULL,
  prompt_version text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE writing_feedback ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON writing_feedback TO authenticated;
GRANT ALL ON writing_feedback TO service_role;
CREATE POLICY writing_feedback_select_own ON writing_feedback
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM writing_submission s
    WHERE s.id = writing_feedback.submission_id AND s.user_id = auth.uid()
  ));

-- writing_feedback_debug: raw model output for calibration/debugging. HARD-LOCKED
-- like answer_key — RLS on, NO anon/authenticated policy, grants revoked. Raw may
-- carry prompt-leakage / model reasoning; only the owner-path (Drizzle) reads it.
CREATE TABLE writing_feedback_debug (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id  uuid NOT NULL REFERENCES writing_submission(id) ON DELETE CASCADE,
  raw_output     text NOT NULL,
  provider       text NOT NULL,
  model          text NOT NULL,
  prompt_version text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX writing_feedback_debug_submission_idx ON writing_feedback_debug (submission_id);

ALTER TABLE writing_feedback_debug ENABLE ROW LEVEL SECURITY;
GRANT ALL ON writing_feedback_debug TO service_role;
REVOKE ALL ON writing_feedback_debug FROM anon, authenticated, PUBLIC;
