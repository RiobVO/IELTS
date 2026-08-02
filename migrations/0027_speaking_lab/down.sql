-- 0027_speaking_lab :: down
DROP TABLE IF EXISTS speaking_audio_event;
DROP TABLE IF EXISTS speaking_feedback_debug;
DROP TABLE IF EXISTS speaking_feedback;
DROP TABLE IF EXISTS speaking_submission;
DROP TABLE IF EXISTS speaking_task;
ALTER TABLE profile DROP COLUMN IF EXISTS recording_consent_at;
DROP TYPE IF EXISTS speaking_audio_event_kind;
DROP TYPE IF EXISTS speaking_delete_reason;
DROP TYPE IF EXISTS speaking_confidence;
DROP TYPE IF EXISTS speaking_submission_status;
DROP TYPE IF EXISTS speaking_task_status;
DROP TYPE IF EXISTS speaking_part;
