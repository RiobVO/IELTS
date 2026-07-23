-- 0008_perf_indexes :: down
-- Drop the unread partial and restore the original full (non-partial) attempt
-- index from 0000. Structural reverse — index contents rebuild from the table.
DROP INDEX IF EXISTS notification_user_unread_idx;

DROP INDEX IF EXISTS attempt_user_submitted_idx;
CREATE INDEX attempt_user_submitted_idx ON attempt (user_id, submitted_at);
