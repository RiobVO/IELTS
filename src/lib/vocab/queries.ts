/**
 * Read-слой vocab-страниц (каталог деков + очередь повторов). SERVER-ONLY, owner-path
 * (Drizzle). Owner-path обходит RLS, поэтому в КАЖДОМ запросе явно фильтруем
 * status='published' (деки/карты) и user_id (прогресс) — дисциплина как на
 * result-странице. Запросы параллелятся (Promise.all), без серийной лесенки.
 *
 * Карточка отдаётся открытым учебным контентом published-дека (word/definition/
 * example/translation/pos/ipa + enrichment 0038: synonyms/collocations/wordFamily/
 * quizPrompt). Единственное скрытое поле — accepted_answers (эталон quiz-грейдинга):
 * оно НЕ входит в cardViewColumns, сверка идёт серверно (answerCardAction). Лимит
 * новых карт и дневной счётчик берутся из access.ts (не дублируем).
 */
import "server-only";
import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, lte, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { profile, vocabCard, vocabDeck, vocabProgress } from "@/db/schema";
import {
  effectiveTier,
  meetsTier,
  VOCAB_DAILY_GOAL,
  VOCAB_DAILY_NEW_LIMIT,
  VOCAB_MASTERED_INTERVAL_DAYS,
  type Tier,
} from "@/lib/tiers";
import { countNewCardsToday, newCardsRemaining } from "@/lib/vocab/access";
import { computeStreak } from "@/lib/vocab/streak";

/**
 * Колонки карточки для UI (общие для due- и new-выборок). Enrichment-поля 0038
 * (synonyms/collocations/wordFamily) + quizPrompt отдаём клиенту — это открытый
 * учебный контент. accepted_answers СЮДА НЕ включаем: грейдинг quiz-режима серверный
 * (answerCardAction сверяет ввод owner-path), клиенту эталон отдавать нельзя.
 */
const cardViewColumns = {
  id: vocabCard.id,
  word: vocabCard.word,
  definition: vocabCard.definition,
  example: vocabCard.example,
  translation: vocabCard.translation,
  partOfSpeech: vocabCard.partOfSpeech,
  ipa: vocabCard.ipa,
  synonyms: vocabCard.synonyms,
  collocations: vocabCard.collocations,
  wordFamily: vocabCard.wordFamily,
  quizPrompt: vocabCard.quizPrompt,
} as const;

const RESCUE_QUEUE_LIMIT = 10;
const RESCUE_LAPSES_MIN = 2;
const RESCUE_EASE_MAX = 1.6;

/** Единый критерий "трудной" карточки для счётчика и rescue-очереди. */
function rescueCardCondition(): SQL {
  return sql`(${vocabProgress.lapses} >= ${RESCUE_LAPSES_MIN} or ${vocabProgress.ease} <= ${RESCUE_EASE_MAX})`;
}

export interface VocabCardView {
  id: string;
  word: string;
  definition: string;
  example: string | null;
  translation: string | null;
  partOfSpeech: string | null;
  ipa: string | null;
  // Enrichment 0038 (nullable). quizPrompt прокинут заранее под B3 (quiz-режим).
  synonyms: string[] | null;
  collocations: string[] | null;
  wordFamily: string[] | null;
  quizPrompt: string | null;
  /** Нет строки прогресса пользователя (добор новых) → true. Разрешает grade "easy" в UI (C2); сервер авторитетен по gate.isNew. */
  isNew: boolean;
}

export interface VocabDeckCard {
  id: string;
  title: string;
  description: string | null;
  level: string | null;
  /** CEFR-уровень дека (0039) для секций каталога; null → секция «More decks». */
  levelBand: string | null;
  tierRequired: Tier;
  /** Всего карточек в деке (денормализованный vocab_deck.word_count). */
  totalCards: number;
  /** Сколько карточек пользователь уже начал (есть строка прогресса). */
  learnedCards: number;
  /** Сколько карточек освоено (SM-2 interval_days ≥ порога) — для mastery-состояния. */
  masteredCards: number;
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
  const [decks, [prof], progressAgg] = await Promise.all([
    db
      .select({
        id: vocabDeck.id,
        title: vocabDeck.title,
        description: vocabDeck.description,
        level: vocabDeck.level,
        levelBand: vocabDeck.levelBand,
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
        // now() БД вместо JS-Date: Date-параметр внутри raw sql`` не типизирован Drizzle,
        // и postgres-js на прод-клиенте (prepare:false) падает в Buffer.byteLength(Date).
        due: sql<number>`(count(*) filter (where ${vocabProgress.dueAt} <= now()))::int`,
        // Освоенные карты (interval_days ≥ порога) — в том же агрегате, без доп. round-trip.
        mastered: sql<number>`(count(*) filter (where ${vocabProgress.intervalDays} >= ${VOCAB_MASTERED_INTERVAL_DAYS}))::int`,
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
      levelBand: d.levelBand,
      tierRequired: d.tierRequired,
      totalCards: d.totalCards,
      learnedCards: agg?.learned ?? 0,
      masteredCards: agg?.mastered ?? 0,
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
    const newRows = await db
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
    // Добор новых карт (нет прогресса) → isNew:true: только они разрешают Easy в UI.
    newCards = newRows.map((c) => ({ ...c, isNew: true }));
  }

  // due-карты уже имеют прогресс → isNew:false; порядок очереди (due → new) сохраняем.
  const cards: VocabCardView[] = [...dueCards.map((c) => ({ ...c, isNew: false })), ...newCards];
  return { cards, dueCount, newRemainingToday: remaining };
}

export interface VocabDeckBrowseCard {
  id: string;
  word: string;
  definition: string;
  partOfSpeech: string | null;
  /** "new" — нет строки прогресса; "mastered" — interval_days ≥ порога; иначе "learning". */
  status: "new" | "learning" | "mastered";
}

export interface VocabDeckBrowse {
  deckTitle: string;
  totalCards: number;
  cards: VocabDeckBrowseCard[];
}

/**
 * Read-only список слов дека (`/app/vocabulary/[deckId]/browse`, V13) — не пишет и не
 * читает очередь повторов, только статус per-card. Published + тир гейтятся здесь же
 * (паритет с getReviewQueue: страница уже гейтит через getVocabCatalog, но каждый
 * owner-path запрос держит свой собственный гейт). Недоступен/не найден → null.
 * Статус — одним LEFT JOIN на vocab_progress текущего пользователя, без N+1: нет
 * строки → new, interval_days ≥ порога → mastered, иначе → learning. totalCards —
 * длина фактической выборки (не денормализованный word_count), чтобы список и
 * счётчик совпадали один-в-один.
 */
export async function getDeckBrowse(userId: string, deckId: string): Promise<VocabDeckBrowse | null> {
  const [[deck], [prof]] = await Promise.all([
    db
      .select({ title: vocabDeck.title, tierRequired: vocabDeck.tierRequired })
      .from(vocabDeck)
      .where(and(eq(vocabDeck.id, deckId), eq(vocabDeck.status, "published"))),
    db
      .select({ tier: profile.tier, premiumUntil: profile.premiumUntil })
      .from(profile)
      .where(eq(profile.id, userId)),
  ]);
  if (!deck || !prof) return null;
  const tier = effectiveTier({ tier: prof.tier, premium_until: prof.premiumUntil });
  if (!meetsTier(tier, deck.tierRequired)) return null;

  const rows = await db
    .select({
      id: vocabCard.id,
      word: vocabCard.word,
      definition: vocabCard.definition,
      partOfSpeech: vocabCard.partOfSpeech,
      intervalDays: vocabProgress.intervalDays,
    })
    .from(vocabCard)
    .leftJoin(
      vocabProgress,
      and(eq(vocabProgress.cardId, vocabCard.id), eq(vocabProgress.userId, userId)),
    )
    .where(eq(vocabCard.deckId, deckId))
    .orderBy(vocabCard.order);

  const cards: VocabDeckBrowseCard[] = rows.map((r) => ({
    id: r.id,
    word: r.word,
    definition: r.definition,
    partOfSpeech: r.partOfSpeech,
    status:
      r.intervalDays == null
        ? "new"
        : r.intervalDays >= VOCAB_MASTERED_INTERVAL_DAYS
          ? "mastered"
          : "learning",
  }));

  return { deckTitle: deck.title, totalCards: cards.length, cards };
}

/**
 * Rescue-очередь: уже начатые карты с провалами/низким ease по всем published-декам,
 * доступным пользователю по тиру. Новые карты не попадают в выборку, потому что
 * читаем только через vocab_progress.
 */
export async function getRescueQueue(userId: string): Promise<VocabCardView[]> {
  const [prof] = await db
    .select({ tier: profile.tier, premiumUntil: profile.premiumUntil })
    .from(profile)
    .where(eq(profile.id, userId));
  const tier: Tier = prof
    ? effectiveTier({ tier: prof.tier, premium_until: prof.premiumUntil })
    : "basic";
  const allowedTiers = TIER_ORDER.filter((t) => meetsTier(tier, t));

  const rows = await db
    .select(cardViewColumns)
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
    .where(and(eq(vocabProgress.userId, userId), rescueCardCondition()))
    .orderBy(desc(vocabProgress.lapses), asc(vocabProgress.ease))
    .limit(RESCUE_QUEUE_LIMIT);
  // Rescue — только уже начатые карты (есть прогресс) → isNew:false, Easy не предлагаем.
  return rows.map((c) => ({ ...c, isNew: false }));
}

/** Банк слов пользователя по доступным декам (mastered/learning/new + всего). */
export interface VocabBank {
  /** interval_days ≥ порога. */
  mastered: number;
  /** Есть прогресс, но interval_days < порога. */
  learning: number;
  /** Карты без строки прогресса в доступных деках (total − mastered − learning). */
  newCount: number;
  /** Всего карт в доступных деках (сумма денормализованных word_count). */
  total: number;
}

/** Дневной план vocab: нагрузка, прогноз, банк слов и приватный стрик. */
export interface VocabOverview {
  /** Карт к повтору прямо сейчас (due_at ≤ now) по доступным декам. */
  dueToday: number;
  /** Карт к повтору завтра (UTC-день +1). */
  dueTomorrow: number;
  /** Прогноз due по UTC-дням на 7 дней вперёд: [0]=сегодня (вкл. бэклог)…[6]. */
  forecast7: number[];
  /** Остаток новых карт на сегодня (null = безлимит premium/ultra). */
  newRemainingToday: number | null;
  /** Уже начатые трудные карты для rescue-сессии по доступным published-декам. */
  rescueCount: number;
  /** Банк слов по доступным декам. */
  bank: VocabBank;
  /** Детерминированная оценка длительности сессии в минутах (≥1). */
  sessionMinutes: number;
  /** Приватный vocab-стрик (дней подряд), вне рейтинга. */
  streak: number;
  /** Повторов сегодня — числитель дневной цели. */
  reviewedToday: number;
  /** Дневная цель повторов (константа). */
  goal: number;
  /** Целевой IELTS-band пользователя (0039) для бейджа «Recommended»; null = не задан. */
  targetBand: number | null;
}

/** Порядок тиров для inArray-фильтра доступных деков (basic < premium < ultra). */
const TIER_ORDER: Tier[] = ["basic", "premium", "ultra"];

/**
 * План на сегодня для /app/vocabulary: due-нагрузка, 7-дневный прогноз, банк слов и
 * приватный стрик. Считается ТОЛЬКО по published-декам, доступным пользователю по
 * тиру (как getReviewQueue) — фильтр `tier_required IN allowedTiers`. Owner-path:
 * published-гейт и user_id стоят явно в каждом запросе (Drizzle обходит RLS).
 *
 * Round-trips: wave 1 — профиль (тир задаёт allowedTiers для остальных); wave 2 —
 * агрегат прогресса (due-бакеты/mastered/learning/reviewed_today одним FILTER-набором),
 * сумма word_count доступных деков, distinct дни повторов (стрик) и счётчик новых за
 * сегодня — параллельно. Границы UTC-суток строятся в SQL через now() (без JS-Date-
 * параметра: Date в raw sql`` роняет прод-клиент на prepare:false).
 */
export async function getVocabOverview(userId: string): Promise<VocabOverview> {
  // Wave 1: эффективный тир — от него зависят allowedTiers во всех агрегатах.
  // target_band читаем здесь же (профиль уже тянется) — без отдельного round-trip:
  // нужен странице каталога для бейджа «Recommended» уровневой секции (0039).
  const [prof] = await db
    .select({ tier: profile.tier, premiumUntil: profile.premiumUntil, targetBand: profile.targetBand })
    .from(profile)
    .where(eq(profile.id, userId));
  const tier: Tier = prof
    ? effectiveTier({ tier: prof.tier, premium_until: prof.premiumUntil })
    : "basic";
  const allowedTiers = TIER_ORDER.filter((t) => meetsTier(tier, t));

  const now = new Date();
  // Начало текущих UTC-суток как timestamptz — целиком в SQL (now()), без JS-Date.
  const dayStart = sql`(date_trunc('day', now() at time zone 'UTC') at time zone 'UTC')`;
  // FILTER для окна due [день+lo, день+hi); границы — параметры-числа (не Date, безопасно).
  const dueBucket = (lo: number, hi: number) =>
    sql<number>`(count(*) filter (where ${vocabProgress.dueAt} >= ${dayStart} + make_interval(days => ${lo}) and ${vocabProgress.dueAt} < ${dayStart} + make_interval(days => ${hi})))::int`;

  // Агрегат прогресса по доступным декам — вся дневная арифметика одним запросом.
  const progressAgg = db
    .select({
      dueNow: sql<number>`(count(*) filter (where ${vocabProgress.dueAt} <= now()))::int`,
      // День 0 = бэклог + сегодня: всё, что due до конца текущих UTC-суток.
      f0: sql<number>`(count(*) filter (where ${vocabProgress.dueAt} < ${dayStart} + make_interval(days => 1)))::int`,
      f1: dueBucket(1, 2),
      f2: dueBucket(2, 3),
      f3: dueBucket(3, 4),
      f4: dueBucket(4, 5),
      f5: dueBucket(5, 6),
      f6: dueBucket(6, 7),
      mastered: sql<number>`(count(*) filter (where ${vocabProgress.intervalDays} >= ${VOCAB_MASTERED_INTERVAL_DAYS}))::int`,
      learning: sql<number>`(count(*) filter (where ${vocabProgress.intervalDays} < ${VOCAB_MASTERED_INTERVAL_DAYS}))::int`,
      reviewedToday: sql<number>`(count(*) filter (where ${vocabProgress.lastReviewedAt} >= ${dayStart}))::int`,
      rescueCount: sql<number>`(count(*) filter (where ${rescueCardCondition()}))::int`,
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
    .where(eq(vocabProgress.userId, userId));

  // Wave 2: агрегат прогресса, суммарный размер доступных деков, дни повторов (стрик,
  // 60 дней) и счётчик новых за сегодня — независимы, читаются параллельно.
  const [[agg], [totals], reviewDayRows, newTodayCount] = await Promise.all([
    progressAgg,
    db
      .select({ total: sql<number>`coalesce(sum(${vocabDeck.wordCount}), 0)::int` })
      .from(vocabDeck)
      .where(and(eq(vocabDeck.status, "published"), inArray(vocabDeck.tierRequired, allowedTiers))),
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
    countNewCardsToday(userId, now),
  ]);

  const mastered = agg?.mastered ?? 0;
  const learning = agg?.learning ?? 0;
  const total = totals?.total ?? 0;
  const bank: VocabBank = { mastered, learning, newCount: Math.max(0, total - mastered - learning), total };

  const forecast7 = [
    agg?.f0 ?? 0, agg?.f1 ?? 0, agg?.f2 ?? 0, agg?.f3 ?? 0,
    agg?.f4 ?? 0, agg?.f5 ?? 0, agg?.f6 ?? 0,
  ];
  const dueToday = agg?.dueNow ?? 0;
  const newRemainingToday = newCardsRemaining(tier, newTodayCount);

  // Оценка сессии: due-бэклог + планируемый дневной набор новых, ~30 сек/карту (≥1 мин).
  // Безлимитный тир капим VOCAB_DAILY_NEW_LIMIT — разумный дневной батч, чтобы оценка
  // не раздувалась на большом банке новых карт.
  const plannedNew = Math.min(bank.newCount, newRemainingToday ?? VOCAB_DAILY_NEW_LIMIT);
  const sessionMinutes = Math.max(1, Math.round((dueToday + plannedNew) * 0.5));

  const streak = computeStreak(reviewDayRows.map((r) => r.day), now.toISOString().slice(0, 10));

  return {
    dueToday,
    dueTomorrow: forecast7[1],
    forecast7,
    newRemainingToday,
    rescueCount: agg?.rescueCount ?? 0,
    bank,
    sessionMinutes,
    streak,
    reviewedToday: agg?.reviewedToday ?? 0,
    goal: VOCAB_DAILY_GOAL,
    // numeric приходит строкой (postgres-js) — приводим к number для bandToCefr.
    targetBand: prof?.targetBand != null ? Number(prof.targetBand) : null,
  };
}
