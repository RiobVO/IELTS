-- 0014_leaderboard_snapshot :: up
-- Rank movement (▲/▼) for the league. `leaderboard_entry` is fully rebuilt on
-- every rated attempt (delete + bulk insert in recomputeLeaderboard), so it
-- cannot carry a previous rank. This table persists a periodic snapshot of
-- ranks: a cron copies the current leaderboard_entry ranks here, and the league
-- read computes delta = snapshot.rank − current.rank (positive = moved up).
--
-- Read AND written exclusively via the Drizzle owner role (server-side), exactly
-- like leaderboard_entry. RLS is enabled with NO anon/authenticated grants
-- (fully locked, default-deny) so the anon/auth clients can never touch it.
-- Additive — touches nothing in grading / submit / RLS of other tables.

CREATE TABLE leaderboard_snapshot (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES profile(id) ON DELETE CASCADE,
  period      text NOT NULL,
  scope       text NOT NULL DEFAULT 'global',
  rank        integer NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, period, scope)
);

CREATE INDEX leaderboard_snapshot_lookup_idx
  ON leaderboard_snapshot (period, scope, user_id);

ALTER TABLE leaderboard_snapshot ENABLE ROW LEVEL SECURITY;
GRANT ALL ON leaderboard_snapshot TO service_role;
-- No anon/authenticated grants: snapshot is owner-path (Drizzle) only.
