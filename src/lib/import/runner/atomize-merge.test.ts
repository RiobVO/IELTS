import { describe, it, expect } from "vitest";
import { mergeAtomization } from "./atomize-merge";
import type { ParsedTest, ParsedQuestion, ParsedPassage } from "../types";

function q(number: number, over: Partial<ParsedQuestion> = {}): ParsedQuestion {
  return {
    number,
    passageOrder: 1,
    qtype: "tfng",
    promptHtml: "",
    options: null,
    groupKey: null,
    evidenceRef: null,
    answer: { mode: "exact", accept: ["TRUE"], explanation: null, evidence: null },
    ...over,
  };
}

function passage(order: number, over: Partial<ParsedPassage> = {}): ParsedPassage {
  return { order, title: null, bodyHtml: "", audioPath: null, questionsHtml: null, ...over };
}

function base(over: Partial<ParsedTest> = {}): ParsedTest {
  return {
    title: "Runner Test",
    section: "reading",
    category: "passage_1",
    bandType: "reading_academic",
    durationSeconds: 1200,
    questionTypes: ["tfng"],
    bandScale: null,
    passages: [passage(1)],
    questions: [q(1), q(2)],
    warnings: [],
    ...over,
  };
}

describe("mergeAtomization", () => {
  it("прищепляет только презентационные поля из atom, номера совпадают → atomized=true", () => {
    const runner = base();
    const atom = base({
      // atom — «другой взгляд» на тот же файл: реальный текст + prompt/options + passageOrder
      title: "Atom Title (ignored)",
      category: "passage_3",
      passages: [
        passage(1, { title: "Passage One", bodyHtml: "<p>Real text A</p>" }),
        passage(2, { title: "Passage Two", bodyHtml: "<p>Real text B</p>" }),
      ],
      questions: [
        q(1, { passageOrder: 1, promptHtml: "Statement one", options: [{ value: "TRUE", label: "TRUE" }] }),
        q(2, { passageOrder: 2, promptHtml: "Statement two", options: [{ value: "TRUE", label: "TRUE" }] }),
      ],
    });

    const res = mergeAtomization(runner, atom);

    expect(res.atomized).toBe(true);
    // passages заменены на атомизированные (непустой bodyHtml)
    expect(res.parsed.passages.map((p) => p.bodyHtml)).toEqual(["<p>Real text A</p>", "<p>Real text B</p>"]);
    expect(res.parsed.passages.map((p) => p.order)).toEqual([1, 2]);
    // вопросы: презентационные поля из atom
    expect(res.parsed.questions[0]!.promptHtml).toBe("Statement one");
    expect(res.parsed.questions[0]!.options).toEqual([{ value: "TRUE", label: "TRUE" }]);
    expect(res.parsed.questions[1]!.passageOrder).toBe(2);
    // meta уровня content_item — из runner, НЕ из atom
    expect(res.parsed.title).toBe("Runner Test");
    expect(res.parsed.category).toBe("passage_1");
  });

  it("answer_key / qtype / groupKey / number НИКОГДА не берутся из atom", () => {
    const runner = base({
      questions: [
        q(1, { qtype: "mcq_single", groupKey: null, answer: { mode: "text_accept", accept: ["A", "C"], explanation: "e", evidence: null } }),
      ],
    });
    const atom = base({
      passages: [passage(1, { bodyHtml: "<p>x</p>" })],
      questions: [
        // atom видит тот же вопрос как mcq_multi/mcq_set — это НЕ должно попасть в merge
        q(1, { qtype: "mcq_multi", groupKey: "1-2", promptHtml: "P", answer: { mode: "mcq_set", accept: ["A", "C", "D"], explanation: null, evidence: null } }),
      ],
    });

    const res = mergeAtomization(runner, atom);

    expect(res.atomized).toBe(true);
    const m = res.parsed.questions[0]!;
    // ключ + типизация строго из runner (source of truth)
    expect(m.qtype).toBe("mcq_single");
    expect(m.groupKey).toBeNull();
    expect(m.answer).toEqual({ mode: "text_accept", accept: ["A", "C"], explanation: "e", evidence: null });
    // презентация — из atom
    expect(m.promptHtml).toBe("P");
  });

  it.each(["reading", "listening"] as const)(
    "несовпадение множеств номеров → atomized=false, parsed === runner (без изменений) [%s]",
    (section) => {
      const runner = base({ section, questions: [q(1), q(2)] });
      const atom = base({
        section,
        passages: [passage(1, { bodyHtml: "<p>x</p>" })],
        questions: [q(1, { promptHtml: "only one" })], // не хватает Q2
      });

      const res = mergeAtomization(runner, atom);

      expect(res.atomized).toBe(false);
      expect(res.parsed).toBe(runner);
      expect(res.reason).toMatch(/number/i);
    },
  );

  it("дубликат номера в atom → atomized=false (мерж по number перезаписал бы строку)", () => {
    const runner = base({ questions: [q(1), q(2)] });
    const atom = base({
      passages: [passage(1, { bodyHtml: "<p>x</p>" })],
      questions: [q(1, { promptHtml: "a" }), q(1, { promptHtml: "b" }), q(2)],
    });

    const res = mergeAtomization(runner, atom);

    expect(res.atomized).toBe(false);
    expect(res.parsed).toBe(runner);
  });

  it.each(["reading", "listening"] as const)(
    "passageOrder вопроса без соответствующего пассажа в atom → atomized=false [%s]",
    (section) => {
      const runner = base({ section, questions: [q(1), q(2)] });
      const atom = base({
        section,
        passages: [passage(1, { bodyHtml: "<p>only p1</p>" })], // нет пассажа order=2
        questions: [q(1, { passageOrder: 1, promptHtml: "a" }), q(2, { passageOrder: 2, promptHtml: "b" })],
      });

      const res = mergeAtomization(runner, atom);

      expect(res.atomized).toBe(false);
      expect(res.parsed).toBe(runner);
      expect(res.reason).toMatch(/passage/i);
    },
  );

  it("atom без пассажей (пустой массив) → atomized=false (иначе persist уронит NOT NULL)", () => {
    const runner = base({ questions: [q(1)] });
    const atom = base({ passages: [], questions: [q(1, { promptHtml: "a" })] });

    const res = mergeAtomization(runner, atom);

    expect(res.atomized).toBe(false);
    expect(res.parsed).toBe(runner);
  });

  it("audioPath пассажа сохраняется из runner (не затирается null из atom)", () => {
    const runner = base({
      section: "listening",
      passages: [passage(1, { audioPath: "https://cdn/a.mp3" })],
      questions: [q(1)],
    });
    const atom = base({
      section: "listening",
      passages: [passage(1, { bodyHtml: "Part 1", audioPath: null })],
      questions: [q(1, { promptHtml: "P" })],
    });

    const res = mergeAtomization(runner, atom);

    expect(res.atomized).toBe(true);
    expect(res.parsed.passages[0]!.audioPath).toBe("https://cdn/a.mp3");
    expect(res.parsed.passages[0]!.bodyHtml).toBe("Part 1");
  });

  it("atom-audioPath (внешний хотлинк из parse-listening) НЕ утекает: runner null → merged null", () => {
    // Сбой audio-fetch / превышение капа: runner-пассаж без аудио, но atom несёт
    // исходный внешний <audio src>. Persist обязан получить null («imported without
    // audio»), а не внешний линк — Storage-URL присваивает import-runner после мержа.
    const runner = base({
      section: "listening",
      passages: [passage(1, { audioPath: null })],
      questions: [q(1)],
    });
    const atom = base({
      section: "listening",
      passages: [
        passage(1, { bodyHtml: "Part 1", audioPath: "https://external-cdn/source.mp3" }),
        passage(2, { bodyHtml: "Part 2", audioPath: "https://external-cdn/source.mp3" }),
      ],
      questions: [q(1, { passageOrder: 1, promptHtml: "P" })],
    });

    const res = mergeAtomization(runner, atom);

    expect(res.atomized).toBe(true);
    // и пассаж, известный runner'у (order=1), и atom-only пассаж (order=2) — без хотлинка
    expect(res.parsed.passages.map((p) => p.audioPath)).toEqual([null, null]);
  });

  it("listening: choose-TWO member (atom mcq_multi + groupKey) → qtype promoted, groupKey/prompt/options из atom, answer строго от runner", () => {
    const runnerAnswerQ1 = { mode: "text_accept" as const, accept: ["A", "C"], explanation: null, evidence: null };
    const runnerAnswerQ2 = { mode: "text_accept" as const, accept: ["A", "C"], explanation: null, evidence: null };
    // runner listening видит choose-TWO members как одиночные mcq_single (не парсит
    // .mcq.multi[data-qs]) и НИКОГДА не даёт groupKey — это и воспроизводим здесь.
    const runner = base({
      section: "listening",
      passages: [passage(1)],
      questions: [
        q(1, { qtype: "mcq_single", groupKey: null, answer: runnerAnswerQ1 }),
        q(2, { qtype: "mcq_single", groupKey: null, answer: runnerAnswerQ2 }),
      ],
    });
    const atomOptions = [
      { value: "A", label: "Alpha" },
      { value: "B", label: "Beta" },
      { value: "C", label: "Gamma" },
    ];
    const atom = base({
      section: "listening",
      passages: [passage(1, { bodyHtml: "Part 1" })],
      questions: [
        q(1, {
          qtype: "mcq_multi",
          groupKey: "1-2",
          promptHtml: "Choose TWO",
          options: atomOptions,
          answer: { mode: "mcq_set", accept: ["A", "C"], explanation: null, evidence: null },
        }),
        q(2, {
          qtype: "mcq_multi",
          groupKey: "1-2",
          promptHtml: "Choose TWO",
          options: atomOptions,
          answer: { mode: "mcq_set", accept: ["A", "C"], explanation: null, evidence: null },
        }),
      ],
    });

    const res = mergeAtomization(runner, atom);

    expect(res.atomized).toBe(true);
    const [m1, m2] = res.parsed.questions;
    expect(m1!.qtype).toBe("mcq_multi");
    expect(m1!.groupKey).toBe("1-2");
    expect(m1!.promptHtml).toBe("Choose TWO");
    expect(m1!.options).toEqual(atomOptions);
    // грейдинг-инвариант: answer НЕ берётся из atom даже при промотированном qtype
    // (choose-TWO ключ в проде — text_accept с обеими буквами per-member, менять нельзя).
    expect(m1!.answer).toEqual(runnerAnswerQ1);
    expect(m2!.qtype).toBe("mcq_multi");
    expect(m2!.groupKey).toBe("1-2");
    expect(m2!.answer).toEqual(runnerAnswerQ2);
    // top-level questionTypes (персистится в content_item, каталог-фильтр)
    // пересчитан из итоговых qtype — иначе каталог показал бы mcq_single.
    expect(res.parsed.questionTypes).toEqual(["mcq_multi"]);
  });

  it("listening: promotion НЕ срабатывает, если runner дал не mcq_single (matching_features vs atom mcq_multi)", () => {
    // Ловит реализацию, проверяющую только atom-сторону (aq.qtype === "mcq_multi")
    // без условия на runner mcq_single.
    const runner = base({
      section: "listening",
      passages: [passage(1)],
      questions: [
        q(1, {
          qtype: "matching_features",
          groupKey: null,
          answer: { mode: "exact", accept: ["D"], explanation: null, evidence: null },
        }),
      ],
    });
    const atom = base({
      section: "listening",
      passages: [passage(1, { bodyHtml: "Part 1" })],
      questions: [
        q(1, {
          qtype: "mcq_multi",
          groupKey: "1-2",
          promptHtml: "Match",
          options: [{ value: "D", label: "Delta" }],
        }),
      ],
    });

    const res = mergeAtomization(runner, atom);

    expect(res.atomized).toBe(true);
    const m = res.parsed.questions[0]!;
    expect(m.qtype).toBe("matching_features"); // runner-семантика, promotion только для mcq_single
    expect(m.groupKey).toBe("1-2"); // groupKey из atom применяется независимо
    expect(m.answer).toEqual({ mode: "exact", accept: ["D"], explanation: null, evidence: null });
  });

  it("listening: qtype-расхождение НЕ choose-TWO (runner map_labelling, atom mcq_single) → qtype остаётся runner, groupKey всё равно из atom", () => {
    const runner = base({
      section: "listening",
      passages: [passage(1)],
      questions: [
        q(1, {
          qtype: "map_labelling",
          groupKey: null,
          answer: { mode: "exact", accept: ["B"], explanation: null, evidence: null },
        }),
      ],
    });
    const atom = base({
      section: "listening",
      passages: [passage(1, { bodyHtml: "Part 1" })],
      questions: [
        q(1, {
          qtype: "mcq_single",
          groupKey: "1-3",
          promptHtml: "Where is the library?",
          options: [{ value: "B", label: "North wing" }],
        }),
      ],
    });

    const res = mergeAtomization(runner, atom);

    expect(res.atomized).toBe(true);
    const m = res.parsed.questions[0]!;
    // qtype НЕ переписан — только mcq_single→mcq_multi промотируется, всё остальное
    // расхождение (map_labelling vs mcq_single) остаётся runner-семантикой.
    expect(m.qtype).toBe("map_labelling");
    // groupKey всё равно из atom — listening-runner его вообще не даёт.
    expect(m.groupKey).toBe("1-3");
    expect(m.answer).toEqual({ mode: "exact", accept: ["B"], explanation: null, evidence: null });
  });
});
