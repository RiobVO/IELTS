/**
 * Транзакционное ядро сдачи попытки, вынесенное из `submitAttempt`
 * (app/app/reading/[id]/actions.ts).
 *
 * ПОЧЕМУ отдельный модуль: инвариант «ровно один рейтинг/XP/бейдж/событие на
 * попытку при конкурентном двойном submit» держится single-fire claim'ом
 * (UPDATE ... WHERE status='in_progress' RETURNING) и последующим условным
 * `applyPostSubmit`. В самом `submitAttempt` этот кусок сидит за Supabase-auth
 * (getUser) + throttle + grading, поэтому db-тест не может дёрнуть его напрямую,
 * не подделывая половину действия. Вынос делает ЯДРО (claim + прогрессия)
 * server-trusted, но напрямую вызываемым из теста — грейдинг/auth/throttle/
 * навигация остаются в action. Поведение `submitAttempt` не меняется:
 * тот же порядок стейтментов (claim → snapshot → test_submit → applyPostSubmit →
 * leaderboard), те же best-effort-гарантии.
 *
 * SERVER-ONLY и НЕ `"use server"`: это не client-callable Server Action, а
 * внутренний модуль, достижимый только из server-trusted `submitAttempt`.
 * Экспорт из "use server"-файла открыл бы сетевой surface — здесь его нет.
 */
import "server-only";
import { and, eq } from "drizzle-orm";
import { after } from "next/server";
import { db } from "@/db";
import { attempt, attemptReviewSnapshot } from "@/db/schema";
import { captureServer } from "@/lib/analytics/server";
import { buildReviewSnapshot, type KeyRow } from "@/lib/exam/review-snapshot";
import { logError } from "@/lib/monitoring/log-error";
import { applyPostSubmit } from "@/lib/progress/apply-post-submit";
import { type AwardedBadge } from "@/lib/progress/badges";
import { recomputeLeaderboard } from "@/lib/progress/leaderboard";

export interface FinalizeSubmitInput {
  attemptId: string;
  userId: string;
  contentItemId: string;
  /** Режим попытки (P0): practice в рейтинг не идёт никогда. */
  mode: "practice" | "mock";
  /** Финальные ответы клиента — сервер грейдит их сам (§4.6). */
  answers: Record<string, string | string[]>;
  submittedAt: Date;
  /** Серверное (submit − start), не клиентское (§4.6 too-fast guard). */
  timeUsedSeconds: number;
  rawScore: number;
  total: number;
  /** band для Full (40Q); одиночный passage/part → null (percent only). */
  bandValue: number | null;
  perType: Record<string, { correct: number; total: number }>;
  /** Строки ключа (question ⋈ answer_key) для D3-snapshot. */
  reviewRows: KeyRow[];
}

/**
 * `claimed:false` — проигравший гонку double-submit (0 строк на claim'е): action
 * просто редиректит на результат. `claimed:true` — победитель: несёт бейджи,
 * разблокированные ЭТОЙ сдачей (для тоста на /result).
 */
export type FinalizeSubmitResult =
  | { claimed: false }
  | { claimed: true; awardedBadges: AwardedBadge[] };

export async function finalizeSubmit(
  input: FinalizeSubmitInput,
): Promise<FinalizeSubmitResult> {
  // Single-fire claim: переход in_progress → submitted одним UPDATE со status-guard
  // в WHERE. Конкурентный двойной submit обновляет 0 строк у проигравшего — ровно
  // один победитель грейдится/прогрессируется/начисляет XP.
  const updated = await db
    .update(attempt)
    .set({
      status: "submitted",
      answers: input.answers,
      submittedAt: input.submittedAt,
      timeUsedSeconds: input.timeUsedSeconds,
      rawScore: input.rawScore,
      bandScore: input.bandValue != null ? String(input.bandValue) : null,
      perTypeBreakdown: input.perType,
    })
    .where(and(eq(attempt.id, input.attemptId), eq(attempt.status, "in_progress")))
    .returning({ id: attempt.id });
  if (updated.length === 0) {
    // Проиграл гонку — другой submit уже сгрейдил эту попытку.
    return { claimed: false };
  }

  // D3: snapshot разбора на момент сдачи (server-only locked-таблица). /result
  // читает его вместо ЖИВОГО answer_key. Best-effort: провал не ломает сабмит
  // (/result деградирует на live-ключ). onConflictDoNothing — ровно один на попытку.
  try {
    await db
      .insert(attemptReviewSnapshot)
      .values({
        attemptId: input.attemptId,
        snapshot: buildReviewSnapshot(input.reviewRows),
      })
      .onConflictDoNothing();
  } catch (e) {
    await logError({
      source: "server",
      message: "finalizeSubmit: review snapshot insert failed",
      stack: e instanceof Error ? e.stack : null,
      context: {
        op: "reviewSnapshotInsert",
        attemptId: input.attemptId,
        contentItemId: input.contentItemId,
        userId: input.userId,
      },
    });
  }

  // test_submit — событие воронки (§11). Регистрируется ПОСЛЕ выигранного claim:
  // идемпотентный ре-сабмит и проигравший гонку не доходят сюда, поэтому ровно
  // одно событие на реальную сдачу. В after(): flush PostHog не блокирует сабмит.
  after(() =>
    captureServer("test_submit", input.userId, {
      content_item_id: input.contentItemId,
      raw_score: input.rawScore,
      total: input.total,
      time_used_seconds: input.timeUsedSeconds,
      mode: input.mode,
    }),
  );

  // Post-submit progression (BRIEF §4.6): streak/XP всегда, Elo на первой сданной
  // попытке. Best-effort (никогда не бросает).
  const post = await applyPostSubmit({
    userId: input.userId,
    contentItemId: input.contentItemId,
    attemptId: input.attemptId,
    mode: input.mode,
    rawScore: input.rawScore,
    total: input.total,
    timeUsedSeconds: input.timeUsedSeconds,
    submittedAt: input.submittedAt,
  });

  // Leaderboard rebuild отложен в after(): полный пересчёт на каждой rated-сдаче
  // добавил бы сотни мс к user-facing сабмиту без UI-выгоды. Ранги меняет только
  // rated (первая) попытка; провал after() наверстается следующей rated-сдачей.
  if (post.rated) {
    after(async () => {
      try {
        await recomputeLeaderboard();
      } catch (e) {
        await logError({
          source: "server",
          message: "finalizeSubmit: deferred recomputeLeaderboard failed",
          stack: e instanceof Error ? e.stack : null,
          context: {
            op: "recomputeLeaderboard",
            attemptId: input.attemptId,
            userId: input.userId,
          },
        });
      }
    });
  }

  return { claimed: true, awardedBadges: post.awardedBadges };
}
