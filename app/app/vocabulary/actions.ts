"use server";

import { redirect } from "next/navigation";
import { db } from "@/db";
import { vocabProgress } from "@/db/schema";
import { getUser } from "@/lib/auth";
import { logError } from "@/lib/monitoring/log-error";
import { isUuid } from "@/lib/uuid";
import { enforceVocabReview } from "@/lib/vocab/access";
import { reviewCard } from "@/lib/vocab/srs";

/**
 * Итог одного повтора для UI. dueAt — ISO-строка (server action сериализует ответ
 * через RSC-границу; строка однозначна и стабильна для контракта). newRemainingToday
 * — остаток новых карт ПОСЛЕ этого повтора (null = безлимит).
 */
export type ReviewResult =
  | { ok: true; dueAt: string; intervalDays: number; newRemainingToday: number | null }
  | { ok: false; reason: "not_found" | "tier" | "daily_cap" | "invalid" | "error" };

/**
 * Записать повтор карточки. Трест-граница: тир-гейт, дневной лимит и SM-2 считаются
 * НА СЕРВЕРЕ (клиент шлёт только оценку), запись — owner-path upsert (grant на
 * INSERT/UPDATE у authenticated отозван, клиентских writes нет). Вне соревновательного
 * контура: НЕ трогает rating/leaderboard/badges/Elo/notifications (§4.6).
 *
 * grade типизирован как string (client-reachable — придёт что угодно) и валидируется
 * до любых запросов; cardId экранируется isUuid, иначе uuid-колонка даст 22P02.
 */
export async function reviewCardAction(cardId: string, grade: string): Promise<ReviewResult> {
  const user = await getUser();
  if (!user) redirect("/auth");

  // Валидация входа ДО запросов.
  if (!isUuid(cardId)) return { ok: false, reason: "not_found" };
  if (grade !== "again" && grade !== "good") return { ok: false, reason: "invalid" };
  // grade сужен до "again" | "good" (= Grade) — присваивается reviewCard без каста.

  const gate = await enforceVocabReview(user.id, cardId);
  if (!gate.ok) return { ok: false, reason: gate.reason };

  const now = new Date();
  const { state, dueAt } = reviewCard(gate.currentState, grade, now);

  try {
    // Авторитетная запись SM-2 owner-path. ON CONFLICT (user_id, card_id) DO UPDATE —
    // идемпотентно (первый просмотр вставляет, повтор обновляет ту же строку).
    await db
      .insert(vocabProgress)
      .values({
        userId: user.id,
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
    // сообщаем UI отказ (logError сам не бросает — падение БД уходит в console).
    await logError({
      source: "server",
      message: `reviewCardAction upsert failed: ${e instanceof Error ? e.message : String(e)}`,
      stack: e instanceof Error ? e.stack : null,
      userId: user.id,
      context: { cardId, grade },
    });
    return { ok: false, reason: "error" };
  }

  // Остаток новых карт ПОСЛЕ повтора: новая карта у basic съедает 1; повтор и
  // безлимит (null) — без изменений. Совпадает с тем, что насчитает следующий гейт.
  const newRemainingToday =
    gate.newRemainingToday === null
      ? null
      : gate.isNew
        ? Math.max(0, gate.newRemainingToday - 1)
        : gate.newRemainingToday;

  return {
    ok: true,
    dueAt: dueAt.toISOString(),
    intervalDays: state.intervalDays,
    newRemainingToday,
  };
}
