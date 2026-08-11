// Юнит-тесты детерминированного разбора форматных ограничений (P1). Относительный импорт.
import { describe, it, expect } from "vitest";
import { parseWordLimit, parseChoiceCount, countWords } from "./format-guard";

describe("parseWordLimit", () => {
  it("распознаёт «NO MORE THAN N WORDS» словом и цифрой, регистронезависимо", () => {
    expect(parseWordLimit("Write NO MORE THAN TWO WORDS for each answer.")).toEqual({ maxWords: 2, allowNumber: false });
    expect(parseWordLimit("no more than 3 words")).toEqual({ maxWords: 3, allowNumber: false });
    expect(parseWordLimit("<p>Choose NO MORE THAN <b>ONE</b> WORD.</p>")).toEqual({ maxWords: 1, allowNumber: false });
  });

  it("распознаёт «AND/OR A NUMBER»: лимит слов прежний, allowNumber=true", () => {
    expect(parseWordLimit("NO MORE THAN TWO WORDS AND/OR A NUMBER")).toEqual({ maxWords: 2, allowNumber: true });
    expect(parseWordLimit("Write ONE WORD AND/OR A NUMBER for each gap.")).toEqual({ maxWords: 1, allowNumber: true });
  });

  it("распознаёт «ONE WORD ONLY» / «TWO WORDS ONLY» и «WRITE N WORDS»", () => {
    expect(parseWordLimit("ONE WORD ONLY")).toEqual({ maxWords: 1, allowNumber: false });
    expect(parseWordLimit("Use TWO WORDS ONLY.")).toEqual({ maxWords: 2, allowNumber: false });
    expect(parseWordLimit("Write THREE words in each box.")).toEqual({ maxWords: 3, allowNumber: false });
  });

  it("возвращает null, когда формат не про лимит слов", () => {
    expect(parseWordLimit("Answer the question in your own words.")).toBeNull();
    expect(parseWordLimit("Choose the correct heading.")).toBeNull();
    expect(parseWordLimit("")).toBeNull();
  });
});

describe("parseChoiceCount", () => {
  it("распознаёт «Choose TWO» / «Select THREE letters» словом и цифрой", () => {
    expect(parseChoiceCount("Choose TWO letters, A–E.")).toBe(2);
    expect(parseChoiceCount("SELECT THREE ANSWERS")).toBe(3);
    expect(parseChoiceCount("Pick 2 options.")).toBe(2);
    expect(parseChoiceCount("<p>Choose <strong>TWO</strong>.</p>")).toBe(2);
  });

  it("не выдаёт ложное число на «choose the correct letter»", () => {
    expect(parseChoiceCount("Choose the correct letter, A, B or C.")).toBeNull();
    expect(parseChoiceCount("Which of the following is true?")).toBeNull();
    expect(parseChoiceCount("")).toBeNull();
  });
});

describe("countWords", () => {
  it("считает токены по пробелам, схлопывая повторные", () => {
    expect(countWords("new york")).toBe(2);
    expect(countWords("  one   two  three ")).toBe(3);
    expect(countWords("19th")).toBe(1);
  });

  it("пустой / пробельный ответ = 0", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   ")).toBe(0);
  });

  it("ignoreNumbers: числовые токены не считаются («15 dollars» = 1 слово)", () => {
    expect(countWords("15 dollars", true)).toBe(1);
    expect(countWords("9.30 am", true)).toBe(1);
    expect(countWords("1,500 metres", true)).toBe(1);
    // без флага число остаётся токеном
    expect(countWords("15 dollars")).toBe(2);
    // «19th» — не чисто числовой токен, считается словом и с флагом
    expect(countWords("19th century", true)).toBe(2);
  });
});
