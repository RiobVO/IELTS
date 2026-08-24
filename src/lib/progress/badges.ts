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
import { logError } from "@/lib/monitoring/log-error";

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
  type PerTypeBreakdown,
  isMet,
  badgeProgress,
  aggregateAttemptStats,
} from "./badge-criteria";

// Чистые предикаты/типы критериев вынесены в ./badge-criteria (без IO-импортов —
// тестируются без БД/env). Реэкспорт сохраняет прежний путь импорта для
// потребителей (badges/page, content/badges).
export { isMet, badgeProgress };
export type { Criteria, UserStats, BadgeProgress } from "./badge-criteria";

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
    // Все сданные попытки юзера; contentItemId + submittedAt нужны, чтобы
    // aggregateAttemptStats схлопнул их до ПЕРВОЙ попытки каждого теста
    // (анти-фарм пересдач, см. коммент к функции в ./badge-criteria).
    db
      .select({
        contentItemId: attempt.contentItemId,
        rawScore: attempt.rawScore,
        perTypeBreakdown: attempt.perTypeBreakdown,
        submittedAt: attempt.submittedAt,
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

  const closedByQtype = new Map<string, number>();
  let closedMistakesTotal = 0;
  for (const r of closedByQtypeRows) {
    const n = Number(r.n) || 0;
    closedByQtype.set(r.qtype, n);
    closedMistakesTotal += n;
  }

  // Дедуп до первой попытки каждого теста — volume/perfect/perQtype считаются
  // только по ней (пересдачи не кормят статы). Чистая функция тестируется без БД.
  const { volume, hasPerfect, perQtype } = aggregateAttemptStats(
    attempts.map((a) => ({
      contentItemId: a.contentItemId,
      rawScore: a.rawScore,
      perTypeBreakdown: a.perTypeBreakdown as PerTypeBreakdown | null,
      submittedAt: a.submittedAt,
    })),
  );

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
    volume,
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
    await logError({
      source: "server",
      message: "evaluateBadges failed",
      stack: e instanceof Error ? e.stack : null,
      context: { op: "evaluateBadges", userId },
    });
    return [];
  }
}
