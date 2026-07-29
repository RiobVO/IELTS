-- 0019_content_review_gate :: up
-- Admin import review gate (BRIEF §4.2.1): a freshly imported / re-imported draft
-- must be explicitly approved by an admin before it can be published. reviewed_at
-- is the durable gate flag (NULL = not reviewed; the row is replaced on re-import
-- so it resets automatically). import_warnings stores the parser's detailed
-- low-confidence notes (unknown/fallback qtypes, empty keys, missing evidence)
-- for the review screen. Both nullable, no backfill — existing published tests
-- stay published (the gate only blocks NEW publishes of unreviewed drafts).

ALTER TABLE public.content_item
  ADD COLUMN IF NOT EXISTS reviewed_at     timestamptz,
  ADD COLUMN IF NOT EXISTS import_warnings jsonb;
