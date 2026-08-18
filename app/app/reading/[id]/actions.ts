"use server";

import { and, desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { db } from "@/db";
import {
  annotation,
  answerKey,
  attempt,
  attemptReviewSnapshot,
  question,
} from "@/db/schema";
import { captureServer } from "@/lib/analytics/server";
import {
  countSubmitsInWindow,
  exceedsSubmitRate,
  SUBMIT_THROTTLE_MAX,
} from "@/lib/anti-cheat";
import { getUser } from "@/lib/auth";
import { enforceAccess, loadAccessData } from "@/lib/exam/access";
import { bandForScore } from "@/lib/grading/band";
import { grade, type GradeKey } from "@/lib/grading/grade";
import { buildReviewSnapshot } from "@/lib/exam/review-snapshot";
import { logError } from "@/lib/monitoring/log-error";
import { applyPostSubmit } from "@/lib/progress/apply-post-submit";
import { recomputeLeaderboard } from "@/lib/progress/leaderboard";
import { isUuid } from "@/lib/uuid";

// saveProgress тикает автосейвом раз в ~1.5с (§4.3) — офлайн-юзер за минуту простоя
// без сэмплирования дал бы сотни строк в error_log. Module-level Map(attemptId ->
// последний лог) держит минимальный интервал между записями per attempt; best-effort,
// не переживает холодный старт функции — это ок, цель лишь не залить error_log.
const SAVE_PROGRESS_LOG_INTERVAL_MS = 60_000;
// Eviction-кап: без него долгоживущий инстанс копил бы attemptId бесконечно.
// Грубый clear() при переполнении — достаточная защита от роста; редкий лишний
// лог сразу после сброса приемлем.
const SAVE_PROGRESS_LOG_MAP_MAX = 500;
const lastSaveProgressLogAt = new Map<string, number>();

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
    const now = Date.now();
    const last = lastSaveProgressLogAt.get(attemptId) ?? 0;
    if (now - last >= SAVE_PROGRESS_LOG_INTERVAL_MS) {
      if (lastSaveProgressLogAt.size > SAVE_PROGRESS_LOG_MAP_MAX) {
        lastSaveProgressLogAt.clear();
      }
      lastSaveProgressLogAt.set(attemptId, now);
      await logError({
        source: "server",
        message: "saveProgress failed",
        stack: e instanceof Error ? e.stack : null,
        context: { op: "saveProgress", attemptId },
      });
    }
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
  // Client-reachable action: a malformed attemptId must not 500 the uuid-column
  // query — bounce to the catalog instead (same as a missing attempt).
  if (!isUuid(attemptId)) redirect("/app/reading");

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
        // explanation/evidence нужны только для D3-snapshot (грейдинг их не
        // использует) — кладём их в snapshot на момент сдачи.
        explanation: answerKey.explanation,
        // RU-объяснение (L1-слой, 0050) — тот же snapshot-путь, что explanation.
        explanationRu: answerKey.explanationRu,
        evidence: answerKey.evidence,
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
  if (exceedsSubmitRate(inWindow)) redirect("/app/practice?throttled=1");

  // Access gate (§4.8, defense-in-depth) — same enforcement as exam-start, fed by
  // the batched read so submit makes a single content_item round-trip.
  if (!accessData) redirect(`/app/reading/${contentItemId}`);
  // mode=null: на сабмите действует только tier-гейт (defense-in-depth). Дневной
  // кап гейтит СТАРТЫ mock, не завершения — редирект здесь терял бы доделанную
  // попытку (iframe-раннер не автосейвит ответы).
  await enforceAccess(
    user.id,
    accessData.userTier,
    accessData.tierRequired,
    accessData.category,
    contentItemId,
    null,
  );

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
  const bandValue = bandForScore(accessData.bandScale, result.rawScore);

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

  // D3: snapshot разбора на момент сдачи (server-only locked-таблица). /result
  // читает его вместо ЖИВОГО answer_key, чтобы разбор не «плыл» при позднейшей
  // правке контента. Best-effort: провал не ломает сабмит (/result деградирует
  // на live-ключ). onConflictDoNothing — ровно один snapshot на попытку.
  try {
    await db
      .insert(attemptReviewSnapshot)
      .values({ attemptId, snapshot: buildReviewSnapshot(rows) })
      .onConflictDoNothing();
  } catch (e) {
    await logError({
      source: "server",
      message: "submitAttempt: review snapshot insert failed",
      stack: e instanceof Error ? e.stack : null,
      context: { op: "reviewSnapshotInsert", attemptId, contentItemId, userId: user.id },
    });
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
    mode: att.mode,
    rawScore: result.rawScore,
    total: result.total,
    timeUsedSeconds,
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
        await logError({
          source: "server",
          message: "submitAttempt: deferred recomputeLeaderboard failed",
          stack: e instanceof Error ? e.stack : null,
          context: { op: "recomputeLeaderboard", attemptId, userId: user.id },
        });
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
    await logError({
      source: "server",
      message: "addAnnotation failed",
      stack: e instanceof Error ? e.stack : null,
      context: { op: "addAnnotation", userId: user.id, contentItemId: input.contentItemId },
    });
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
    await logError({
      source: "server",
      message: "updateAnnotationNote failed",
      stack: e instanceof Error ? e.stack : null,
      context: { op: "updateAnnotationNote", userId: user.id, annotationId: id },
    });
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
    await logError({
      source: "server",
      message: "deleteAnnotation failed",
      stack: e instanceof Error ? e.stack : null,
      context: { op: "deleteAnnotation", userId: user.id, annotationId: id },
    });
  }
}
