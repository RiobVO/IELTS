// Живой прогон прислал «Paragraph A» с восемью заголовками: matching-задания
// адресуют кусок пассажа, которого в чате нет, — решить их там нельзя даже зная
// тест. Тест пиннит, какие типы бот вправе спрашивать, и текст сообщения-замены.
import { describe, it, expect } from "vitest";
import { mistakesOnSiteMessage } from "./messages";

// Список зеркалит CHAT_ANSWERABLE_QTYPES в daily-question.ts (тот модуль server-only
// и тянет БД, поэтому сверяем контракт здесь — расхождение сразу видно в ревью).
const CHAT_ANSWERABLE = [
  "tfng",
  "ynng",
  "mcq_single",
  "mcq_multi",
  "sentence_completion",
  "short_answer",
];
const NEEDS_PASSAGE = [
  "matching_headings",
  "matching_info",
  "matching_features",
  "matching_sentence_endings",
  "summary_completion",
  "note_completion",
  "flowchart_completion",
  "table_completion",
  "diagram_label",
  "map_labelling",
  "form_completion",
];

describe("что бот вправе спрашивать в чате", () => {
  it("самодостаточные формулировки — да", () => {
    expect(CHAT_ANSWERABLE).toContain("tfng");
    expect(CHAT_ANSWERABLE).toContain("mcq_single");
    expect(CHAT_ANSWERABLE).toContain("short_answer");
  });

  it("всё, что адресует кусок пассажа, — нет", () => {
    for (const q of NEEDS_PASSAGE) {
      expect(CHAT_ANSWERABLE).not.toContain(q);
    }
  });

  it("списки не пересекаются", () => {
    expect(CHAT_ANSWERABLE.filter((q) => NEEDS_PASSAGE.includes(q))).toEqual([]);
  });
});

describe("mistakesOnSiteMessage", () => {
  it("называет число и объясняет, почему не здесь", () => {
    const text = mistakesOnSiteMessage(3, "https://bando.study/app/practice/mistakes");
    expect(text).toContain("3 mistakes");
    expect(text).toMatch(/passage/i);
    expect(text).toContain("https://bando.study/app/practice/mistakes");
  });

  it("единственное число не выглядит как ошибка перевода", () => {
    expect(mistakesOnSiteMessage(1, null)).toMatch(/^1 mistake is due/);
  });

  it("без ссылки сообщение всё равно осмысленно", () => {
    expect(mistakesOnSiteMessage(2, null)).not.toContain("http");
  });
});
