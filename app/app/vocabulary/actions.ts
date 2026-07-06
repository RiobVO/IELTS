"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { vocabCard, vocabDeck, vocabProgress } from "@/db/schema";
import { getUser } from "@/lib/auth";
import { logError } from "@/lib/monitoring/log-error";
import { isUuid } from "@/lib/uuid";
import { enforceVocabReview, type VocabReviewGate } from "@/lib/vocab/access";
import { gradeForAnswer, isAnswerAccepted, isAnswerCorrect, normalizeAnswer } from "@/lib/vocab/answer";
import { reviewCard, type Grade } from "@/lib/vocab/srs";

/** Верхняя граница длины введённого ответа (cost/DoS-guard до нормализации). */
const MAX_ANSWER_LEN = 200;

/**
 * Итог two-button повтора («не знаю / знаю») для UI. dueAt — ISO-строка (server
 * action сериализует ответ через RSC-границу). newRemainingToday — остаток новых
 * карт ПОСЛЕ этого повтора (null = безлимит).
 */
export type ReviewResult =
  | { ok: true; dueAt: string; intervalDays: number; newRemainingToday: number | null }
  | { ok: false; reason: "not_found" | "tier" | "daily_cap" | "invalid" | "error" };

/**
 * Итог quiz-повтора «type the answer». Сервер — единственный судья: сверяет ввод с
 * word (owner-path в гейте), клиент балл не присылает. correctWord отдаётся в обоих
 * ok-случаях (после ответа показать эталон легально).
 */
export type AnswerResult =
  | {
      ok: true;
      correct: boolean;
      correctWord: string;
      dueAt: string;
      intervalDays: number;
      newRemainingToday: number | null;
    }
  | { ok: false; reason: "not_found" | "tier" | "daily_cap" | "invalid" | "error" };

/** ok-ветка гейта — вход общего контура записи. */
type VocabReviewGateOk = Extract<VocabReviewGate, { ok: true }>;
type AnswerFailureReason = Extract<AnswerResult, { ok: false }>["reason"];
type AnswerEvaluation =
  | { ok: true; correct: boolean; correctWord: string }
  | { ok: false; reason: AnswerFailureReason };
type AnswerEvaluator = (input: {
  cardId: string;
  typedAnswer: string;
  gate: VocabReviewGateOk;
}) => AnswerEvaluation | Promise<AnswerEvaluation>;

/**
 * Общий контур записи повтора (SM-2 + owner-path upsert + post-review остаток),
 * разделяемый two-button и quiz режимами — различие только в том, как получен grade.
 * Возвращает null при сбое записи (вызывающий → reason:"error"). НЕ экспортируется
 * (не server action). Вне соревновательного контура: rating/badges/notifications не
 * трогаются (§4.6).
 */
async function applyReview(
  userId: string,
  cardId: string,
  gate: VocabReviewGateOk,
  grade: Grade,
  now: Date,
): Promise<{ dueAt: Date; intervalDays: number; newRemainingToday: number | null } | null> {
  // Easy валиден ТОЛЬКО для новой карты (нет строки прогресса). Лапснутая карта имеет
  // repetitions=0 и по одному SM-2-стейту неотличима от новой, поэтому «новизну» берём из
  // авторитетного gate.isNew (наличие строки прогресса), а не из стейта. Не-новую карту с
  // grade="easy" тихо даунгрейдим до "good" — недельный «знал сразу» дают только новым.
  const effectiveGrade: Grade = grade === "easy" && !gate.isNew ? "good" : grade;
  const { state, dueAt } = reviewCard(gate.currentState, effectiveGrade, now);

  try {
    // Авторитетная запись SM-2 owner-path. ON CONFLICT (user_id, card_id) DO UPDATE —
    // идемпотентно (первый просмотр вставляет, повтор обновляет ту же строку).
    await db
      .insert(vocabProgress)
      .values({
        userId,
        cardId,
        ease: state.ease,
        intervalDays: state.intervalDays,
        repetitions: state.repetitions,
        lapses: state.lapses,
        dueAt,
        lastReviewedAt: now,
      })
      .onConflictDoUpdate({
        target: [vocabProgress.userId, vocabProgress.cardId],
        set: {
          ease: state.ease,
          intervalDays: state.intervalDays,
          repetitions: state.repetitions,
          lapses: state.lapses,
          dueAt,
          lastReviewedAt: now,
        },
      });
  } catch (e) {
    // Запись прогресса — не «молчаливый» best-effort: фиксируем в error_log и
    // сигналим сбой (logError сам не бросает — падение БД уходит в console).
    await logError({
      source: "server",
      message: `applyReview upsert failed: ${e instanceof Error ? e.message : String(e)}`,
      stack: e instanceof Error ? e.stack : null,
      userId,
      context: { cardId, grade },
    });
    return null;
  }

  // Остаток новых карт ПОСЛЕ повтора: новая карта у basic съедает 1; повтор и
  // безлимит (null) — без изменений. Совпадает с тем, что насчитает следующий гейт.
  const newRemainingToday =
    gate.newRemainingToday === null
      ? null
      : gate.isNew
        ? Math.max(0, gate.newRemainingToday - 1)
        : gate.newRemainingToday;

  return { dueAt, intervalDays: state.intervalDays, newRemainingToday };
}

/**
 * Two-button повтор. Трест-граница: тир-гейт, дневной лимит и SM-2 — на СЕРВЕРЕ
 * (клиент шлёт только оценку), запись — owner-path upsert (grant на INSERT/UPDATE у
 * authenticated отозван). grade типизирован как string (client-reachable) и
 * валидируется до запросов; cardId экранируется isUuid (иначе uuid-колонка → 22P02).
 */
export async function reviewCardAction(cardId: string, grade: string): Promise<ReviewResult> {
  const user = await getUser();
  if (!user) redirect("/auth");

  // Валидация входа ДО запросов.
  if (!isUuid(cardId)) return { ok: false, reason: "not_found" };
  if (grade !== "again" && grade !== "good" && grade !== "easy") return { ok: false, reason: "invalid" };
  // grade сужен до "again" | "good" | "easy" (= Grade).

  const gate = await enforceVocabReview(user.id, cardId);
  if (!gate.ok) return { ok: false, reason: gate.reason };

  const applied = await applyReview(user.id, cardId, gate, grade, new Date());
  if (!applied) return { ok: false, reason: "error" };

  return {
    ok: true,
    dueAt: applied.dueAt.toISOString(),
    intervalDays: applied.intervalDays,
    newRemainingToday: applied.newRemainingToday,
  };
}

/**
 * Общий server-graded контур quiz-ответов: одинаковая валидация, review-гейт,
 * grade mapping и SM-2 запись; различается только источник эталона в evaluator.
 */
async function answerWithServerEvaluation(
  cardId: string,
  typedAnswer: string,
  evaluate: AnswerEvaluator,
): Promise<AnswerResult> {
  const user = await getUser();
  if (!user) redirect("/auth");

  // Валидация входа ДО запросов.
  if (!isUuid(cardId)) return { ok: false, reason: "not_found" };
  if (typeof typedAnswer !== "string" || typedAnswer.length > MAX_ANSWER_LEN) {
    return { ok: false, reason: "invalid" };
  }
  if (normalizeAnswer(typedAnswer) === "") return { ok: false, reason: "invalid" };

  const gate = await enforceVocabReview(user.id, cardId);
  if (!gate.ok) return { ok: false, reason: gate.reason };

  const evaluation = await evaluate({ cardId, typedAnswer, gate });
  if (!evaluation.ok) return { ok: false, reason: evaluation.reason };

  // Server-судья: верно → "good", неверно → "again"; запись только owner-path.
  const applied = await applyReview(user.id, cardId, gate, gradeForAnswer(evaluation.correct), new Date());
  if (!applied) return { ok: false, reason: "error" };

  return {
    ok: true,
    correct: evaluation.correct,
    correctWord: evaluation.correctWord,
    dueAt: applied.dueAt.toISOString(),
    intervalDays: applied.intervalDays,
    newRemainingToday: applied.newRemainingToday,
  };
}

/**
 * Quiz-повтор «type the answer». Server-graded: сверяет нормализованный ввод с word
 * карты (owner-path в гейте), маппит верно/неверно → good/again и гонит тот же SM-2
 * upsert, что two-button (общий applyReview). Новая карта ест дневной лимит одинаково
 * в обоих режимах (общий enforceVocabReview). typedAnswer типизирован как string
 * (client-reachable) и валидируется: ≤200 и непустой после нормализации.
 */
export async function answerCardAction(
  cardId: string,
  typedAnswer: string,
): Promise<AnswerResult> {
  return answerWithServerEvaluation(cardId, typedAnswer, ({ typedAnswer, gate }) => ({
    ok: true,
    correct: isAnswerCorrect(typedAnswer, gate.word),
    correctWord: gate.word,
  }));
}

/**
 * Completion Trainer (V9). Контракт ответа идентичен answerCardAction, но эталон
 * читается отдельным owner-path запросом: accepted_answers никогда не уходит клиенту.
 * Карта без quiz_prompt считается недоступной для этого режима и маппится в not_found.
 */
export async function answerCompletionAction(
  cardId: string,
  typedAnswer: string,
): Promise<AnswerResult> {
  return answerWithServerEvaluation(cardId, typedAnswer, async ({ cardId, typedAnswer }) => {
    const [card] = await db
      .select({
        word: vocabCard.word,
        quizPrompt: vocabCard.quizPrompt,
        acceptedAnswers: vocabCard.acceptedAnswers,
      })
      .from(vocabCard)
      .innerJoin(vocabDeck, eq(vocabDeck.id, vocabCard.deckId))
      .where(and(eq(vocabCard.id, cardId), eq(vocabDeck.status, "published")))
      .limit(1);

    if (!card?.quizPrompt) return { ok: false, reason: "not_found" };

    return {
      ok: true,
      correct: isAnswerAccepted(typedAnswer, card.acceptedAnswers ?? [card.word]),
      // Эталон для reveal — ответ ПРОПУСКА, не headword: у коллокаций word — фраза
      // («conduct research»), а gap требует конкретную форму («conducted»). Первая
      // позиция accepted_answers — каноническая форма по контракту контента.
      correctWord: card.acceptedAnswers?.[0] ?? card.word,
    };
  });
}
