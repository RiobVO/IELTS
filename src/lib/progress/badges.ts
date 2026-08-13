/**
 * Badge evaluation engine (BRIEF §4.7 badges, §5 `badge`/`user_badge`, §11
 * `notification`). Milestone 2B.
 *
 * SERVER-ONLY. Uses the Drizzle owner client (`@/db`, bypasses RLS) because it
 * must read ALL `badge` rows and the user's `user_badge`/`profile`/`attempt`/
 * `leaderboard_entry` rows and then WRITE privileged `user_badge` rows on the
 * user's behalf — none of which the anon (RLS) path can do for the awarding
 * flow. It never touches `answer_key`. The `badge_unlocked` notification is
 * written by the caller (`applyPostSubmit`) from the returned set, not here, so
 * a badge unlocks exactly one notification.
 *
 * Called from `applyPostSubmit` AFTER the streak/rating profile write, so streak
 * and rating are current. first_place (champion) is computed directly from
 * profile ratings here, so it does NOT depend on the leaderboard rebuild (which
 * is deferred to after() in submitAttempt).
 *
 * BEST-EFFORT: the whole body is wrapped — on ANY error it logs and returns [].
 * Only badges the user has NOT yet earned are processed, and inserts are
 * `onConflictDoNothing`, so concurrent or repeat submits award nothing again
 * (idempotent).
 *
 * The `badge.criteria` jsonb is a discriminated union on `type` shared verbatim
 * with the seed (Agent A) — see the SHARED CRITERIA CONTRACT in the task brief.
 */
import { and, eq, gt, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { attempt, badge, mistakeResolution, profile, userBadge } from "@/db/schema";

export interface AwardedBadge {
  id: string;
  code: string;
  name: string;
  description: string | null;
  icon: string | null;
}

import {
  type Criteria,
  type UserStats,
  type QtypeAgg,
  isMet,
  badgeProgress,
} from "./badge-criteria";

// Чистые предикаты/типы критериев вынесены в ./badge-criteria (без IO-импортов —
// тестируются без БД/env). Реэкспорт сохраняет прежний путь импорта для
// потребителей (badges/page, content/badges).
export { isMet, badgeProgress };
export type { Criteria, UserStats, BadgeProgress } from "./badge-criteria";

/** Shape of an attempt's stored `per_type_breakdown` jsonb. */
type PerTypeBreakdown = Record<string, { correct: number; total: number }>;

/** Compute every stat a criteria can need, once, from the owner DB path. */
export async function computeStats(userId: string): Promise<UserStats> {
  // profile, attempts и closedByQtypeRows независимы — один round-trip вместо
  // трёх последовательных (горячий путь). first_place ниже зависит от p,
  // поэтому остаётся последовательным после.
  const [[p], attempts, closedByQtypeRows] = await Promise.all([
    db
      .select({
        rating: profile.rating,
        currentStreak: profile.currentStreak,
        ratedCount: profile.ratedCount,
        hidden: profile.hiddenFromLeaderboard,
      })
      .from(profile)
      .where(eq(profile.id, userId))
      .limit(1),
    db
      .select({
        rawScore: attempt.rawScore,
        perTypeBreakdown: attempt.perTypeBreakdown,
      })
      .from(attempt)
      .where(and(eq(attempt.userId, userId), eq(attempt.status, "submitted"))),
    // W2-5 study-loop badges (mistakes_closed / weak_type_cleared): резолюции
    // ошибок по qtype, из которых считаются total и per-qtype максимум.
    db
      .select({
        qtype: mistakeResolution.qtype,
        n: sql<number>`count(*)::int`,
      })
      .from(mistakeResolution)
      .where(eq(mistakeResolution.userId, userId))
      .groupBy(mistakeResolution.qtype),
  ]);

  let hasPerfect = false;
  const perQtype = new Map<string, QtypeAgg>();
  const closedByQtype = new Map<string, number>();
  let closedMistakesTotal = 0;
  for (const r of closedByQtypeRows) {
    const n = Number(r.n) || 0;
    closedByQtype.set(r.qtype, n);
    closedMistakesTotal += n;
  }

  for (const a of attempts) {
    const breakdown = (a.perTypeBreakdown as PerTypeBreakdown | null) ?? {};

    // Attempt total = sum of all qtype totals in its breakdown.
    let attemptTotal = 0;
    for (const v of Object.values(breakdown)) {
      attemptTotal += Number(v?.total) || 0;
    }

    // 100%: rawScore equals the attempt's total question count (>0 to exclude
    // a degenerate empty/zero-question attempt counting as perfect).
    if (
      attemptTotal > 0 &&
      a.rawScore != null &&
      Number(a.rawScore) === attemptTotal
    ) {
      hasPerfect = true;
    }

    // Per-qtype running sums across all submitted attempts.
    for (const [qtype, v] of Object.entries(breakdown)) {
      const agg = perQtype.get(qtype) ?? { correct: 0, total: 0 };
      agg.correct += Number(v?.correct) || 0;
      agg.total += Number(v?.total) || 0;
      perQtype.set(qtype, agg);
    }
  }

  // first_place (champion): am I rank 1 of the global all_time board? Computed
  // directly from profile ratings — NOT from leaderboard_entry — so the badge
  // stays correct now that the leaderboard rebuild is deferred to after() (see
  // submitAttempt). Mirrors recomputeLeaderboard's all_time ranking exactly:
  // eligible = visible (not hidden) AND ratedCount > 0; order = rating DESC, then
  // id ASC. I'm #1 iff no eligible peer outranks me (higher rating, or equal
  // rating with a smaller id).
  let isFirstPlaceGlobalAllTime = false;
  if (p && !p.hidden && p.ratedCount > 0) {
    const [higher] = await db
      .select({ id: profile.id })
      .from(profile)
      .where(
        and(
          eq(profile.hiddenFromLeaderboard, false),
          gt(profile.ratedCount, 0),
          or(
            gt(profile.rating, p.rating),
            and(eq(profile.rating, p.rating), lt(profile.id, userId)),
          ),
        ),
      )
      .limit(1);
    isFirstPlaceGlobalAllTime = !higher;
  }

  return {
    rating: p?.rating ?? 0,
    currentStreak: p?.currentStreak ?? 0,
    volume: attempts.length,
    hasPerfect,
    perQtype,
    isFirstPlaceGlobalAllTime,
    closedMistakesTotal,
    closedByQtype,
  };
}

/**
 * Evaluate all badges for `userId`, award any newly-earned ones (insert
 * `user_badge`), and return the newly-earned badges. The `badge_unlocked`
 * notification is emitted by the caller from this return — see `applyPostSubmit`.
 * Never throws.
 */
export async function evaluateBadges(userId: string): Promise<AwardedBadge[]> {
  try {
    // badge (все строки) и userBadge (заработанные юзером) независимы — один
    // round-trip вместо двух последовательных в горячем submit-пути.
    const [badges, earnedRows] = await Promise.all([
      db
        .select({
          id: badge.id,
          code: badge.code,
          name: badge.name,
          description: badge.description,
          icon: badge.icon,
          criteria: badge.criteria,
        })
        .from(badge),
      db
        .select({ badgeId: userBadge.badgeId })
        .from(userBadge)
        .where(eq(userBadge.userId, userId)),
    ]);

    if (badges.length === 0) return [];

    const earned = new Set(earnedRows.map((r) => r.badgeId));

    // Only bother computing stats if there is at least one un-earned badge.
    const candidates = badges.filter((b) => !earned.has(b.id));
    if (candidates.length === 0) return [];

    const stats = await computeStats(userId);

    const newlyEarned: AwardedBadge[] = [];
    for (const b of candidates) {
      const criteria = b.criteria as Criteria | null;
      if (!criteria || typeof criteria.type !== "string") continue;
      if (!isMet(criteria, stats)) continue;
      newlyEarned.push({
        id: b.id,
        code: b.code,
        name: b.name,
        description: b.description,
        icon: b.icon,
      });
    }

    if (newlyEarned.length === 0) return [];

    // Award: insert user_badge rows; onConflictDoNothing guards the composite
    // PK against concurrent/duplicate submits double-inserting. `.returning()`
    // yields ONLY the rows actually inserted by THIS call (a losing concurrent
    // insert returns nothing), so the return reflects exactly the awards we won.
    // The caller turns this set into one `badge_unlocked` notification per badge
    // (notification has no unique constraint to lean on), so emitting it there —
    // not here — keeps awards at exactly one notification each.
    const inserted = await db
      .insert(userBadge)
      .values(newlyEarned.map((b) => ({ userId, badgeId: b.id })))
      .onConflictDoNothing()
      .returning({ badgeId: userBadge.badgeId });
    const insertedIds = new Set(inserted.map((r) => r.badgeId));
    const awarded = newlyEarned.filter((b) => insertedIds.has(b.id));

    return awarded;
  } catch (e) {
    console.error("evaluateBadges failed", e);
    return [];
  }
}
