/**
 * Read-слой vocab-страниц (каталог деков + очередь повторов). SERVER-ONLY, owner-path
 * (Drizzle). Owner-path обходит RLS, поэтому в КАЖДОМ запросе явно фильтруем
 * status='published' (деки/карты) и user_id (прогресс) — дисциплина как на
 * result-странице. Запросы параллелятся (Promise.all), без серийной лесенки.
 *
 * Карточка отдаётся целиком (word/definition/example/translation/pos/ipa) — у неё
 * нет скрытых полей: это открытый учебный контент published-дека (в отличие от
 * answer_key). Лимит новых карт и дневной счётчик берутся из access.ts (не дублируем).
 */
import "server-only";
import { and, count, desc, eq, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { profile, vocabCard, vocabDeck, vocabProgress } from "@/db/schema";
import { effectiveTier, meetsTier, type Tier } from "@/lib/tiers";
import { countNewCardsToday, newCardsRemaining } from "@/lib/vocab/access";

/** Колонки карточки для UI (общие для due- и new-выборок). Скрытых полей нет. */
const cardViewColumns = {
  id: vocabCard.id,
  word: vocabCard.word,
  definition: vocabCard.definition,
  example: vocabCard.example,
  translation: vocabCard.translation,
  partOfSpeech: vocabCard.partOfSpeech,
  ipa: vocabCard.ipa,
} as const;

export interface VocabCardView {
  id: string;
  word: string;
  definition: string;
  example: string | null;
  translation: string | null;
  partOfSpeech: string | null;
  ipa: string | null;
}

export interface VocabDeckCard {
  id: string;
  title: string;
  description: string | null;
  level: string | null;
  tierRequired: Tier;
  /** Всего карточек в деке (денормализованный vocab_deck.word_count). */
  totalCards: number;
  /** Сколько карточек пользователь уже начал (есть строка прогресса). */
  learnedCards: number;
  /** Сколько карточек к повтору прямо сейчас (due_at <= now). */
  dueCount: number;
  /** Дек недоступен по тиру пользователя (!meetsTier). */
  locked: boolean;
}

/**
 * Каталог vocab: published-деки + агрегаты прогресса пользователя (learned/due) +
 * locked-флаг по тиру. Деки, профиль и агрегат прогресса читаются параллельно;
 * агрегат мерджится в память (деки без прогресса → 0/0).
 */
export async function getVocabCatalog(userId: string): Promise<VocabDeckCard[]> {
  const now = new Date();
  const [decks, [prof], progressAgg] = await Promise.all([
    db
      .select({
        id: vocabDeck.id,
        title: vocabDeck.title,
        description: vocabDeck.description,
        level: vocabDeck.level,
        tierRequired: vocabDeck.tierRequired,
        // Денормализованный счётчик карточек (пересчитывается при (ре)импорте) —
        // не считаем vocab_card на каждый заход в каталог.
        totalCards: vocabDeck.wordCount,
      })
      .from(vocabDeck)
      .where(eq(vocabDeck.status, "published"))
      .orderBy(desc(vocabDeck.createdAt)),
    db
      .select({ tier: profile.tier, premiumUntil: profile.premiumUntil })
      .from(profile)
      .where(eq(profile.id, userId)),
    db
      .select({
        deckId: vocabCard.deckId,
        learned: sql<number>`count(*)::int`,
        due: sql<number>`(count(*) filter (where ${vocabProgress.dueAt} <= ${now}))::int`,
      })
      .from(vocabProgress)
      .innerJoin(vocabCard, eq(vocabCard.id, vocabProgress.cardId))
      // published-гейт дека явно (owner-path обходит RLS).
      .innerJoin(vocabDeck, and(eq(vocabDeck.id, vocabCard.deckId), eq(vocabDeck.status, "published")))
      .where(eq(vocabProgress.userId, userId))
      .groupBy(vocabCard.deckId),
  ]);

  const tier: Tier = prof
    ? effectiveTier({ tier: prof.tier, premium_until: prof.premiumUntil })
    : "basic";
  const byDeck = new Map(progressAgg.map((r) => [r.deckId, r]));

  return decks.map((d) => {
    const agg = byDeck.get(d.id);
    return {
      id: d.id,
      title: d.title,
      description: d.description,
      level: d.level,
      tierRequired: d.tierRequired,
      totalCards: d.totalCards,
      learnedCards: agg?.learned ?? 0,
      dueCount: agg?.due ?? 0,
      locked: !meetsTier(tier, d.tierRequired),
    };
  });
}

export interface VocabReviewQueue {
  /** Очередь: сперва due-карты (по сроку), затем добор новых (по order). */
  cards: VocabCardView[];
  /** Всего карт к повтору в деке (не ограничено limit) — для счётчика UI. */
  dueCount: number;
  /** Остаток новых карт на сегодня (null = безлимит для premium/ultra). */
  newRemainingToday: number | null;
}

const EMPTY_QUEUE: VocabReviewQueue = { cards: [], dueCount: 0, newRemainingToday: 0 };

/**
 * Очередь повторов дека: due-карты (due_at <= now, по возрастанию срока) + добор
 * новых карт (без строки прогресса, по order) в остаток очереди, но не больше
 * дневного лимита новых для basic. Дек гейтится (published + тир) один раз; при
 * отказе — пустая очередь. Лимит новых берётся из access.ts (newCardsRemaining).
 */
export async function getReviewQueue(
  userId: string,
  deckId: string,
  limit: number,
): Promise<VocabReviewQueue> {
  const now = new Date();

  // Гейт дека (published) + тир пользователя. Недоступен/не найден → пустая очередь.
  const [[deck], [prof]] = await Promise.all([
    db
      .select({ tierRequired: vocabDeck.tierRequired })
      .from(vocabDeck)
      .where(and(eq(vocabDeck.id, deckId), eq(vocabDeck.status, "published"))),
    db
      .select({ tier: profile.tier, premiumUntil: profile.premiumUntil })
      .from(profile)
      .where(eq(profile.id, userId)),
  ]);
  if (!deck || !prof) return EMPTY_QUEUE;
  const tier = effectiveTier({ tier: prof.tier, premium_until: prof.premiumUntil });
  if (!meetsTier(tier, deck.tierRequired)) return EMPTY_QUEUE;

  // due-карты (страница), полный due-count и счётчик новых за сегодня — независимы.
  const [dueCards, [dueCountRow], newTodayCount] = await Promise.all([
    db
      .select(cardViewColumns)
      .from(vocabProgress)
      .innerJoin(vocabCard, eq(vocabCard.id, vocabProgress.cardId))
      .innerJoin(vocabDeck, and(eq(vocabDeck.id, vocabCard.deckId), eq(vocabDeck.status, "published")))
      .where(
        and(
          eq(vocabProgress.userId, userId),
          eq(vocabCard.deckId, deckId),
          lte(vocabProgress.dueAt, now),
        ),
      )
      .orderBy(vocabProgress.dueAt)
      .limit(limit),
    db
      .select({ n: count() })
      .from(vocabProgress)
      .innerJoin(vocabCard, eq(vocabCard.id, vocabProgress.cardId))
      .innerJoin(vocabDeck, and(eq(vocabDeck.id, vocabCard.deckId), eq(vocabDeck.status, "published")))
      .where(
        and(
          eq(vocabProgress.userId, userId),
          eq(vocabCard.deckId, deckId),
          lte(vocabProgress.dueAt, now),
        ),
      ),
    countNewCardsToday(userId, now),
  ]);

  const dueCount = dueCountRow?.n ?? 0;
  const remaining = newCardsRemaining(tier, newTodayCount); // null = безлимит

  // Добор новых карт в остаток очереди, ограниченный дневным лимитом (для basic).
  const queueSlots = Math.max(0, limit - dueCards.length);
  const newFetch = remaining === null ? queueSlots : Math.min(queueSlots, remaining);

  let newCards: VocabCardView[] = [];
  if (newFetch > 0) {
    newCards = await db
      .select(cardViewColumns)
      .from(vocabCard)
      .innerJoin(vocabDeck, and(eq(vocabDeck.id, vocabCard.deckId), eq(vocabDeck.status, "published")))
      // Новая карта = нет строки прогресса этого пользователя (LEFT JOIN + IS NULL).
      .leftJoin(
        vocabProgress,
        and(eq(vocabProgress.cardId, vocabCard.id), eq(vocabProgress.userId, userId)),
      )
      .where(and(eq(vocabCard.deckId, deckId), isNull(vocabProgress.id)))
      .orderBy(vocabCard.order)
      .limit(newFetch);
  }

  return { cards: [...dueCards, ...newCards], dueCount, newRemainingToday: remaining };
}
