-- 0019_content_review_gate :: down
-- Drop the review-gate columns. Behaviour reverts to publish-without-review.

ALTER TABLE public.content_item
  DROP COLUMN IF EXISTS import_warnings,
  DROP COLUMN IF EXISTS reviewed_at;
