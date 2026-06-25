-- 0024_writing_lab_hardening :: down
DROP INDEX IF EXISTS writing_submission_one_active_idx;
-- Re-grant to restore the pre-0024 baseline (Supabase default-privilege shape).
GRANT INSERT, UPDATE, DELETE ON writing_task       TO authenticated;
GRANT INSERT, UPDATE, DELETE ON writing_submission TO authenticated;
GRANT INSERT, UPDATE, DELETE ON writing_feedback   TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON writing_task       TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON writing_submission TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON writing_feedback   TO anon;
