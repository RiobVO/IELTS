-- 0012_profile_onboarding :: down
ALTER TABLE profile DROP COLUMN IF EXISTS onboarded_at;
