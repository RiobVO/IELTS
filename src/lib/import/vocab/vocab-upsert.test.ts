// Тесты чистых upsert-хелперов (без БД): подготовка строк карточек и подсчёт
// inserted/updated относительно уже существующих слов дека.
import { describe, it, expect } from "vitest";
import type { ParsedVocabCard } from "./parse-vocab";
import { buildCardRows, partitionByExisting } from "./vocab-upsert";

function card(word: string, order: number, over: Partial<ParsedVocabCard> = {}): ParsedVocabCard {
  return {
    word,
    definition: `def ${word}`,
    example: null,
    translation: null,
    partOfSpeech: null,
    ipa: null,
    synonyms: null,
    collocations: null,
    wordFamily: null,
    quizPrompt: null,
    acceptedAnswers: null,
    order,
    ...over,
  };
}

describe("buildCardRows", () => {
  it("мапит поля, проставляет deckId и сохраняет order", () => {
    const rows = buildCardRows("deck-1", [
      card("alpha", 0, { example: "ex", partOfSpeech: "noun" }),
      card("beta", 1),
    ]);
    expect(rows).toEqual([
      { deckId: "deck-1", order: 0, word: "alpha", definition: "def alpha", example: "ex", translation: null, partOfSpeech: "noun", ipa: null, synonyms: null, collocations: null, wordFamily: null, quizPrompt: null, acceptedAnswers: null },
      { deckId: "deck-1", order: 1, word: "beta", definition: "def beta", example: null, translation: null, partOfSpeech: null, ipa: null, synonyms: null, collocations: null, wordFamily: null, quizPrompt: null, acceptedAnswers: null },
    ]);
  });

  it("пробрасывает enrichment/quiz-поля (0038) без изменений", () => {
    const [row] = buildCardRows("deck-1", [
      card("mitigate", 0, {
        synonyms: ["reduce"],
        collocations: ["mitigate the risk"],
        wordFamily: ["mitigation"],
        quizPrompt: "aim to ___ impact",
        acceptedAnswers: ["mitigate", "reduce"],
      }),
    ]);
    expect(row).toMatchObject({
      synonyms: ["reduce"],
      collocations: ["mitigate the risk"],
      wordFamily: ["mitigation"],
      quizPrompt: "aim to ___ impact",
      acceptedAnswers: ["mitigate", "reduce"],
    });
  });
});

describe("partitionByExisting", () => {
  const cards = [card("alpha", 0), card("beta", 1), card("gamma", 2)];

  it("нет существующих → всё inserted", () => {
    expect(partitionByExisting([], cards)).toEqual({ inserted: 3, updated: 0 });
  });

  it("часть существует → корректный сплит", () => {
    expect(partitionByExisting(["beta"], cards)).toEqual({ inserted: 2, updated: 1 });
    expect(partitionByExisting(["alpha", "gamma"], cards)).toEqual({ inserted: 1, updated: 2 });
  });

  it("все существуют → всё updated", () => {
    expect(partitionByExisting(["alpha", "beta", "gamma"], cards)).toEqual({ inserted: 0, updated: 3 });
  });

  it("сравнение точное (регистрозависимое) — как UNIQUE(deck_id, word)", () => {
    // Существует "Alpha", новая карточка "alpha" → это ВСТАВКА (старая осиротеет),
    // а не обновление: ON CONFLICT матчит слово точно.
    expect(partitionByExisting(["Alpha"], [card("alpha", 0)])).toEqual({ inserted: 1, updated: 0 });
  });

  it("принимает и Set, и любой Iterable", () => {
    expect(partitionByExisting(new Set(["beta"]), cards)).toEqual({ inserted: 2, updated: 1 });
  });
});
