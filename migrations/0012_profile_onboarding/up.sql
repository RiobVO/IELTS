-- 0012_profile_onboarding :: up
-- Onboarding capture (W1-2). A nullable stamp marking that the user finished the
-- post-signup onboarding (display_name / region / target_band). NULL means "not
-- yet"; the dashboard gates unboarded users to /app/onboarding. Nullable add —
-- existing rows default to NULL (treated as not-yet-onboarded, which is fine:
-- they get the one-time prompt on their next dashboard visit).

ALTER TABLE profile ADD COLUMN onboarded_at timestamptz;
