-- 0031_speaking_difficulty :: up
-- Per-cue-card difficulty for the Speaking catalog (mirrors writing_task.difficulty,
-- migration 0025). Additive + nullable so existing cue-cards survive until an admin
-- sets a level; the catalog hides the meter when null. CHECK pins the 1/2/3 set the
-- UI maps over. Content metadata only — grading / RLS / tier / audio untouched.

ALTER TABLE speaking_task
  ADD COLUMN IF NOT EXISTS difficulty smallint
    CHECK (difficulty IN (1, 2, 3));
