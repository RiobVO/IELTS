"use server";

import { and, count, desc, eq, gte, lt } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { answerKey, attempt, contentItem, profile, question } from "@/db/schema";
import { captureServer } from "@/lib/analytics/server";
import { getUser } from "@/lib/auth";
import { grade, type GradeKey } from "@/lib/grading/grade";
import { applyPostSubmit } from "@/lib/progress/apply-post-submit";
import { BASIC_DAILY_LIMIT, effectiveTier, meetsTier } from "@/lib/tiers";

/**
 * Resolve the user's effective tier and the test's required tier via the owner
 * db (RLS-bypassed, server-trusted), and enforce the §4.8 access gates. Returns
 * the effective tier or redirects. Shared by exam-start and submit so a crafted
 * request can't slip past the page-level (UX) redirect.
 */
async function gateAccess(userId: string, contentItemId: string): Promise<void> {
  const [prof] = await db
    .select({ tier: profile.tier, premiumUntil: profile.premiumUntil })
    .from(profile)
    .where(eq(profile.id, userId));
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

  // (b) Basic daily limit — count THIS user's submitted attempts in the current
  // UTC day. Premium/Ultra are unlimited, so only Basic pays the count query.
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
          eq(attempt.userId, userId),
          eq(attempt.status, "submitted"),
          gte(attempt.submittedAt, dayStart),
          lt(attempt.submittedAt, dayEnd),
        ),
      );
    if ((usage?.n ?? 0) >= BASIC_DAILY_LIMIT) redirect("/app/reading?limit=1");
  }
}

/**
 * Ensure an in_progress attempt exists for (user, test) and return its id + any
 * saved answers (BRIEF §4.3 autosave/resume). `started_at` is stamped SERVER-side
 * here — the single source of truth for elapsed time (§4.6 anti-cheat), never the
 * client. Idempotent: resumes the latest in_progress row instead of opening a
 * second one. Runs the access gate so a Basic/over-limit user never starts.
 */
export async function ensureAttempt(contentItemId: string): Promise<{
  attemptId: string;
  answers: Record<string, string>;
}> {
  const user = await getUser();
  if (!user) redirect("/auth");
  await gateAccess(user.id, contentItemId);

  const [existing] = await db
    .select({ id: attempt.id, answers: attempt.answers })
    .from(attempt)
    .where(
      and(
        eq(attempt.userId, user.id),
        eq(attempt.contentItemId, contentItemId),
        eq(attempt.status, "in_progress"),
      ),
    )
    .orderBy(desc(attempt.startedAt))
    .limit(1);
  if (existing) {
    return {
      attemptId: existing.id,
      answers: (existing.answers as Record<string, string>) ?? {},
    };
  }

  const [row] = await db
    .insert(attempt)
    .values({
      userId: user.id,
      contentItemId,
      mode: "practice",
      status: "in_progress",
      answers: {},
      startedAt: new Date(), // SERVER time — authoritative for §4.6 timing
    })
    .returning({ id: attempt.id });

  // test_start — событие воронки (§11). Только на ВНОВЬ открытой попытке (resume
  // выше уже вернулся), иначе метрика «стартов» раздулась бы на каждый перезаход.
  const [meta] = await db
    .select({
      section: contentItem.section,
      category: contentItem.category,
      tierRequired: contentItem.tierRequired,
    })
    .from(contentItem)
    .where(eq(contentItem.id, contentItemId));
  await captureServer("test_start", user.id, {
    content_item_id: contentItemId,
    section: meta?.section ?? "",
    category: meta?.category ?? "",
    tier_required: meta?.tierRequired ?? "",
    mode: "practice",
  });

  return { attemptId: row!.id, answers: {} };
}

/**
 * Persist in-progress answers (autosave, §4.3). Owner-checked, only while the
 * attempt is still in_progress. Best-effort — never throws to the client (a
 * failed autosave must not break the exam, the next tick retries).
 */
export async function saveProgress(
  attemptId: string,
  answers: Record<string, string | string[]>,
): Promise<void> {
  try {
    const user = await getUser();
    if (!user) return;
    await db
      .update(attempt)
      .set({ answers })
      .where(
        and(
          eq(attempt.id, attemptId),
          eq(attempt.userId, user.id),
          eq(attempt.status, "in_progress"),
        ),
      );
  } catch (e) {
    console.error("saveProgress failed", e);
  }
}

/**
 * Submit an in_progress attempt. Grading is server-only (BRIEF §4.6 anti-cheat):
 * the client sends just its final answers; the server reads the answer key (owner
 * role, bypasses RLS), scores, and computes elapsed time from the server-stamped
 * `started_at` (NOT a client duration). Idempotent: a re-submit of an
 * already-submitted attempt just goes to the result page.
 */
export async function submitAttempt(
  attemptId: string,
  answers: Record<string, string | string[]>,
) {
  const user = await getUser();
  if (!user) redirect("/auth");

  const [att] = await db
    .select({
      contentItemId: attempt.contentItemId,
      status: attempt.status,
      startedAt: attempt.startedAt,
      mode: attempt.mode,
    })
    .from(attempt)
    .where(and(eq(attempt.id, attemptId), eq(attempt.userId, user.id)));
  if (!att) redirect("/app/reading");

  const contentItemId = att.contentItemId;

  // Idempotency (§4.6): a re-submit of an already-graded attempt never re-grades
  // or double-counts — it just returns the result.
  if (att.status === "submitted") {
    redirect(`/app/reading/${contentItemId}/result?a=${attemptId}`);
  }

  await gateAccess(user.id, contentItemId);

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

  const submittedAt = new Date();
  // SERVER-trusted elapsed: now - started_at (stamped at exam start). The client
  // never supplies the duration anymore (§4.6 — closes the "too-fast" forgery).
  const timeUsedSeconds = Math.max(
    0,
    Math.round((submittedAt.getTime() - att.startedAt.getTime()) / 1000),
  );

  // Transition in_progress -> submitted. The status guard in WHERE makes this the
  // single-fire claim: a concurrent double-submit updates 0 rows on the loser.
  // band is only meaningful for Full (40-question) tests (§11); single passage ->
  // percent only, band_score null.
  const updated = await db
    .update(attempt)
    .set({
      status: "submitted",
      answers,
      submittedAt,
      timeUsedSeconds,
      rawScore: result.rawScore,
      bandScore: null,
      perTypeBreakdown: result.perType,
    })
    .where(and(eq(attempt.id, attemptId), eq(attempt.status, "in_progress")))
    .returning({ id: attempt.id });
  if (updated.length === 0) {
    // Lost the race — another submit already graded it.
    redirect(`/app/reading/${contentItemId}/result?a=${attemptId}`);
  }

  // test_submit — событие воронки (§11). Ставится ПОСЛЕ выигранного single-fire
  // claim (updated.length > 0): идемпотентный ре-сабмит и проигравший гонку
  // редиректят выше, поэтому ровно одно событие на реальную сдачу — без накрутки.
  await captureServer("test_submit", user.id, {
    content_item_id: contentItemId,
    raw_score: result.rawScore,
    total: result.total,
    time_used_seconds: timeUsedSeconds,
    mode: att.mode,
  });

  // Post-submit progression (BRIEF §4.6): streak/XP always, Elo rating on the
  // first submitted attempt, leaderboard recompute. Best-effort (never throws),
  // so redirect() stays outside any try block.
  const post = await applyPostSubmit({
    userId: user.id,
    contentItemId,
    attemptId,
    rawScore: result.rawScore,
    total: result.total,
    submittedAt,
  });

  const unlocked = post.awardedBadges.map((b) => b.code).join(",");
  const q = unlocked ? `&unlocked=${encodeURIComponent(unlocked)}` : "";
  redirect(`/app/reading/${contentItemId}/result?a=${attemptId}${q}`);
}
