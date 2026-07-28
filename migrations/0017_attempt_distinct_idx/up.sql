-- 0017_attempt_distinct_idx :: up
-- Perf only, no behaviour change (perf track #4).
--
-- leaderboard.ts recomputeLeaderboard().sumSince computes weekly/monthly scores
-- with a DISTINCT ON (user_id, content_item_id) ... WHERE status='submitted'
-- ORDER BY user_id, content_item_id, submitted_at ASC (first submitted attempt
-- per test, anti-farm §4.6). The existing attempt_user_submitted_idx is
-- (user_id, submitted_at) WHERE status='submitted' -- its second column is
-- submitted_at, not content_item_id, so it cannot serve the DISTINCT ON
-- grouping and the planner falls back to a scan + sort over all submitted rows.
--
-- A partial index keyed (user_id, content_item_id, submitted_at) over
-- status='submitted' matches the DISTINCT ON exactly: the leading
-- (user_id, content_item_id) is the distinct key, the trailing submitted_at
-- supplies the ordered first-row pick, and the predicate mirrors the WHERE. It
-- is additive, not a replacement -- attempt_user_submitted_idx still backs the
-- (user_id, submitted_at)-ordered hot paths (computeStats, daily-limit,
-- throttle, dashboard/profile lists).

CREATE INDEX attempt_user_content_submitted_idx
  ON attempt (user_id, content_item_id, submitted_at)
  WHERE status = 'submitted';
