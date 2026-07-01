-- 0032_speaking_audio_delete_retry :: up
-- #2/#6 retention retry model: audio deletion (user request or retention reaper) must set
-- audio_deleted_at ONLY after a successful object remove; a failed remove now stays
-- retryable (audio_deleted_at NULL) and records why. Two additive columns track that
-- state. DEFAULT 0 / NULL so existing rows are unaffected. Inherits the table's owner-read
-- grant (no new lock — same posture as the existing status/audio_path columns).
ALTER TABLE speaking_submission
  ADD COLUMN audio_delete_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN audio_delete_error    text;
