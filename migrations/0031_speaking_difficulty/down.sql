-- 0031_speaking_difficulty :: down
-- Drop only the metadata column (its inline CHECK drops with it). Prompt / bullets /
-- status / tier_required and all existing cue-cards are untouched.
ALTER TABLE speaking_task
  DROP COLUMN IF EXISTS difficulty;
