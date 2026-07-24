-- 0010_profile_attempt_write_lockdown :: down
-- Restore the pre-0010 client write grants (the 0001 baseline).
GRANT INSERT, UPDATE ON profile TO authenticated;
GRANT INSERT, UPDATE ON attempt TO authenticated;
