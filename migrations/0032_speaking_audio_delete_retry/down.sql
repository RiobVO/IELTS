-- 0032_speaking_audio_delete_retry :: down
ALTER TABLE speaking_submission
  DROP COLUMN IF EXISTS audio_delete_attempts,
  DROP COLUMN IF EXISTS audio_delete_error;
