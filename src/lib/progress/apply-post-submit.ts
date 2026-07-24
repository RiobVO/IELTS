/**
 * Post-submit progression hook (BRIEF §4.6): runs once, server-side, right after
 * an attempt is inserted as `submitted`. It updates the user's streak + XP
 * (always), and — only for the FIRST submitted attempt of a given test — applies
 * the Elo rating exchange between the user and the test, then triggers a
 * leaderboard recompute.
 *
 * SERVER-ONLY. Uses the Drizzle owner client (`@/db`, bypasses RLS): it reads
 * the locked difficulty rating off `content_item` and writes `profile` rows for
 * the rating/streak — both privileged. The client never sends a score or a
 * rating (anti-cheat, §4.6); everything here is derived on the server.
 *
 * BEST-EFFORT: the entire body is wrapped so this NEVER throws. The caller
 * (submit action) calls redirect() immediately after — a progression failure
 * must not break the submit, only skip the perk.
 */
import { and, count, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { attempt, contentItem, profile } from "@/db/schema";
import { createNotifications } from "@/lib/notifications/create";
import { ELO_FLOOR, ratingDeltas } from "@/lib/rating/elo";
import { type AwardedBadge, evaluateBadges } from "./badges";
import { maybeRewardReferral } from "./referral";

export interface PostSubmitInput {
  userId: string;
  contentItemId: string;
  attemptId: string;
  rawScore: number;
  total: number;
  submittedAt: Date;
}

/** UTC calendar day (yyyy-mm-dd) of a Date — streaks are date-based, not time. */
function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** UTC yyyy-mm-dd that is exactly one day before `day`. */
function prevDay(day: string): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return utcDay(d);
}

/** Normalize a stored date (Drizzle `date` mode "string", or a Date) to yyyy-mm-dd. */
function asDayString(v: string | Date | null): string | null {
  if (v == null) return null;
  if (v instanceof Date) return utcDay(v);
  return String(v).slice(0, 10);
}

export async function applyPostSubmit(input: PostSubmitInput): Promise<{
  rated: boolean;
  ratingDelta: number;
  newRating: number;
  awardedBadges: AwardedBadge[];
}> {
  // Fallback rating used if we fail before/while loading the profile.
  let currentRating = 1000;

  try {
    // КРИТИЧЕСКАЯ прогрессия (streak/XP/rating + сложность теста) — в ОДНОЙ
    // транзакции с row-lock на профиле (SELECT ... FOR UPDATE). Без неё
    // параллельные сабмиты одного юзера теряют друг друга: read-modify-write
    // абсолютных xp/rating/streak — классический lost update. Блокировка
    // сериализует конкурентные сабмиты; XP пишем атомарным SQL-инкрементом.
    // Badges/referral/notifications — best-effort и идут ПОСЛЕ коммита (вне
    // блокировки), чтобы не удлинять критическую секцию.
    const progression = await db.transaction(async (tx) => {
      // 1) Load + LOCK the user's progression row.
      const [p] = await tx
        .select({
          rating: profile.rating,
          peakRating: profile.peakRating,
          ratedCount: profile.ratedCount,
          currentStreak: profile.currentStreak,
          longestStreak: profile.longestStreak,
          lastActivityDate: profile.lastActivityDate,
        })
        .from(profile)
        .where(eq(profile.id, input.userId))
        .limit(1)
        .for("update");
      if (!p) return null;
      currentRating = p.rating;

      // 2) STREAK — always, even for non-rated retakes.
      const today = utcDay(input.submittedAt);
      const last = asDayString(p.lastActivityDate);
      let currentStreak: number;
      if (last === today) {
        currentStreak = p.currentStreak; // already active today
      } else if (last === prevDay(today)) {
        currentStreak = p.currentStreak + 1; // consecutive day
      } else {
        currentStreak = 1; // first ever, or streak broken
      }
      const longestStreak = Math.max(p.longestStreak, currentStreak);
      const xpGain = 10 + input.rawScore;

      // 3) RATED? Only the FIRST submitted attempt of this test counts (§4.6).
      // The current attempt is already inserted as `submitted`, so a count of
      // exactly 1 means this is that first attempt; retakes (count > 1) are
      // practice-only.
      const [c] = await tx
        .select({ n: count() })
        .from(attempt)
        .where(
          and(
            eq(attempt.userId, input.userId),
            eq(attempt.contentItemId, input.contentItemId),
            eq(attempt.status, "submitted"),
          ),
        );
      const rated = (c?.n ?? 0) === 1;

      // Defaults carried into the profile write when not rated.
      let newRating = p.rating;
      let newPeak = p.peakRating;
      let ratedCount = p.ratedCount;
      let ratingDelta = 0;

      if (rated) {
        // Load + LOCK the test's difficulty row — also read-modify-write, racy
        // across different users rating the same test. Lock order is always
        // profile -> content_item, so concurrent submits can't form a deadlock.
        const [ci] = await tx
          .select({
            difficultyRating: contentItem.difficultyRating,
            difficultyCount: contentItem.difficultyCount,
          })
          .from(contentItem)
          .where(eq(contentItem.id, input.contentItemId))
          .limit(1)
          .for("update");

        const testRating = ci?.difficultyRating ?? 1000;
        const testCount = ci?.difficultyCount ?? 0;
        const performance = input.total > 0 ? input.rawScore / input.total : 0;

        const d = ratingDeltas(p.rating, testRating, performance);
        ratingDelta = d.userDelta;
        newRating = Math.max(ELO_FLOOR, p.rating + d.userDelta);
        newPeak = Math.max(p.peakRating, newRating);
        ratedCount = p.ratedCount + 1;

        const newDifficulty = Math.max(ELO_FLOOR, testRating + d.testDelta);

        // Persist the test's new difficulty (separate row from the profile).
        await tx
          .update(contentItem)
          .set({
            difficultyRating: newDifficulty,
            difficultyCount: testCount + 1,
          })
          .where(eq(contentItem.id, input.contentItemId));
      }

      // 4) Persist the profile — rating/streak absolute (safe under the lock),
      // XP via atomic SQL increment, in a SINGLE write.
      await tx
        .update(profile)
        .set({
          rating: newRating,
          peakRating: newPeak,
          ratedCount,
          xp: sql`${profile.xp} + ${xpGain}`,
          currentStreak,
          longestStreak,
          lastActivityDate: today,
        })
        .where(eq(profile.id, input.userId));

      return { rated, ratingDelta, newRating };
    });

    if (!progression) {
      console.error("applyPostSubmit: profile not found", input.userId);
      return {
        rated: false,
        ratingDelta: 0,
        newRating: currentRating,
        awardedBadges: [],
      };
    }

    // 5) Badge evaluation (BRIEF §4.7) — runs AFTER the committed progression so
    // streak and rating are current, and OUTSIDE the transaction so badge work
    // never extends the row lock. The champion badge (first_place) is evaluated
    // directly against profile ratings inside evaluateBadges, so it no longer
    // depends on the leaderboard rebuild — deferred to after the response (Next
    // after() in submitAttempt). Best-effort and never throws; also inside
    // applyPostSubmit's own try/catch. Its return is the EXACT set of badges this
    // submit unlocked (deduped via the insert's RETURNING) — carried back so the
    // result page can celebrate them once.
    const awardedBadges = await evaluateBadges(input.userId);

    // In-app уведомление о каждой разблокировке бейджа (BRIEF §11). Best-effort
    // (createNotifications не бросает) — внутри общего guard'а applyPostSubmit.
    if (awardedBadges.length > 0) {
      await createNotifications(
        awardedBadges.map((b) => ({
          userId: input.userId,
          type: "badge_unlocked" as const,
          title: `Badge unlocked: ${b.name}`,
          body: b.description,
          data: { code: b.code, icon: b.icon },
        })),
      );
    }

    // Referral reward (BRIEF §4.9 / §11): rewards the invitee's pending referral
    // exactly once, only after their first completed test. Best-effort — never
    // throws; it's also inside applyPostSubmit's own try/catch guard.
    await maybeRewardReferral(input.userId);

    return {
      rated: progression.rated,
      ratingDelta: progression.rated ? progression.ratingDelta : 0,
      newRating: progression.newRating,
      awardedBadges,
    };
  } catch (e) {
    console.error("applyPostSubmit failed", e);
    return {
      rated: false,
      ratingDelta: 0,
      newRating: currentRating,
      awardedBadges: [],
    };
  }
}
