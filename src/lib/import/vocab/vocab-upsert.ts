/**
 * Чистые (без БД) хелперы для идемпотентного upsert-persist колоды. Вынесены из
 * persist-vocab.ts, чтобы покрыть логику юнит-тестами: сам persist тянет
 * server-only db-клиент + валидацию env, поэтому в vitest не запускается (как
 * persist.ts для экзаменов).
 */
import type { ParsedVocabCard } from "./parse-vocab";

export interface VocabCardRow {
  deckId: string;
  order: number;
  word: string;
  definition: string;
  example: string | null;
  translation: string | null;
  partOfSpeech: string | null;
  ipa: string | null;
}

/**
 * Строки для `INSERT … ON CONFLICT (deck_id, word) DO UPDATE`. Порядок из файла
 * (order) сохраняется — это позиция карточки при показе.
 */
export function buildCardRows(
  deckId: string,
  cards: readonly ParsedVocabCard[],
): VocabCardRow[] {
  return cards.map((c) => ({
    deckId,
    order: c.order,
    word: c.word,
    definition: c.definition,
    example: c.example,
    translation: c.translation,
    partOfSpeech: c.partOfSpeech,
    ipa: c.ipa,
  }));
}

/**
 * Делит карточки на «вставлено / обновлено» относительно уже существующих слов
 * дека. Сравнение ТОЧНОЕ (как UNIQUE(deck_id, word) и ON CONFLICT): "Run" и "run"
 * — разные строки, поэтому слово в другом регистре считается вставкой, а прежняя
 * карточка осиротеет (это осознанно: осиротевшие не удаляются, их SRS-прогресс
 * важнее полноты синка). Возвращает счётчики для отчёта импорта.
 */
export function partitionByExisting(
  existingWords: Iterable<string>,
  cards: readonly ParsedVocabCard[],
): { inserted: number; updated: number } {
  const existing =
    existingWords instanceof Set ? existingWords : new Set(existingWords);
  let updated = 0;
  for (const c of cards) {
    if (existing.has(c.word)) updated++;
  }
  return { inserted: cards.length - updated, updated };
}
