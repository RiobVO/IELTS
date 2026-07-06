/**
 * Слим-сводка vocab для дашборда /app (правый рейл): due-нагрузка + приватный
 * стрик + дневная цель. Легче getVocabOverview (нет forecast7/банка/newRemaining)
 * — дашборду нужен только один компактный модуль, не полный план. SERVER-ONLY,
 * owner-path (Drizzle обходит RLS): published-гейт и тир-фильтр стоят явно в
 * каждом запросе, как в getVocabOverview/getVocabCatalog.
 */
import "server-only";
import { and, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { profile, vocabCard, vocabDeck, vocabProgress } from "@/db/schema";
import { effectiveTier, meetsTier, VOCAB_DAILY_GOAL, type Tier } from "@/lib/tiers";
import { computeStreak } from "@/lib/vocab/streak";

/** Порядок тиров для inArray-фильтра доступных деков (basic < premium < ultra). */
const TIER_ORDER: Tier[] = ["basic", "premium", "ultra"];

export interface VocabDueSummary {
  /** Карт к повтору прямо сейчас (due_at ≤ now) по доступным декам. */
  dueToday: number;
  /** Приватный vocab-стрик (дней подряд, UTC) — вне рейтинга/current_streak. */
  streak: number;
  /** Повторов сегодня — числитель дневной цели. */
  reviewedToday: number;
  /** Дневная цель повторов (константа). */
  goal: number;
}

/**
 * Wave 1 — эффективный тир (задаёт allowedTiers). Wave 2 — due+reviewedToday
 * одним FILTER-агрегатом и distinct UTC-дни повторов (стрик, 60 дней),
 * параллельно. Границы суток строятся в SQL через now() — никаких JS-Date
 * параметров внутри raw sql`` (Date-параметр там роняет прод-клиент, prepare:false).
 */
export async function getVocabDueSummary(userId: string): Promise<VocabDueSummary> {
  const [prof] = await db
    .select({ tier: profile.tier, premiumUntil: profile.premiumUntil })
    .from(profile)
    .where(eq(profile.id, userId));
  const tier: Tier = prof
    ? effectiveTier({ tier: prof.tier, premium_until: prof.premiumUntil })
    : "basic";
  const allowedTiers = TIER_ORDER.filter((t) => meetsTier(tier, t));

  // Начало текущих UTC-суток как timestamptz — целиком в SQL (now()), без JS-Date.
  const dayStart = sql`(date_trunc('day', now() at time zone 'UTC') at time zone 'UTC')`;

  const [[agg], reviewDayRows] = await Promise.all([
    db
      .select({
        dueToday: sql<number>`(count(*) filter (where ${vocabProgress.dueAt} <= now()))::int`,
        reviewedToday: sql<number>`(count(*) filter (where ${vocabProgress.lastReviewedAt} >= ${dayStart}))::int`,
      })
      .from(vocabProgress)
      .innerJoin(vocabCard, eq(vocabCard.id, vocabProgress.cardId))
      .innerJoin(
        vocabDeck,
        and(
          eq(vocabDeck.id, vocabCard.deckId),
          eq(vocabDeck.status, "published"),
          inArray(vocabDeck.tierRequired, allowedTiers),
        ),
      )
      .where(eq(vocabProgress.userId, userId)),
    db
      .selectDistinct({
        day: sql<string>`(${vocabProgress.lastReviewedAt} at time zone 'UTC')::date::text`,
      })
      .from(vocabProgress)
      .innerJoin(vocabCard, eq(vocabCard.id, vocabProgress.cardId))
      .innerJoin(
        vocabDeck,
        and(
          eq(vocabDeck.id, vocabCard.deckId),
          eq(vocabDeck.status, "published"),
          inArray(vocabDeck.tierRequired, allowedTiers),
        ),
      )
      .where(
        and(
          eq(vocabProgress.userId, userId),
          isNotNull(vocabProgress.lastReviewedAt),
          gte(vocabProgress.lastReviewedAt, sql`now() - interval '60 days'`),
        ),
      ),
  ]);

  const streak = computeStreak(
    reviewDayRows.map((r) => r.day),
    new Date().toISOString().slice(0, 10),
  );

  return {
    dueToday: agg?.dueToday ?? 0,
    streak,
    reviewedToday: agg?.reviewedToday ?? 0,
    goal: VOCAB_DAILY_GOAL,
  };
}
