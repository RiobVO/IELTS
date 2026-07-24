"use server";

import { and, count, desc, eq, gte, lt, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { db } from "@/db";
import { annotation, answerKey, attempt, contentItem, profile, question } from "@/db/schema";
import { captureServer } from "@/lib/analytics/server";
import {
  countSubmitsInWindow,
  exceedsSubmitRate,
  SUBMIT_THROTTLE_MAX,
} from "@/lib/anti-cheat";
import { getUser } from "@/lib/auth";
import { grade, type GradeKey } from "@/lib/grading/grade";
import { applyPostSubmit } from "@/lib/progress/apply-post-submit";
import { recomputeLeaderboard } from "@/lib/progress/leaderboard";
import { BASIC_DAILY_LIMIT, effectiveTier, meetsTier, type Tier } from "@/lib/tiers";

/**
 * Resolve the user's effective tier and the test's required tier via the owner
 * db (RLS-bypassed, server-trusted), and enforce the §4.8 access gates. Returns
 * the effective tier or redirects. Shared by exam-start and submit so a crafted
 * request can't slip past the page-level (UX) redirect.
 */
/**
 * Read the access facts for (user, test) via the owner db: the user's effective
 * tier, the test's required tier, and the band scale (the last is submit-only but
 * read here so submit needs a SINGLE content_item round-trip, not two). Returns
 * null if either row is missing. No redirects — separated from enforcement so the
 * reads can be batched with submit's other independent queries.
 */
async function loadAccessData(
  userId: string,
  contentItemId: string,
): Promise<{
  userTier: Tier;
  tierRequired: Tier;
  bandScale: Record<string, number> | null;
} | null> {
  const [[prof], [item]] = await Promise.all([
    db
      .select({ tier: profile.tier, premiumUntil: profile.premiumUntil })
      .from(profile)
      .where(eq(profile.id, userId)),
    db
      .select({
        tierRequired: contentItem.tierRequired,
        bandScale: contentItem.bandScale,
      })
      .from(contentItem)
      .where(eq(contentItem.id, contentItemId)),
  ]);
  if (!prof || !item) return null;
  return {
    userTier: effectiveTier({ tier: prof.tier, premium_until: prof.premiumUntil }),
    tierRequired: item.tierRequired,
    bandScale: (item.bandScale as Record<string, number> | null) ?? null,
  };
}

/**
 * Enforce the §4.8 access gates (tier entitlement + Basic daily limit) for an
 * already-resolved effective tier. Redirects on denial. The single source of
 * truth for the gate logic, shared by exam-start and submit so a crafted submit
 * can't slip past — only the reads that feed it are batched by the caller.
 */
async function enforceAccess(
  userId: string,
  userTier: Tier,
  tierRequired: Tier,
): Promise<void> {
  // (a) Tier gate — re-check entitlement against the test's required tier.
  if (!meetsTier(userTier, tierRequired)) redirect("/app/upgrade");

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
 * Resolve + enforce access in one call (exam-start path). Submit inlines the two
 * steps so the load can be batched with its other queries.
 */
async function gateAccess(userId: string, contentItemId: string): Promise<void> {
  const data = await loadAccessData(userId, contentItemId);
  if (!data) redirect(`/app/reading/${contentItemId}`);
  await enforceAccess(userId, data.userTier, data.tierRequired);
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
  answers: Record<string, string | string[]>;
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
      answers: (existing.answers as Record<string, string | string[]>) ?? {},
    };
  }

  const inserted = await db
    .insert(attempt)
    .values({
      userId: user.id,
      contentItemId,
      mode: "practice",
      status: "in_progress",
      answers: {},
      startedAt: new Date(), // SERVER time — authoritative for §4.6 timing
    })
    // 0007 partial unique index: at most one in_progress attempt per (user, test).
    // The loser of a concurrent first-start inserts nothing (resumed below).
    .onConflictDoNothing({
      target: [attempt.userId, attempt.contentItemId],
      where: sql`${attempt.status} = 'in_progress'`,
    })
    .returning({ id: attempt.id });

  // Lost the race: another call created the in_progress row first — resume IT,
  // don't open a second one and don't double-fire test_start.
  if (inserted.length === 0) {
    const [winner] = await db
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
    if (winner) {
      return {
        attemptId: winner.id,
        answers: (winner.answers as Record<string, string | string[]>) ?? {},
      };
    }
    // Vanishingly rare: the winner's row was submitted between the conflict and
    // this read, so no in_progress row exists now. Re-enter the page so the next
    // ensureAttempt opens a fresh attempt cleanly.
    redirect(`/app/reading/${contentItemId}`);
  }

  // We created the attempt -> test_start (§11), exactly once per real start. Both
  // the meta lookup (needed ONLY for the event props) and the PostHog flush are
  // deferred to after() so they never block the user-facing start — capture is
  // best-effort telemetry, not part of the response (same pattern as the deferred
  // recomputeLeaderboard). distinctId stays server-authoritative (user.id).
  after(async () => {
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
  });

  return { attemptId: inserted[0]!.id, answers: {} };
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

  // Independent read-only lookups for the submit gate + grading run in ONE batch
  // (each depends only on user.id / contentItemId, already known): the throttle
  // window, the access facts (effective tier + required tier + band scale, a
  // single content_item round-trip), and the answer key. The redirect checks
  // below keep their ORIGINAL order (throttle -> tier -> daily limit -> empty
  // key), so behaviour is unchanged — only the round-trips are batched instead of
  // sequential. Throttle uses the (user_id, submitted_at) index, capped at MAX+1.
  const [recentSubmits, accessData, rows] = await Promise.all([
    db
      .select({ submittedAt: attempt.submittedAt })
      .from(attempt)
      .where(and(eq(attempt.userId, user.id), eq(attempt.status, "submitted")))
      .orderBy(desc(attempt.submittedAt))
      .limit(SUBMIT_THROTTLE_MAX + 1),
    loadAccessData(user.id, contentItemId),
    db
      .select({
        number: question.number,
        qtype: question.qtype,
        mode: answerKey.mode,
        accept: answerKey.accept,
      })
      .from(question)
      .innerJoin(answerKey, eq(answerKey.questionId, question.id))
      .where(eq(question.contentItemId, contentItemId)),
  ]);

  // Частотный анти-чит throttle (§4.6) — проверка в исходном порядке (до гейта).
  // Идемпотентный ре-сабмит отфильтрован выше; превышение -> мягкий отказ, попытка
  // остаётся in_progress (ответы автосохранены, можно повторить через пару секунд).
  const inWindow = countSubmitsInWindow(
    recentSubmits.map((r) => r.submittedAt),
    new Date(),
  );
  if (exceedsSubmitRate(inWindow)) redirect("/app/reading?throttled=1");

  // Access gate (§4.8, defense-in-depth) — same enforcement as exam-start, fed by
  // the batched read so submit makes a single content_item round-trip.
  if (!accessData) redirect(`/app/reading/${contentItemId}`);
  await enforceAccess(user.id, accessData.userTier, accessData.tierRequired);

  if (rows.length === 0) redirect(`/app/reading/${contentItemId}`);

  const keys: GradeKey[] = rows.map((r) => ({
    number: r.number,
    qtype: r.qtype,
    mode: r.mode,
    accept: (r.accept as string[]) ?? [],
  }));
  const result = grade(keys, answers);

  // Band only for Full tests (40Q): map raw score via the stored band_scale (§11),
  // already read above. Single passage/part has no band_scale -> null (percent only).
  const scale = accessData.bandScale;
  const bandValue = scale ? (scale[String(result.rawScore)] ?? null) : null;

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
      bandScore: bandValue != null ? String(bandValue) : null,
      perTypeBreakdown: result.perType,
    })
    .where(and(eq(attempt.id, attemptId), eq(attempt.status, "in_progress")))
    .returning({ id: attempt.id });
  if (updated.length === 0) {
    // Lost the race — another submit already graded it.
    redirect(`/app/reading/${contentItemId}/result?a=${attemptId}`);
  }

  // test_submit — событие воронки (§11). Регистрируется ПОСЛЕ выигранного single-fire
  // claim (updated.length > 0): идемпотентный ре-сабмит и проигравший гонку
  // редиректят выше, поэтому ровно одно событие на реальную сдачу — без накрутки.
  // В after() (как leaderboard): flush PostHog (до 2с) не блокирует сабмит.
  after(() =>
    captureServer("test_submit", user.id, {
      content_item_id: contentItemId,
      raw_score: result.rawScore,
      total: result.total,
      time_used_seconds: timeUsedSeconds,
      mode: att.mode,
    }),
  );

  // Post-submit progression (BRIEF §4.6): streak/XP always, Elo rating on the
  // first submitted attempt. Best-effort (never throws), so redirect() stays
  // outside any try block.
  const post = await applyPostSubmit({
    userId: user.id,
    contentItemId,
    attemptId,
    rawScore: result.rawScore,
    total: result.total,
    submittedAt,
  });

  // Leaderboard rebuild is deferred to AFTER the response (Next after()): a full
  // recompute on every rated submit adds hundreds of ms to the user-facing submit
  // for no UI benefit. Only a rated (first) attempt changes ranks. after() runs
  // post-response; if it fails the board simply catches up on the next rated
  // submit. The champion badge is evaluated synchronously (profile ratings), so
  // it does NOT depend on this deferred rebuild.
  if (post.rated) {
    after(async () => {
      try {
        await recomputeLeaderboard();
      } catch (e) {
        console.error("submitAttempt: deferred recomputeLeaderboard failed", e);
      }
    });
  }

  const unlocked = post.awardedBadges.map((b) => b.code).join(",");
  const q = unlocked ? `&unlocked=${encodeURIComponent(unlocked)}` : "";
  redirect(`/app/reading/${contentItemId}/result?a=${attemptId}${q}`);
}

/* -------------------------------------------------------------------------- */
/* Reader annotations (W2-1 / REDESIGN S6).                                    */
/* Owner-path writes, owner-checked (mirrors saveProgress): the client cannot  */
/* write the annotation table directly (no authenticated grant), so these are  */
/* the only write path. Best-effort — a failed annotation never breaks the     */
/* exam. They touch ONLY the user's own annotation rows; grading/submit/attempt */
/* are not affected.                                                           */
/* -------------------------------------------------------------------------- */

export async function addAnnotation(input: {
  contentItemId: string;
  passageOrder: number;
  kind: "highlight" | "note";
  start: number;
  end: number;
  quote: string;
  note?: string | null;
}): Promise<{ id: string } | null> {
  const user = await getUser();
  if (!user) return null;
  if (!(input.end > input.start)) return null;
  try {
    const [row] = await db
      .insert(annotation)
      .values({
        userId: user.id,
        contentItemId: input.contentItemId,
        passageOrder: input.passageOrder,
        kind: input.kind === "note" ? "note" : "highlight",
        startOffset: input.start,
        endOffset: input.end,
        quote: input.quote.slice(0, 2000),
        note: input.note ? input.note.slice(0, 4000) : null,
      })
      .returning({ id: annotation.id });
    return row ? { id: row.id } : null;
  } catch (e) {
    console.error("addAnnotation failed", e);
    return null;
  }
}

export async function updateAnnotationNote(id: string, note: string): Promise<void> {
  const user = await getUser();
  if (!user) return;
  try {
    await db
      .update(annotation)
      .set({ note: note.slice(0, 4000) || null, kind: note.trim() ? "note" : "highlight" })
      .where(and(eq(annotation.id, id), eq(annotation.userId, user.id)));
  } catch (e) {
    console.error("updateAnnotationNote failed", e);
  }
}

export async function deleteAnnotation(id: string): Promise<void> {
  const user = await getUser();
  if (!user) return;
  try {
    await db
      .delete(annotation)
      .where(and(eq(annotation.id, id), eq(annotation.userId, user.id)));
  } catch (e) {
    console.error("deleteAnnotation failed", e);
  }
}
