/**
 * Weak-type deck rail (V10, /app/vocabulary, migration 0038). Рекомендует один
 * vocab-дек, который тренирует слабейший тип вопросов пользователя — по той же
 * идее, что drill-weakest чип на /app/practice (agg per_type_breakdown submitted-
 * попыток), но упрощённо: без разбивки по секции (vocab-деки секции не знают),
 * с явным порогом достоверности, чтобы 1-2 вопроса не выдавали шумную рекомендацию.
 *
 * SERVER-ONLY, owner-path (Drizzle, bypasses RLS) — как queries.ts рядом: явный
 * status='submitted' на attempt, явный published + tier-фильтр на vocab_deck.
 * Сам выбор слабейшего типа — чистая функция без IO (./weakest-type.ts), тестируется
 * отдельно от этого модуля (без БД/env).
 */
import "server-only";
import { and, arrayContains, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { attempt, profile, vocabDeck } from "@/db/schema";
import { effectiveTier, meetsTier, type Tier } from "@/lib/tiers";
import { qtypeLabel } from "@/lib/labels";
import { computeWeakestType, type PerTypeBreakdown } from "@/lib/vocab/weakest-type";

export interface WeakTypeDeckRecommendation {
  qtype: string;
  qtypeLabel: string;
  deckId: string;
  deckTitle: string;
}

/** Порядок тиров для inArray-фильтра доступных деков (как в queries.ts). */
const TIER_ORDER: Tier[] = ["basic", "premium", "ultra"];

/**
 * Рекомендация дека под слабейший тип: считает слабейший тип по submitted-попыткам
 * пользователя, затем ищет первый (по created_at) published-дек, доступный по тиру,
 * помеченный этим типом (`vocab_deck.question_types @> [qtype]`, миграция 0038).
 * Нет статистики, порог не пройден или подходящего дека нет (контент пока не
 * протегирован) → null — rail на странице просто не рендерится.
 */
export async function getWeakTypeDeckRecommendation(
  userId: string,
): Promise<WeakTypeDeckRecommendation | null> {
  const [rows, [prof]] = await Promise.all([
    db
      .select({ perTypeBreakdown: attempt.perTypeBreakdown })
      .from(attempt)
      .where(and(eq(attempt.userId, userId), eq(attempt.status, "submitted"))),
    db
      .select({ tier: profile.tier, premiumUntil: profile.premiumUntil })
      .from(profile)
      .where(eq(profile.id, userId)),
  ]);

  const qtype = computeWeakestType(rows.map((r) => r.perTypeBreakdown as PerTypeBreakdown | null));
  if (!qtype) return null;

  const tier: Tier = prof
    ? effectiveTier({ tier: prof.tier, premium_until: prof.premiumUntil })
    : "basic";
  const allowedTiers = TIER_ORDER.filter((t) => meetsTier(tier, t));

  const [deck] = await db
    .select({ id: vocabDeck.id, title: vocabDeck.title })
    .from(vocabDeck)
    .where(
      and(
        eq(vocabDeck.status, "published"),
        inArray(vocabDeck.tierRequired, allowedTiers),
        arrayContains(vocabDeck.questionTypes, [qtype]),
      ),
    )
    .orderBy(asc(vocabDeck.createdAt))
    .limit(1);
  if (!deck) return null;

  return { qtype, qtypeLabel: qtypeLabel(qtype), deckId: deck.id, deckTitle: deck.title };
}
