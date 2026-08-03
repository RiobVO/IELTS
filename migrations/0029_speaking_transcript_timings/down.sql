-- 0029_speaking_transcript_timings :: down
ALTER TABLE speaking_feedback DROP COLUMN IF EXISTS transcript_timings;
