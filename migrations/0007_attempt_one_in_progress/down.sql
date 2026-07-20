-- 0007_attempt_one_in_progress :: down
-- Drop the partial unique guard. The collapsed duplicates are NOT restored (a
-- down is structural; the dedup was a one-way data repair).
DROP INDEX IF EXISTS attempt_one_in_progress_idx;
