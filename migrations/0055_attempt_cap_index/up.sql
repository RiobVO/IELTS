-- 0055_attempt_cap_index :: up
-- Backs the Basic practice/mock cap COUNT queries (src/lib/exam/access.ts,
-- owner decision 2026-07-17): both enforceAccess's soft early check and the
-- authoritative transactional check inside startAttempt filter
-- attempt(user_id, mode) with started_at in a day/week window. Unlike
-- attempt_user_submitted_idx (migration 0008), this is NOT partial on
-- status='submitted' — the cap counts every start (in_progress included),
-- not just completions, so status must stay out of the index predicate.

CREATE INDEX attempt_user_mode_started_idx
  ON attempt (user_id, mode, started_at);
