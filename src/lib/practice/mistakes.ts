import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { attempt, attemptReviewSnapshot, contentItem, mistakeResolution } from "@/db/schema";
import type { AnswerMode } from "@/lib/grading/grade";
import {
  deriveOpenMistakes,
  type AttemptForMistakes,
  type OpenMistake,
  type SnapshotKeyQuestion,
} from "./derive-open-mistakes";

export type { OpenMistake } from "./derive-open-mistakes";

const DEFAULT_LIMIT = 50;
// Потолок сканируемой истории: деривация тянет answers+snapshot каждой попытки, без
// потолка юзер с тысячами сабмитов раздул бы каждый рендер экрана. 300 свежайших
// попыток ≫ реального объёма (23 published-теста); хвост старше — деградирует тихо.
const ATTEMPT_SCAN_CAP = 300;

/** Форма snapshot.questions в attempt_review_snapshot (D3, buildReviewSnapshot). */
interface StoredSnapshot {
  questions?: {
    number?: unknown;
    qtype?: unknown;
    mode?: unknown;
    accept?: unknown;
  }[];
}

/** Достаём из снапшота ТОЛЬКО поля для gradeOne + ярлыка (accept тут и остаётся). */
function readSnapshotQuestions(raw: unknown): SnapshotKeyQuestion[] {
  const snap = raw as StoredSnapshot | null;
  if (!snap || !Array.isArray(snap.questions)) return [];
  const out: SnapshotKeyQuestion[] = [];
  for (const q of snap.questions) {
    if (typeof q?.number !== "number") continue;
    out.push({
      number: q.number,
      qtype: typeof q.qtype === "string" ? q.qtype : "",
      mode: (q.mode as AnswerMode) ?? "exact",
      accept: Array.isArray(q.accept) ? (q.accept as string[]) : [],
    });
  }
  return out;
}

/**
 * Открытые ошибки пользователя (P9-rich «вариант B»), owner-path. Материализации НЕТ:
 * берём сданные попытки (ОБЕ mode — ошибки mock тоже ценны), их review-snapshot (D3) и
 * сохранённые ответы, прогоняем gradeOne (тот же грейдер, что submit), дедупим по
 * свежайшей попытке и вычитаем резолюции (mistake_resolution). Попытки БЕЗ снапшота
 * (legacy до миграции 0021) отсекает inner join — их разбор нестабилен, дерайвить
 * нечего; сюда попадают только попытки с зафиксированным на сдаче ключом.
 *
 * accept/explanation/evidence НЕ покидают сервер: снапшот читается owner-path (RLS
 * лочит его как answer_key), accept используется только для gradeOne, наружу уходят
 * ТОЛЬКО безопасные поля (инвариант 2). Ответы юзер смотрит через practice-reveal.
 */
export async function getOpenMistakes(
  userId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<OpenMistake[]> {
  const limit = opts.limit && opts.limit > 0 ? Math.floor(opts.limit) : DEFAULT_LIMIT;
  const offset = opts.offset && opts.offset > 0 ? Math.floor(opts.offset) : 0;

  // Сданные попытки + их снапшот + мета теста; параллельно — резолюции пользователя.
  // Inner join к снапшоту отсекает legacy; desc(submittedAt) — свежие сверху (важно
  // для дедупа в deriveOpenMistakes: он берёт первую встреченную попытку с вопросом).
  const [rows, resolutions] = await Promise.all([
    db
      .select({
        attemptId: attempt.id,
        contentItemId: attempt.contentItemId,
        submittedAt: attempt.submittedAt,
        answers: attempt.answers,
        snapshot: attemptReviewSnapshot.snapshot,
        title: contentItem.title,
        section: contentItem.section,
        // Каталожное правило роутинга (has_runner) — сам runner_html не тянем (тяжёлый).
        hasRunner: sql<boolean>`(${contentItem.runnerHtml} is not null)`,
      })
      .from(attempt)
      .innerJoin(attemptReviewSnapshot, eq(attemptReviewSnapshot.attemptId, attempt.id))
      .innerJoin(contentItem, eq(contentItem.id, attempt.contentItemId))
      .where(and(eq(attempt.userId, userId), eq(attempt.status, "submitted")))
      .orderBy(desc(attempt.submittedAt))
      .limit(ATTEMPT_SCAN_CAP),
    db
      .select({
        contentItemId: mistakeResolution.contentItemId,
        questionNumber: mistakeResolution.questionNumber,
        resolvedAt: mistakeResolution.resolvedAt,
      })
      .from(mistakeResolution)
      .where(eq(mistakeResolution.userId, userId)),
  ]);

  const attempts: AttemptForMistakes[] = rows.map((r) => ({
    attemptId: r.attemptId,
    contentItemId: r.contentItemId,
    title: r.title,
    section: r.section as string,
    hasRunner: !!r.hasRunner,
    // submittedAt на сданной попытке всегда задан; страховка на null → epoch.
    submittedAt: r.submittedAt ?? new Date(0),
    answers: (r.answers as Record<string, string | string[] | null>) ?? {},
    questions: readSnapshotQuestions(r.snapshot),
  }));

  return deriveOpenMistakes(attempts, resolutions).slice(offset, offset + limit);
}
