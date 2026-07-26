/**
 * Leaderboard precompute + read (BRIEF §4.6, §5 `leaderboard_entry`, §6.1).
 *
 * SERVER-ONLY. This module connects via the Drizzle owner client (`@/db`), which
 * bypasses RLS, because:
 *   - the precompute must read ALL profiles (the anon client can read only the
 *     viewer's own profile row — profile RLS is owner-only), and
 *   - the read joins other users' PUBLIC columns (display_name, avatar_url) which
 *     the anon client likewise cannot reach for rows that aren't the viewer's.
 * Only safe public columns are ever selected into a payload — never email or any
 * private field (the task's hard rule).
 *
 * §6.1 mandates the leaderboard be PRECOMPUTED, not computed on-the-fly:
 * `recomputeLeaderboard()` does a full rebuild of `leaderboard_entry` and is
 * called after each rated attempt. At current scale a full rebuild in one
 * transaction is fine; an incremental/cron version is a later optimization.
 */
import { and, asc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  attempt,
  leaderboardEntry,
  leaderboardSnapshot,
  profile,
  region,
} from "@/db/schema";

export type Period = "weekly" | "monthly" | "all_time";

export interface LeaderRow {
  rank: number;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  regionName: string | null;
  rating: number;
  score: number;
  isViewer: boolean;
  /** Rank change since the last snapshot (positive = moved up); null if no
   *  snapshot baseline yet (new entry, or the cron hasn't run / been applied). */
  delta: number | null;
}

const PERIODS: Period[] = ["weekly", "monthly", "all_time"];
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
/** Insert in chunks to stay well under Postgres' parameter limit. */
const INSERT_CHUNK = 500;

/** A user's loaded profile facts needed to rank them. */
interface RankUser {
  id: string;
  rating: number;
  ratedCount: number;
  regionId: string | null;
}

/**
 * Resolve the set of leaderboard scopes a user belongs to: always `'global'`,
 * plus the user's own region id and every ancestor region id (district ->
 * region -> country), walking `parent_id` up the tree. A user with no region
 * belongs to `'global'` only. Scope ids are region uuids stored as text
 * (SCHEMA_NOTES: `leaderboard_entry.scope` = `'global' | <region_id as text>`).
 */
function scopesForUser(
  regionId: string | null,
  parentOf: Map<string, string | null>,
): string[] {
  const scopes = ["global"];
  let cur: string | null | undefined = regionId;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    scopes.push(cur);
    cur = parentOf.get(cur) ?? null;
  }
  return scopes;
}

/**
 * One ranked period: from the eligible users (with their score), partition by
 * scope, sort, and emit `leaderboard_entry` rows. Sort is score DESC, then
 * rating DESC, then id ASC (stable, deterministic tiebreak).
 */
function rankPeriod(
  period: Period,
  users: RankUser[],
  scoreOf: Map<string, number>,
  eligible: (u: RankUser, score: number) => boolean,
  parentOf: Map<string, string | null>,
): (typeof leaderboardEntry.$inferInsert)[] {
  // Group eligible users by scope.
  const byScope = new Map<string, RankUser[]>();
  for (const u of users) {
    const score = scoreOf.get(u.id) ?? 0;
    if (!eligible(u, score)) continue;
    for (const scope of scopesForUser(u.regionId, parentOf)) {
      (byScope.get(scope) ?? byScope.set(scope, []).get(scope)!).push(u);
    }
  }

  const rows: (typeof leaderboardEntry.$inferInsert)[] = [];
  for (const [scope, members] of byScope) {
    members.sort((a, b) => {
      const sa = scoreOf.get(a.id) ?? 0;
      const sb = scoreOf.get(b.id) ?? 0;
      if (sb !== sa) return sb - sa;
      if (b.rating !== a.rating) return b.rating - a.rating;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    members.forEach((u, i) => {
      rows.push({
        userId: u.id,
        period,
        scope,
        rating: u.rating,
        score: scoreOf.get(u.id) ?? 0,
        rank: i + 1,
      });
    });
  }
  return rows;
}

/**
 * Full rebuild of `leaderboard_entry` for all three periods and every scope.
 * Excludes `hidden_from_leaderboard` profiles (anti-cheat gatekeeper, §4.6 /
 * SCHEMA_NOTES — the precompute job is where `hidden` is enforced, not RLS).
 *
 * Scores:
 *   - all_time: score = rating; eligible if ratedCount > 0.
 *   - weekly:   score = SUM(raw_score) over the user's FIRST submitted attempt
 *               of each test whose first attempt falls in the last 7 days;
 *               eligible if score > 0.
 *   - monthly:  same, last 30 days; eligible if score > 0.
 *
 * Anti-farm (§4.6): each test counts at most once — its first submitted attempt
 * — so replaying the same test cannot pad weekly/monthly scores (mirrors the
 * "only the first attempt is rated" rule).
 */
export async function recomputeLeaderboard(): Promise<void> {
  const now = new Date();

  // Visible profiles only.
  const profiles = await db
    .select({
      id: profile.id,
      rating: profile.rating,
      ratedCount: profile.ratedCount,
      regionId: profile.regionId,
    })
    .from(profile)
    .where(eq(profile.hiddenFromLeaderboard, false));

  const users: RankUser[] = profiles.map((p) => ({
    id: p.id,
    rating: p.rating,
    ratedCount: p.ratedCount,
    regionId: p.regionId,
  }));
  const visibleIds = new Set(users.map((u) => u.id));

  // Region ancestry map (id -> parentId) for scope resolution.
  const regions = await db
    .select({ id: region.id, parentId: region.parentId })
    .from(region);
  const parentOf = new Map<string, string | null>();
  for (const r of regions) parentOf.set(r.id, r.parentId);

  // Windowed score sums (weekly / monthly) — grouped on the DB. Anti-farm: a
  // test contributes only its FIRST submitted attempt (DISTINCT ON earliest per
  // (user, content_item)), so replays can't pad period scores (§4.6).
  const sumSince = async (sinceMs: number): Promise<Map<string, number>> => {
    const since = new Date(now.getTime() - sinceMs);
    const firstAttempt = db
      .selectDistinctOn([attempt.userId, attempt.contentItemId], {
        userId: attempt.userId,
        rawScore: attempt.rawScore,
        submittedAt: attempt.submittedAt,
      })
      .from(attempt)
      .where(eq(attempt.status, "submitted"))
      .orderBy(attempt.userId, attempt.contentItemId, asc(attempt.submittedAt))
      .as("fa");

    const rows = await db
      .select({
        userId: firstAttempt.userId,
        total: sql<number>`coalesce(sum(${firstAttempt.rawScore}), 0)::int`,
      })
      .from(firstAttempt)
      .where(gte(firstAttempt.submittedAt, since))
      .groupBy(firstAttempt.userId);

    const m = new Map<string, number>();
    for (const r of rows) {
      // Hidden users excluded from the leaderboard entirely.
      if (visibleIds.has(r.userId)) m.set(r.userId, Number(r.total) || 0);
    }
    return m;
  };

  const weekScore = await sumSince(WEEK_MS);
  const monthScore = await sumSince(MONTH_MS);

  // all_time score = rating.
  const allTimeScore = new Map<string, number>();
  for (const u of users) allTimeScore.set(u.id, u.rating);

  const allRows: (typeof leaderboardEntry.$inferInsert)[] = [
    ...rankPeriod(
      "weekly",
      users,
      weekScore,
      (_u, score) => score > 0,
      parentOf,
    ),
    ...rankPeriod(
      "monthly",
      users,
      monthScore,
      (_u, score) => score > 0,
      parentOf,
    ),
    ...rankPeriod(
      "all_time",
      users,
      allTimeScore,
      (u) => u.ratedCount > 0,
      parentOf,
    ),
  ];

  // Full rebuild in a single transaction: wipe then bulk insert (chunked).
  await db.transaction(async (tx) => {
    await tx.delete(leaderboardEntry);
    for (let i = 0; i < allRows.length; i += INSERT_CHUNK) {
      await tx.insert(leaderboardEntry).values(allRows.slice(i, i + INSERT_CHUNK));
    }
  });
}

/**
 * Previous-snapshot rank per user for a (period, scope), used for movement
 * deltas. DEFENSIVE: the snapshot table may not exist yet on a given DB
 * (pre-migration), so any failure degrades to "no movement" — deltas come back
 * null — rather than 500-ing the league page. This decouples shipping the code
 * from applying the migration (no broken deploy window).
 */
async function getSnapshotRanks(
  period: Period,
  scope: string,
): Promise<Map<string, number>> {
  try {
    const rows = await db
      .select({ userId: leaderboardSnapshot.userId, rank: leaderboardSnapshot.rank })
      .from(leaderboardSnapshot)
      .where(
        and(
          eq(leaderboardSnapshot.period, period),
          eq(leaderboardSnapshot.scope, scope),
        ),
      );
    return new Map(rows.map((r) => [r.userId, r.rank]));
  } catch (e) {
    console.error("getSnapshotRanks: snapshot read failed (pre-migration?)", e);
    return new Map();
  }
}

/**
 * Read the precomputed top-100 for a (period, scope), ordered by rank ascending
 * (best ranks first), plus the viewer's own row when present and OUTSIDE the top
 * 100 (so the UI can pin
 * "you are #137"). Owner-path read of public profile columns only.
 *
 * `scope` is `'global'` or a region id (as text). `regionName` is resolved from
 * `region.id::text = scope` (null for 'global' or an unknown id).
 */
export async function readLeaderboard(
  period: Period,
  scope: string,
  viewerId?: string,
): Promise<{ rows: LeaderRow[]; viewerRow: LeaderRow | null }> {
  // region name for this scope (null for 'global').
  let regionName: string | null = null;
  if (scope !== "global") {
    const [r] = await db
      .select({ name: region.name })
      .from(region)
      .where(sql`${region.id}::text = ${scope}`)
      .limit(1);
    regionName = r?.name ?? null;
  }

  const top = await db
    .select({
      rank: leaderboardEntry.rank,
      userId: leaderboardEntry.userId,
      rating: leaderboardEntry.rating,
      score: leaderboardEntry.score,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
    })
    .from(leaderboardEntry)
    .innerJoin(profile, eq(profile.id, leaderboardEntry.userId))
    .where(
      and(
        eq(leaderboardEntry.period, period),
        eq(leaderboardEntry.scope, scope),
      ),
    )
    .orderBy(leaderboardEntry.rank)
    .limit(100);

  // Movement baseline (defensive — empty if the snapshot table isn't there yet).
  const snapRanks = await getSnapshotRanks(period, scope);

  const toRow = (e: {
    rank: number | null;
    userId: string;
    rating: number | null;
    score: number | null;
    displayName: string | null;
    avatarUrl: string | null;
  }): LeaderRow => {
    const rank = e.rank ?? 0;
    const prev = snapRanks.get(e.userId);
    return {
      rank,
      userId: e.userId,
      displayName: e.displayName ?? "Anonymous",
      avatarUrl: e.avatarUrl,
      regionName,
      rating: e.rating ?? 0,
      score: e.score ?? 0,
      isViewer: !!viewerId && e.userId === viewerId,
      delta: prev != null && rank > 0 ? prev - rank : null,
    };
  };

  const rows = top.map(toRow);

  // Viewer's own row, only if they're not already in the visible top-100.
  let viewerRow: LeaderRow | null = null;
  if (viewerId && !rows.some((r) => r.userId === viewerId)) {
    const [v] = await db
      .select({
        rank: leaderboardEntry.rank,
        userId: leaderboardEntry.userId,
        rating: leaderboardEntry.rating,
        score: leaderboardEntry.score,
        displayName: profile.displayName,
        avatarUrl: profile.avatarUrl,
      })
      .from(leaderboardEntry)
      .innerJoin(profile, eq(profile.id, leaderboardEntry.userId))
      .where(
        and(
          eq(leaderboardEntry.period, period),
          eq(leaderboardEntry.scope, scope),
          eq(leaderboardEntry.userId, viewerId),
        ),
      )
      .limit(1);
    if (v) viewerRow = toRow(v);
  }

  return { rows, viewerRow };
}
