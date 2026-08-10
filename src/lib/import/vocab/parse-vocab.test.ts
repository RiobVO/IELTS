// Тесты детерминированного парсера словарных колод (Vocabulary). Вход — инертный
// JSON, поэтому фикстуры — обычные объекты, сериализованные в строку.
import { describe, it, expect } from "vitest";
import { MAX_CARDS, MAX_FILE_BYTES, VocabParseError, parseVocab } from "./parse-vocab";

/** Валидная колода с переопределяемыми полями (для позитивных и точечных негативных кейсов). */
function deck(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    title: "Academic Word List 1",
    description: "Sublist 1",
    level: "B2",
    tier_required: "premium",
    cards: [
      { word: "analyse", definition: "examine in detail", example: "analyse the data", translation: "анализировать", part_of_speech: "verb", ipa: "ˈænəlaɪz" },
      { word: "concept", definition: "an abstract idea" },
    ],
    ...overrides,
  });
}

describe("parseVocab — валидный файл", () => {
  const parsed = parseVocab(deck());

  it("читает мету дека и дефолты", () => {
    expect(parsed.title).toBe("Academic Word List 1");
    expect(parsed.description).toBe("Sublist 1");
    expect(parsed.level).toBe("B2");
    expect(parsed.tierRequired).toBe("premium");
    expect(parsed.cards).toHaveLength(2);
  });

  it("назначает order по позиции в файле (0..n-1)", () => {
    expect(parsed.cards.map((c) => c.order)).toEqual([0, 1]);
  });

  it("мапит опциональные поля, отсутствующие → null", () => {
    expect(parsed.cards[0]).toMatchObject({
      word: "analyse",
      definition: "examine in detail",
      example: "analyse the data",
      translation: "анализировать",
      partOfSpeech: "verb",
      ipa: "ˈænəlaɪz",
    });
    expect(parsed.cards[1]).toMatchObject({
      word: "concept",
      definition: "an abstract idea",
      example: null,
      translation: null,
      partOfSpeech: null,
      ipa: null,
    });
  });

  it("тримит и обрабатывает пустые опциональные как null", () => {
    const p = parseVocab(
      JSON.stringify({
        title: "  Trim me  ",
        cards: [{ word: "  run  ", definition: "  move fast  ", example: "   " }],
      }),
    );
    expect(p.title).toBe("Trim me");
    expect(p.cards[0].word).toBe("run");
    expect(p.cards[0].definition).toBe("move fast");
    expect(p.cards[0].example).toBeNull();
  });

  it("tier_required по умолчанию basic, description/level по умолчанию null", () => {
    const p = parseVocab(JSON.stringify({ title: "T", cards: [{ word: "w", definition: "d" }] }));
    expect(p.tierRequired).toBe("basic");
    expect(p.description).toBeNull();
    expect(p.level).toBeNull();
  });
});

describe("parseVocab — обязательные поля", () => {
  it("отсутствие title → ошибка", () => {
    expect(() => parseVocab(deck({ title: undefined }))).toThrow(/title is required/i);
  });
  it("пустой title (после trim) → ошибка", () => {
    expect(() => parseVocab(deck({ title: "   " }))).toThrow(VocabParseError);
  });
  it("отсутствие word в карточке → ошибка с номером карточки", () => {
    expect(() => parseVocab(deck({ cards: [{ definition: "d" }] }))).toThrow(/card 1 "word" is required/i);
  });
  it("отсутствие definition в карточке → ошибка", () => {
    expect(() => parseVocab(deck({ cards: [{ word: "w" }] }))).toThrow(/card 1 "definition" is required/i);
  });
  it("word не строка → ошибка", () => {
    expect(() => parseVocab(deck({ cards: [{ word: 42, definition: "d" }] }))).toThrow(VocabParseError);
  });
});

describe("parseVocab — cards как коллекция", () => {
  it("cards не массив → ошибка", () => {
    expect(() => parseVocab(deck({ cards: { word: "w" } }))).toThrow(/cards must be an array/i);
  });
  it("пустой cards → ошибка", () => {
    expect(() => parseVocab(deck({ cards: [] }))).toThrow(/cards must not be empty/i);
  });
  it("превышение MAX_CARDS → ошибка", () => {
    const cards = Array.from({ length: MAX_CARDS + 1 }, (_, i) => ({ word: `w${i}`, definition: "d" }));
    expect(() => parseVocab(deck({ cards }))).toThrow(/too many cards/i);
  });
});

describe("parseVocab — дубликаты слов внутри файла", () => {
  it("точный дубль → ошибка", () => {
    const cards = [
      { word: "run", definition: "a" },
      { word: "run", definition: "b" },
    ];
    expect(() => parseVocab(deck({ cards }))).toThrow(/duplicate word "run"/i);
  });
  it("дубль в другом регистре (case-insensitive) → ошибка", () => {
    const cards = [
      { word: "Run", definition: "a" },
      { word: "run", definition: "b" },
    ];
    expect(() => parseVocab(deck({ cards }))).toThrow(/duplicate word/i);
  });
  it("дубль после trim → ошибка", () => {
    const cards = [
      { word: "run", definition: "a" },
      { word: "  RUN  ", definition: "b" },
    ];
    expect(() => parseVocab(deck({ cards }))).toThrow(/duplicate word/i);
  });
});

describe("parseVocab — tier / level / лимиты / JSON", () => {
  it("неизвестный tier_required → ошибка", () => {
    expect(() => parseVocab(deck({ tier_required: "gold" }))).toThrow(/tier_required must be one of/i);
  });
  it("допустимые tier проходят", () => {
    for (const t of ["basic", "premium", "ultra"]) {
      expect(parseVocab(deck({ tier_required: t })).tierRequired).toBe(t);
    }
  });
  it("level — свободный текст (не enum), непустой сохраняется", () => {
    expect(parseVocab(deck({ level: "IELTS 7.0" })).level).toBe("IELTS 7.0");
  });
  it("слишком длинное поле → ошибка", () => {
    const longWord = "x".repeat(201);
    expect(() => parseVocab(deck({ cards: [{ word: longWord, definition: "d" }] }))).toThrow(/too long/i);
  });
  it("файл больше MAX_FILE_BYTES → ошибка (до JSON.parse)", () => {
    const huge = "x".repeat(MAX_FILE_BYTES + 1);
    expect(() => parseVocab(huge)).toThrow(/file too large/i);
  });
  it("многобайтовый файл: гейт по БАЙТАМ, не по UTF-16 длине", () => {
    // Кириллица "я" — 1 UTF-16 code unit, но 2 байта UTF-8. В символах ниже предела,
    // в байтах — выше: старый .length-гейт пропустил бы такой файл.
    const cyr = "я".repeat(MAX_FILE_BYTES / 2 + 1);
    expect(cyr.length).toBeLessThan(MAX_FILE_BYTES); // прошёл бы char-гейт
    expect(() => parseVocab(cyr)).toThrow(/file too large/i);
  });
  it("обрезает preview значения в сообщении (не мегабайтные ошибки)", () => {
    let msg = "";
    try {
      parseVocab(deck({ tier_required: "x".repeat(5000) }));
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(/tier_required must be one of/i);
    expect(msg).toContain("…");
    expect(msg.length).toBeLessThan(200);
  });
  it("невалидный JSON → VocabParseError, а не сырой SyntaxError", () => {
    expect(() => parseVocab("{ not json ")).toThrow(VocabParseError);
    expect(() => parseVocab("{ not json ")).toThrow(/invalid JSON/i);
  });
  it("корень-массив → ошибка", () => {
    expect(() => parseVocab("[]")).toThrow(/root must be a JSON object/i);
  });
});

describe("parseVocab — enrichment (0038): валидный файл со всеми новыми полями", () => {
  const p = parseVocab(
    JSON.stringify({
      title: "Enriched deck",
      question_types: ["tfng", "mcq_single"],
      cards: [
        {
          word: "mitigate",
          definition: "make less severe",
          synonyms: ["reduce", "lessen"],
          collocations: ["mitigate the risk", "mitigate damage"],
          word_family: ["mitigation", "mitigating"],
          quiz_prompt: "New measures aim to ___ the impact of floods.",
          accepted_answers: ["mitigate", "reduce"],
        },
      ],
    }),
  );

  it("дек: question_types — канон-слаги", () => {
    expect(p.questionTypes).toEqual(["tfng", "mcq_single"]);
  });

  it("карта: массивы обогащения и quiz-поля смаплены", () => {
    expect(p.cards[0]).toMatchObject({
      synonyms: ["reduce", "lessen"],
      collocations: ["mitigate the risk", "mitigate damage"],
      wordFamily: ["mitigation", "mitigating"],
      quizPrompt: "New measures aim to ___ the impact of floods.",
      acceptedAnswers: ["mitigate", "reduce"],
    });
  });

  it("отсутствие enrichment → все new-поля null (обратная совместимость)", () => {
    const plain = parseVocab(
      JSON.stringify({ title: "T", cards: [{ word: "w", definition: "d" }] }),
    );
    expect(plain.questionTypes).toBeNull();
    expect(plain.cards[0]).toMatchObject({
      synonyms: null,
      collocations: null,
      wordFamily: null,
      quizPrompt: null,
      acceptedAnswers: null,
    });
  });

  it("question_types: пустой массив → null; тримит слаги", () => {
    expect(parseVocab(deck({ question_types: [] })).questionTypes).toBeNull();
    expect(parseVocab(deck({ question_types: ["  tfng  "] })).questionTypes).toEqual(["tfng"]);
  });

  it("quiz_prompt задан, accepted_answers отсутствует → валидно (fallback=word)", () => {
    const q = parseVocab(
      deck({ cards: [{ word: "run", definition: "d", quiz_prompt: "I ___ daily." }] }),
    );
    expect(q.cards[0].quizPrompt).toBe("I ___ daily.");
    expect(q.cards[0].acceptedAnswers).toBeNull();
  });

  it("пустые массивы обогащения → null (не ошибка)", () => {
    const q = parseVocab(deck({ cards: [{ word: "run", definition: "d", synonyms: [] }] }));
    expect(q.cards[0].synonyms).toBeNull();
  });
});

describe("parseVocab — enrichment (0038): негативные кейсы", () => {
  it("quiz_prompt без маркера ___ → ошибка", () => {
    expect(() =>
      parseVocab(deck({ cards: [{ word: "w", definition: "d", quiz_prompt: "no blank here" }] })),
    ).toThrow(/must contain a blank marker/i);
  });

  it("accepted_answers задан пустым массивом → ошибка", () => {
    expect(() =>
      parseVocab(deck({ cards: [{ word: "w", definition: "d", accepted_answers: [] }] })),
    ).toThrow(/"accepted_answers" must not be empty/i);
  });

  it("неизвестный question_type слаг → VocabParseError", () => {
    expect(() => parseVocab(deck({ question_types: ["tfng", "essay_grading"] }))).toThrow(
      /unknown question type/i,
    );
  });

  it("question_types — не строковый элемент → ошибка", () => {
    expect(() => parseVocab(deck({ question_types: [42] }))).toThrow(/must be strings/i);
  });

  it("лимит: >20 элементов в synonyms → ошибка", () => {
    const synonyms = Array.from({ length: 21 }, (_, i) => `s${i}`);
    expect(() =>
      parseVocab(deck({ cards: [{ word: "w", definition: "d", synonyms }] })),
    ).toThrow(/"synonyms" has too many items/i);
  });

  it("лимит: >10 элементов в accepted_answers → ошибка", () => {
    const accepted_answers = Array.from({ length: 11 }, (_, i) => `a${i}`);
    expect(() =>
      parseVocab(
        deck({ cards: [{ word: "w", definition: "d", quiz_prompt: "___", accepted_answers }] }),
      ),
    ).toThrow(/"accepted_answers" has too many items/i);
  });

  it("лимит: >10 question_types → ошибка", () => {
    const question_types = Array.from({ length: 11 }, () => "tfng");
    expect(() => parseVocab(deck({ question_types }))).toThrow(/question_types has too many items/i);
  });

  it("лимит: элемент массива длиннее 200 символов → ошибка", () => {
    const synonyms = ["x".repeat(201)];
    expect(() =>
      parseVocab(deck({ cards: [{ word: "w", definition: "d", synonyms }] })),
    ).toThrow(/too long/i);
  });

  it("пустая строка внутри массива обогащения → ошибка", () => {
    expect(() =>
      parseVocab(deck({ cards: [{ word: "w", definition: "d", synonyms: ["ok", "   "] }] })),
    ).toThrow(/must not be empty/i);
  });
});
