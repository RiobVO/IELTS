-- 0049_profile_exam_date :: up
-- Exam-date countdown (BRIEF §12.3). Nullable date the user can set at onboarding
-- or later from the dashboard; NULL = no countdown shown. Column inherits
-- profile's existing RLS posture (owner-only SELECT/UPDATE) — no new grants/
-- policies needed, same reasoning as 0042's weekly_digest_opt_out.

ALTER TABLE profile ADD COLUMN exam_date date;
