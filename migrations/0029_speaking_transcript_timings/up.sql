-- 0029_speaking_transcript_timings :: up
-- Sentence-level sync timings for the transcript karaoke-replay (#3). Additive,
-- nullable-safe: a JSONB array of {text, startSec} captured at eval time from Whisper
-- word timestamps aligned onto the Gemini verbatim transcript. DEFAULT '[]' so existing
-- rows (and evals where Whisper STT is unconfigured) simply render a static transcript.
ALTER TABLE speaking_feedback
  ADD COLUMN transcript_timings jsonb NOT NULL DEFAULT '[]'::jsonb;
