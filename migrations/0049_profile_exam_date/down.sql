-- 0049_profile_exam_date :: down
-- Full revert. No RLS policy/grant to undo — the column inherited profile's posture.

ALTER TABLE profile DROP COLUMN IF EXISTS exam_date;
