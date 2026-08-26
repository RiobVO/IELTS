// Отбор вопросов, которые бот вправе задать в чате. Все строки ниже — РЕАЛЬНЫЕ
// формулировки из опубликованного каталога (снято с прода 2026-08-07): именно на
// них видно, что решает не тип вопроса, а форма формулировки.
import { describe, it, expect } from "vitest";
import { isChatAnswerable, PASSAGE_BOUND_QTYPES } from "./chat-answerable";

describe("isChatAnswerable — типы-указатели в пассаж", () => {
  it("«Paragraph A» с восемью заголовками — то, из-за чего фильтр и появился", () => {
    expect(isChatAnswerable("matching_headings", "Paragraph A")).toBe(false);
  });

  it("длинная формулировка типу-указателю не помогает", () => {
    expect(
      isChatAnswerable(
        "matching_info",
        "a list of factors which have resulted in some damage to Great Zimbabwe",
      ),
    ).toBe(false);
    expect(
      isChatAnswerable("matching_sentence_endings", "The findings at Kalambo Falls revealed that"),
    ).toBe(false);
  });

  it("все шесть типов-указателей закрыты", () => {
    for (const q of PASSAGE_BOUND_QTYPES) {
      expect(isChatAnswerable(q, "a perfectly long and readable question stem")).toBe(false);
    }
  });
});

describe("isChatAnswerable — форма формулировки", () => {
  it("самодостаточное утверждение и вопрос с вариантами — да", () => {
    expect(
      isChatAnswerable(
        "tfng",
        "Chocolate was consumed by greater numbers of people in the nineteenth century.",
      ),
    ).toBe(true);
    expect(
      isChatAnswerable(
        "mcq_single",
        "What should trainees always expect to get when working on low budget short films?",
      ),
    ).toBe(true);
  });

  it("строка с одним пропуском — да", () => {
    expect(
      isChatAnswerable("note_completion", "Bring suitable clothing, a ____ and toiletries."),
    ).toBe(true);
    expect(isChatAnswerable("sentence_completion", "There is a ____ at the club.")).toBe(true);
  });

  it("два пропуска в одной формулировке — нет: она общая на несколько вопросов", () => {
    expect(
      isChatAnswerable(
        "table_completion",
        "basic theory e.g. understanding the ____ and tides basic sailing skills including ____ information",
      ),
    ).toBe(false);
  });

  it("инструкция блока с четырьмя пропусками вместо вопроса — нет", () => {
    expect(
      isChatAnswerable(
        "summary_completion",
        "Questions 23–26 Complete the summary below. Choose ONE WORD ONLY from the passage. " +
          "The ____ was ____ by ____ during the ____ .",
      ),
    ).toBe(false);
  });

  it("обрывок таблицы без контекста — нет", () => {
    expect(isChatAnswerable("note_completion", "____")).toBe(false);
    expect(isChatAnswerable("note_completion", "extreme ____ events.")).toBe(false);
    expect(isChatAnswerable("note_completion", "keep ____ 1 out")).toBe(false);
    expect(isChatAnswerable("note_completion", "provided enough ____")).toBe(false);
  });

  it("пустая формулировка — нет", () => {
    expect(isChatAnswerable("tfng", "")).toBe(false);
    expect(isChatAnswerable("tfng", "   ")).toBe(false);
  });
});
