-- 0025_writing_topic_meta :: down
-- Drop only the metadata columns (their inline CHECK constraints drop with them).
-- prompt / category / status / tier_required and all existing rows are untouched.
ALTER TABLE writing_task
  DROP COLUMN IF EXISTS band_high,
  DROP COLUMN IF EXISTS band_low,
  DROP COLUMN IF EXISTS difficulty,
  DROP COLUMN IF EXISTS task_type,
  DROP COLUMN IF EXISTS topic;
