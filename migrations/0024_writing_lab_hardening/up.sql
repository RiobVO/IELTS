-- 0024_writing_lab_hardening :: up
-- (1) Anti-farm: at most ONE active (pending|evaluating) writing submission per
--     user — a concurrent/rapid second submit can't farm free evaluations while
--     the first is in flight (mirrors 0007 attempt_one_in_progress).
-- (2) Defense-in-depth: REVOKE client write-grants on the writing tables. RLS
--     already denies writes (no write-policy), but Supabase default-privileges
--     hand new tables [SIUD] to authenticated/anon; this removes the broad grant
--     so the owner-path is provably the only writer. debug is already locked.

CREATE UNIQUE INDEX writing_submission_one_active_idx
  ON writing_submission (user_id)
  WHERE status IN ('pending', 'evaluating');

REVOKE INSERT, UPDATE, DELETE ON writing_task       FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON writing_submission FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON writing_feedback   FROM anon, authenticated;
REVOKE ALL ON writing_task       FROM anon;  -- task is published-read for authenticated only
REVOKE ALL ON writing_submission FROM anon;
REVOKE ALL ON writing_feedback   FROM anon;
