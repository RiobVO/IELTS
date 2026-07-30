-- 0021_attempt_review_snapshot :: down
-- Drop the snapshot table. /result reverts to reading the live answer_key.

DROP TABLE IF EXISTS attempt_review_snapshot;
