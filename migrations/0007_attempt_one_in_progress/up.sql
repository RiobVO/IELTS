-- 0007_attempt_one_in_progress :: up
-- Anti-cheat / integrity (BRIEF §4.6). ensureAttempt() resumes an existing
-- in_progress attempt instead of opening a second one — but that check-then-insert
-- has a race: two concurrent first-starts (double-click / two tabs / retry) both
-- miss the resume SELECT and both INSERT, leaving TWO in_progress rows for one
-- (user, content_item) and double-firing the test_start funnel event (§11).
--
-- A partial UNIQUE index makes "at most one in_progress attempt per (user, test)"
-- a database invariant; ensureAttempt pairs it with ON CONFLICT DO NOTHING so the
-- loser of the race resumes the winner's row instead of duplicating.
--
-- Collapse any pre-existing duplicates first (keep the most recent per pair),
-- otherwise the unique index would refuse to build on data created before this
-- guard existed. Safe no-op on an empty table.

DELETE FROM attempt a
USING attempt b
WHERE a.user_id = b.user_id
  AND a.content_item_id = b.content_item_id
  AND a.status = 'in_progress'
  AND b.status = 'in_progress'
  AND (a.started_at < b.started_at
       OR (a.started_at = b.started_at AND a.id < b.id));

CREATE UNIQUE INDEX attempt_one_in_progress_idx
  ON attempt (user_id, content_item_id)
  WHERE status = 'in_progress';
