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

  it("несовпадение множеств номеров → atomized=false, parsed === runner (без изменений)", () => {
    const runner = base({ questions: [q(1), q(2)] });
    const atom = base({
      passages: [passage(1, { bodyHtml: "<p>x</p>" })],
      questions: [q(1, { promptHtml: "only one" })], // не хватает Q2
    });

    const res = mergeAtomization(runner, atom);

    expect(res.atomized).toBe(false);
    expect(res.parsed).toBe(runner);
    expect(res.reason).toMatch(/number/i);
  });

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
});
