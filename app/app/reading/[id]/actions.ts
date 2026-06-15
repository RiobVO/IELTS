"use server";

import { and, count, eq, gte, lt } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { answerKey, attempt, contentItem, profile, question } from "@/db/schema";
import { getUser } from "@/lib/auth";
import { grade, type GradeKey } from "@/lib/grading/grade";
import { applyPostSubmit } from "@/lib/progress/apply-post-submit";
import { BASIC_DAILY_LIMIT, effectiveTier, meetsTier } from "@/lib/tiers";

/**
 * Submit an attempt. Grading is server-only (BRIEF §4.6 anti-cheat): the client
 * sends just its answers; the server reads the answer key (owner role, bypasses
 * RLS), scores, and persists. No score ever comes from the client.
 */
export async function submitAttempt(
  contentItemId: string,
  answers: Record<string, string | string[]>,
  timeUsedSeconds: number,
) {
  const user = await getUser();
  if (!user) redirect("/auth");

  // Access gates run on the owner db (server-trusted, RLS bypassed) BEFORE any
  // grading/persisting — the page-level redirect is UX only; this is the
  // authoritative check a crafted POST can't skip (BRIEF §4.6 / §4.8).
  const [prof] = await db
    .select({ tier: profile.tier, premiumUntil: profile.premiumUntil })
    .from(profile)
    .where(eq(profile.id, user.id));
  const [item] = await db
    .select({ tierRequired: contentItem.tierRequired })
    .from(contentItem)
    .where(eq(contentItem.id, contentItemId));
  if (!prof || !item) redirect(`/app/reading/${contentItemId}`);

  const userTier = effectiveTier({
    tier: prof.tier,
    premium_until: prof.premiumUntil,
  });

  // (a) Tier gate — re-check entitlement against the test's required tier.
  if (!meetsTier(userTier, item.tierRequired)) redirect("/app/upgrade");

  // (b) Basic daily limit — count THIS user's submitted attempts whose
  // submitted_at falls in the current UTC day; block once the cap is reached.
  // Premium/Ultra are unlimited, so only Basic pays the count query.
  if (userTier === "basic") {
    const now = new Date();
    const dayStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const [usage] = await db
      .select({ n: count() })
      .from(attempt)
      .where(
        and(
          eq(attempt.userId, user.id),
          eq(attempt.status, "submitted"),
          gte(attempt.submittedAt, dayStart),
          lt(attempt.submittedAt, dayEnd),
        ),
      );
    if ((usage?.n ?? 0) >= BASIC_DAILY_LIMIT) redirect("/app/reading?limit=1");
  }

  const rows = await db
    .select({
      number: question.number,
      qtype: question.qtype,
      mode: answerKey.mode,
      accept: answerKey.accept,
    })
    .from(question)
    .innerJoin(answerKey, eq(answerKey.questionId, question.id))
    .where(eq(question.contentItemId, contentItemId));

  if (rows.length === 0) redirect(`/app/reading/${contentItemId}`);

  const keys: GradeKey[] = rows.map((r) => ({
    number: r.number,
    qtype: r.qtype,
    mode: r.mode,
    accept: (r.accept as string[]) ?? [],
  }));

  const result = grade(keys, answers);

  // One timestamp for the row and the streak/day calc (avoid a midnight-boundary
  // mismatch). NOTE: started_at is still derived from the client-supplied
  // duration — server-trusted timing lands with the autosave/resume milestone
  // (an in_progress row stamped server-side at exam start); see §4.6.
  const submittedAt = new Date();

  // band is only meaningful for Full (40-question) tests (BRIEF §11); single
  // passage/part -> percent only, band_score null.
  const [row] = await db
    .insert(attempt)
    .values({
      userId: user.id,
      contentItemId,
      mode: "practice",
      status: "submitted",
      answers,
      startedAt: new Date(submittedAt.getTime() - timeUsedSeconds * 1000),
      submittedAt,
      timeUsedSeconds,
      rawScore: result.rawScore,
      bandScore: null,
      perTypeBreakdown: result.perType,
    })
    .returning({ id: attempt.id });

  // Post-submit progression (BRIEF §4.6): streak/XP always, Elo rating on the
  // first submitted attempt, leaderboard recompute. Best-effort — applyPostSubmit
  // never throws, so no try/catch, and redirect() stays outside any try block.
  const post = await applyPostSubmit({
    userId: user.id,
    contentItemId,
    attemptId: row!.id,
    rawScore: result.rawScore,
    total: result.total,
    submittedAt,
  });

  // Carry the exact badge codes this submit unlocked to the result page, so it
  // celebrates them once — no timestamp inference, no cross-attempt misattribution.
  const unlocked = post.awardedBadges.map((b) => b.code).join(",");
  const q = unlocked ? `&unlocked=${encodeURIComponent(unlocked)}` : "";
  redirect(`/app/reading/${contentItemId}/result?a=${row!.id}${q}`);
}
