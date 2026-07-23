/**
 * Badge evaluation engine (BRIEF §4.7 badges, §5 `badge`/`user_badge`, §11
 * `notification`). Milestone 2B.
 *
 * SERVER-ONLY. Uses the Drizzle owner client (`@/db`, bypasses RLS) because it
 * must read ALL `badge` rows and the user's `user_badge`/`profile`/`attempt`/
 * `leaderboard_entry` rows and then WRITE privileged `user_badge` +
 * `notification` rows on the user's behalf — none of which the anon (RLS) path
 * can do for the awarding flow. It never touches `answer_key`.
 *
 * Called from `applyPostSubmit` AFTER the streak/rating profile write, so streak
 * and rating are current. first_place (champion) is computed directly from
 * profile ratings here, so it does NOT depend on the leaderboard rebuild (which
 * is deferred to after() in submitAttempt).
 *
 * BEST-EFFORT: the whole body is wrapped — on ANY error it logs and returns [];
 * a notification failure never loses an award. Only badges the user has NOT yet
 * earned are processed, and inserts are `onConflictDoNothing`, so concurrent or
 * repeat submits award/notify nothing again (idempotent).
 *
 * The `badge.criteria` jsonb is a discriminated union on `type` shared verbatim
 * with the seed (Agent A) — see the SHARED CRITERIA CONTRACT in the task brief.
 */
import { and, eq, gt, lt, or } from "drizzle-orm";
import { db } from "@/db";
import {
  attempt,
  badge,
  notification,
  profile,
  userBadge,
} from "@/db/schema";

export interface AwardedBadge {
  id: string;
  code: string;
  name: string;
  description: string | null;
  icon: string | null;
}

/** The `badge.criteria` jsonb shapes (discriminated union on `type`). */
type Criteria =
  | { type: "volume"; tests: number }
  | { type: "streak"; days: number }
  | { type: "rating"; min: number }
  | { type: "perfect" }
  | {
      type: "accuracy";
      qtype: string;
      minQuestions: number;
      minPct: number;
    }
  | { type: "first_place"; scope: string; period: string };

/** Per-qtype aggregate (summed correct/total across submitted attempts). */
interface QtypeAgg {
  correct: number;
  total: number;
}

/** Everything a criteria can be evaluated against, computed once per call. */
interface UserStats {
  rating: number;
  currentStreak: number;
  volume: number;
  hasPerfect: boolean;
  perQtype: Map<string, QtypeAgg>;
  isFirstPlaceGlobalAllTime: boolean;
}

/** Shape of an attempt's stored `per_type_breakdown` jsonb. */
type PerTypeBreakdown = Record<string, { correct: number; total: number }>;

/** Does `stats` satisfy `criteria`? Unknown type => not met. */
function isMet(criteria: Criteria, stats: UserStats): boolean {
  switch (criteria.type) {
    case "volume":
      return stats.volume >= criteria.tests;
    case "streak":
      return stats.currentStreak >= criteria.days;
    case "rating":
      return stats.rating >= criteria.min;
    case "perfect":
      return stats.hasPerfect;
    case "accuracy": {
      const agg = stats.perQtype.get(criteria.qtype);
      if (!agg || agg.total <= 0) return false;
      if (agg.total < criteria.minQuestions) return false;
      return (agg.correct / agg.total) * 100 >= criteria.minPct;
    }
    case "first_place":
      // The only first_place scope/period we precompute an award for is the
      // global / all_time #1 (the "champion" badge). Any other scope/period is
      // treated as not-met (no source of truth computed here).
      return (
        criteria.scope === "global" &&
        criteria.period === "all_time" &&
        stats.isFirstPlaceGlobalAllTime
      );
    default:
      // Unknown discriminant — never award.
      return false;
  }
}

/** Compute every stat a criteria can need, once, from the owner DB path. */
async function computeStats(userId: string): Promise<UserStats> {
  const [p] = await db
    .select({
      rating: profile.rating,
      currentStreak: profile.currentStreak,
      ratedCount: profile.ratedCount,
      hidden: profile.hiddenFromLeaderboard,
    })
    .from(profile)
    .where(eq(profile.id, userId))
    .limit(1);

  const attempts = await db
    .select({
      rawScore: attempt.rawScore,
      perTypeBreakdown: attempt.perTypeBreakdown,
    })
    .from(attempt)
    .where(and(eq(attempt.userId, userId), eq(attempt.status, "submitted")));

  let hasPerfect = false;
  const perQtype = new Map<string, QtypeAgg>();

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
  };
}

/**
 * Evaluate all badges for `userId`, award any newly-earned ones (insert
 * `user_badge` + a `badge_unlocked` `notification`), and return the newly-earned
 * badges. Never throws.
 */
export async function evaluateBadges(userId: string): Promise<AwardedBadge[]> {
  try {
    const badges = await db
      .select({
        id: badge.id,
        code: badge.code,
        name: badge.name,
        description: badge.description,
        icon: badge.icon,
        criteria: badge.criteria,
      })
      .from(badge);

    if (badges.length === 0) return [];

    const earnedRows = await db
      .select({ badgeId: userBadge.badgeId })
      .from(userBadge)
      .where(eq(userBadge.userId, userId));
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
    // insert returns nothing), so the notification + return reflect exactly the
    // awards we won — never a duplicate `badge_unlocked` (notification has no
    // unique constraint to lean on).
    const inserted = await db
      .insert(userBadge)
      .values(newlyEarned.map((b) => ({ userId, badgeId: b.id })))
      .onConflictDoNothing()
      .returning({ badgeId: userBadge.badgeId });
    const insertedIds = new Set(inserted.map((r) => r.badgeId));
    const awarded = newlyEarned.filter((b) => insertedIds.has(b.id));
    if (awarded.length === 0) return [];

    // Notify per award — best-effort and isolated so a notification failure
    // doesn't lose the (already-persisted) badge award.
    for (const b of awarded) {
      try {
        await db.insert(notification).values({
          userId,
          type: "badge_unlocked",
          title: b.name,
          body: b.description,
        });
      } catch (e) {
        console.error("evaluateBadges: notification insert failed", b.code, e);
      }
    }

    return awarded;
  } catch (e) {
    console.error("evaluateBadges failed", e);
    return [];
  }
}
