-- 0042_email_opt_out :: down
-- Full revert. No RLS policy/grant to undo — the column inherited profile's posture.

ALTER TABLE profile DROP COLUMN IF EXISTS weekly_digest_opt_out;
