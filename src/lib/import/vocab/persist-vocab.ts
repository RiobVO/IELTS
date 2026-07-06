import { eq, sql } from "drizzle-orm";
import { db } from "../../../db";
import { vocabCard, vocabDeck } from "../../../db/schema";
import { parseVocab, VocabParseError } from "./parse-vocab";
import { buildCardRows, partitionByExisting } from "./vocab-upsert";

export interface VocabImportResult {
  deckId: string;
  inserted: number;
  updated: number;
  totalCards: number;
}

/**
 * Единый chokepoint импорта колоды (переиспользуют admin-экшен, CLI и позже
 * Telegram-бот): parse → persist в одной owner-транзакции (Drizzle обходит RLS —
 * запись контента только на сервере).
 *
 * КЛЮЧЕВАЯ дивергенция от persist.ts (экзамены): АДДИТИВНЫЙ upsert, НЕ
 * delete-replace. content_item при реимпорте сносится целиком (FK cascade), но
 * тот же приём здесь снёс бы vocab_progress — SRS-историю пользователей. Поэтому:
 *   • дек апсертится по source_file_path (title/description/level/tier/updated_at);
 *     STATUS НЕ трогаем — draft остаётся draft, published остаётся published
 *     (новый дек = draft по DEFAULT БД);
 *   • карточки апсертятся по (deck_id, word); карточки, которых нет в новом файле,
 *     НЕ удаляются — осиротевшие живут, их прогресс важнее полноты синка;
 *   • word_count = ФАКТИЧЕСКИЙ count карточек дека после upsert (учитывает осиротевшие).
 */
export async function importVocabDeck(
  fileContent: string,
  sourceFilePath: string,
): Promise<VocabImportResult> {
  const path = sourceFilePath.trim();
  if (path === "") {
    // source_file_path — ключ идемпотентности (NOT NULL UNIQUE): без него апсерт бессмыслен.
    throw new VocabParseError("source file path is required (idempotency key).");
  }
  const parsed = parseVocab(fileContent);

  return db.transaction(async (tx) => {
    // 1. Upsert дека по ключу идемпотентности. status НАМЕРЕННО вне set —
    //    реимпорт не должен снимать/выставлять публикацию.
    const [deck] = await tx
      .insert(vocabDeck)
      .values({
        title: parsed.title,
        description: parsed.description,
        level: parsed.level,
        levelBand: parsed.levelBand,
        sourceFilePath: path,
        tierRequired: parsed.tierRequired,
        questionTypes: parsed.questionTypes,
      })
      .onConflictDoUpdate({
        target: vocabDeck.sourceFilePath,
        set: {
          title: sql`excluded.title`,
          description: sql`excluded.description`,
          level: sql`excluded.level`,
          levelBand: sql`excluded.level_band`,
          tierRequired: sql`excluded.tier_required`,
          questionTypes: sql`excluded.question_types`,
          updatedAt: sql`now()`,
        },
      })
      .returning({ id: vocabDeck.id });
    const deckId = deck!.id;

    // 2. Существующие слова дека (снимок ДО upsert) — база подсчёта inserted/updated.
    const existing = await tx
      .select({ word: vocabCard.word })
      .from(vocabCard)
      .where(eq(vocabCard.deckId, deckId));
    const { inserted, updated } = partitionByExisting(
      existing.map((r) => r.word),
      parsed.cards,
    );

    // 3. Аддитивный upsert карточек: контент существующих обновляем, новые вставляем.
    //    Осиротевшие (нет в новом файле) не трогаем — их vocab_progress должен выжить.
    await tx
      .insert(vocabCard)
      .values(buildCardRows(deckId, parsed.cards))
      .onConflictDoUpdate({
        target: [vocabCard.deckId, vocabCard.word],
        set: {
          order: sql`excluded."order"`,
          definition: sql`excluded.definition`,
          example: sql`excluded.example`,
          translation: sql`excluded.translation`,
          partOfSpeech: sql`excluded.part_of_speech`,
          ipa: sql`excluded.ipa`,
          synonyms: sql`excluded.synonyms`,
          collocations: sql`excluded.collocations`,
          wordFamily: sql`excluded.word_family`,
          quizPrompt: sql`excluded.quiz_prompt`,
          acceptedAnswers: sql`excluded.accepted_answers`,
        },
      });

    // 4. word_count = фактическое число карточек дека ПОСЛЕ upsert.
    const totalRows = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(vocabCard)
      .where(eq(vocabCard.deckId, deckId));
    const totalCards = totalRows[0]?.total ?? 0;
    await tx
      .update(vocabDeck)
      .set({ wordCount: totalCards, updatedAt: sql`now()` })
      .where(eq(vocabDeck.id, deckId));

    return { deckId, inserted, updated, totalCards };
  });
}
