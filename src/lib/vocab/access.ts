/**
 * Vocab review access gate (тир-гейт + дневной лимит новых карт) + shared count
 * helpers. Образец — src/lib/exam/access.ts (server-only, owner-path, «только basic
 * платит count-запрос»); форма возврата — discriminated union (как canEvaluate в
 * writing/lifecycle.ts), а не redirect: reviewCardAction — точечное клиентское
 * действие, ему нужен исход {ok|reason}, а не редирект всей страницы.
 *
 * SECURITY: owner-path (Drizzle) обходит RLS, поэтому published-гейт дека и
 * user_id-фильтр прогресса стоят ЯВНО в WHERE (дисциплина как в exam/access
 * loadAccessData и на result-странице). Запись прогресса — только серверный экшен
 * (grant на INSERT/UPDATE отозван у authenticated), так что дневной лимит и SM-2
 * авторитетны на сервере, а UI-подсказки их не заменяют.
 *
 * Чистые функции (newCardsRemaining / decideNewCardCap) вынесены без IO —
 * покрываются юнит-тестами (access.test.ts).
 */
import "server-only";
import { and, count, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import { profile, vocabCard, vocabDeck, vocabProgress } from "@/db/schema";
import { effectiveTier, meetsTier, VOCAB_DAILY_NEW_LIMIT, type Tier } from "@/lib/tiers";
import type { SrsState } from "@/lib/vocab/srs";

/* -------------------------------------------------------------------------- */
/* Чистая логика дневного лимита новых карт (без IO — юнит-тестируема)          */
/* -------------------------------------------------------------------------- */

/**
 * Сколько НОВЫХ карт пользователь ещё может начать сегодня. Premium/Ultra —
 * безлимит (null). Basic — max(0, LIMIT − начато_сегодня). «Начато сегодня» = число
 * строк прогресса, созданных в текущих UTC-сутках (строка создаётся при первом
 * просмотре карты).
 */
export function newCardsRemaining(tier: Tier, newTodayCount: number): number | null {
  if (tier !== "basic") return null; // premium/ultra — без дневного лимита
  return Math.max(0, VOCAB_DAILY_NEW_LIMIT - newTodayCount);
}

export interface NewCardCapInput {
  tier: Tier;
  /** true = у карты ещё нет строки прогресса (первый просмотр). */
  isNewCard: boolean;
  /** Число новых карт, начатых сегодня (для basic). */
  newTodayCount: number;
}
export type NewCardCapDecision =
  | { ok: true; newRemainingToday: number | null }
  | { ok: false; reason: "daily_cap" };

/**
 * Решение по дневному лимиту для ОДНОГО повтора. Отказ только когда basic пытается
 * начать НОВУЮ карту при исчерпанном лимите; повтор уже виденной карты лимит не ест.
 * newRemainingToday — остаток ДО этого повтора (null = безлимит).
 */
export function decideNewCardCap(i: NewCardCapInput): NewCardCapDecision {
  const remaining = newCardsRemaining(i.tier, i.newTodayCount);
  if (remaining === null) return { ok: true, newRemainingToday: null }; // безлимит
  if (i.isNewCard && remaining <= 0) return { ok: false, reason: "daily_cap" };
  return { ok: true, newRemainingToday: remaining };
}

/* -------------------------------------------------------------------------- */
/* Shared count-хелперы (переиспользуются в queries.ts — без дублирования)      */
/* -------------------------------------------------------------------------- */

/** Начало текущих UTC-суток — граница дневного счётчика новых карт. */
export function utcDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Сколько новых карт пользователь начал сегодня (= строк прогресса с created_at в
 * текущих UTC-сутках). Owner-path; user_id-фильтр явный. Бьёт по индексу
 * (user_id, due_at) частично — здесь по (user_id) + диапазон created_at.
 */
export async function countNewCardsToday(userId: string, now: Date): Promise<number> {
  const [usage] = await db
    .select({ n: count() })
    .from(vocabProgress)
    .where(and(eq(vocabProgress.userId, userId), gte(vocabProgress.createdAt, utcDayStart(now))));
  return usage?.n ?? 0;
}

/* -------------------------------------------------------------------------- */
/* IO-гейт повтора                                                             */
/* -------------------------------------------------------------------------- */

export type VocabReviewGate =
  | {
      ok: true;
      /** Слово карты (для quiz-режима «type the answer») — уже прочитано гейтом, без доп. round-trip. */
      word: string;
      /** Текущий SM-2 стейт карты (null = новая) — экшен считает по нему, не перечитывая. */
      currentState: SrsState | null;
      /** true = у карты нет строки прогресса. */
      isNew: boolean;
      /** Остаток новых карт на сегодня ДО этого повтора (null = безлимит). */
      newRemainingToday: number | null;
    }
  | { ok: false; reason: "not_found" | "tier" | "daily_cap" };

/**
 * Гейт одного повтора карточки:
 *   (1) карта существует и её дек published        → иначе not_found
 *   (2) meetsTier(effectiveTier(profile), deck.tier) → иначе tier
 *   (3) новая карта + basic + лимит исчерпан        → иначе daily_cap
 * Возвращает текущий стейт карты, чтобы экшен не делал повторный read прогресса.
 */
export async function enforceVocabReview(
  userId: string,
  cardId: string,
): Promise<VocabReviewGate> {
  // Карта+дек (published в WHERE), профиль (тир) и строка прогресса независимы —
  // читаем одним параллельным слоем.
  const [[card], [prof], progressRows] = await Promise.all([
    db
      .select({ deckTier: vocabDeck.tierRequired, word: vocabCard.word })
      .from(vocabCard)
      .innerJoin(vocabDeck, eq(vocabDeck.id, vocabCard.deckId))
      .where(and(eq(vocabCard.id, cardId), eq(vocabDeck.status, "published"))),
    db
      .select({ tier: profile.tier, premiumUntil: profile.premiumUntil })
      .from(profile)
      .where(eq(profile.id, userId)),
    db
      .select({
        ease: vocabProgress.ease,
        intervalDays: vocabProgress.intervalDays,
        repetitions: vocabProgress.repetitions,
        lapses: vocabProgress.lapses,
      })
      .from(vocabProgress)
      .where(and(eq(vocabProgress.userId, userId), eq(vocabProgress.cardId, cardId)))
      .limit(1),
  ]);

  // (1) карта/дек не найдены (или дек draft) либо профиля нет → not_found.
  if (!card || !prof) return { ok: false, reason: "not_found" };

  const tier = effectiveTier({ tier: prof.tier, premium_until: prof.premiumUntil });

  // (2) тир-гейт (§4.8).
  if (!meetsTier(tier, card.deckTier)) return { ok: false, reason: "tier" };

  const existing = progressRows[0];
  const isNew = !existing;
  const currentState: SrsState | null = existing
    ? {
        ease: existing.ease,
        intervalDays: existing.intervalDays,
        repetitions: existing.repetitions,
        lapses: existing.lapses,
      }
    : null;

  // (3) дневной лимит — count-запрос платит ТОЛЬКО basic (premium/ultra безлимит),
  // как в exam/access.enforceAccess.
  const newTodayCount = tier === "basic" ? await countNewCardsToday(userId, new Date()) : 0;
  const decision = decideNewCardCap({ tier, isNewCard: isNew, newTodayCount });
  if (!decision.ok) return { ok: false, reason: "daily_cap" };

  return { ok: true, word: card.word, currentState, isNew, newRemainingToday: decision.newRemainingToday };
}
