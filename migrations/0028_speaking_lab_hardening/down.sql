-- 0028_speaking_lab_hardening :: down
DROP INDEX IF EXISTS speaking_submission_one_active_idx;
GRANT SELECT ON speaking_task        TO authenticated;
GRANT SELECT ON speaking_submission  TO authenticated;
GRANT SELECT ON speaking_feedback    TO authenticated;
GRANT SELECT ON speaking_audio_event TO authenticated;
