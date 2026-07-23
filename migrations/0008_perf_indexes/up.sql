-- 0008_perf_indexes :: up
-- Hot-path index tuning (perf only, no behaviour change).
--
-- 1) attempt: replace the existing (user_id, submitted_at) index with a PARTIAL
--    version over status='submitted'. Every hot attempt-by-user query filters
--    status='submitted' (badges' computeStats, the Basic daily-limit count, the
--    submit throttle, the dashboard/profile lists), and in_progress rows are
--    short-lived, so the partial index is smaller and lets the planner skip the
--    status recheck. No query reads (user_id, submitted_at) WITHOUT
--    status='submitted', so nothing loses its index.
--
-- 2) notification: a PARTIAL (user_id) WHERE read_at IS NULL backs the unread
--    badge count (AppShell) directly — far fewer rows than the full
--    (user_id, created_at) index, which still serves the ordered list view.
--
-- user_badge(user_id) is intentionally NOT added: its primary key is
-- (user_id, badge_id), whose leading column already indexes every WHERE
-- user_id = ... lookup (evaluateBadges, the badges page). A standalone index
-- would be redundant.

DROP INDEX IF EXISTS attempt_user_submitted_idx;
CREATE INDEX attempt_user_submitted_idx
  ON attempt (user_id, submitted_at)
  WHERE status = 'submitted';

CREATE INDEX notification_user_unread_idx
  ON notification (user_id)
  WHERE read_at IS NULL;
