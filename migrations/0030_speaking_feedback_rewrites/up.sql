-- 0030_speaking_feedback_rewrites :: up
-- "Say it stronger" (#1): band-7/8 upgrades of the candidate's own lines, captured at
-- eval time. JSONB array of {original, improved}. Additive, DEFAULT '[]' so existing rows
-- (and short/no-speech answers) render no block. Separate from 0029 transcript_timings.
ALTER TABLE speaking_feedback
  ADD COLUMN rewrites jsonb NOT NULL DEFAULT '[]'::jsonb;
