// Юнит-тесты детерминированного детектора «потерь на формате» (P13). Относительный импорт.
import { describe, it, expect } from "vitest";
import { detectFormatLosses, type FormatLossInput } from "./format-loss";

describe("detectFormatLosses", () => {
  it("не флагует верный ответ, даже если он нарушает лимит слов", () => {
    const items: FormatLossInput[] = [
      { number: 1, promptHtml: "NO MORE THAN TWO WORDS", givenRaw: "one two three", isCorrect: true },
    ];
    expect(detectFormatLosses(items)).toEqual([]);
  });

  it("не флагует неверный ответ в пределах лимита слов", () => {
    const items: FormatLossInput[] = [
      { number: 2, promptHtml: "NO MORE THAN TWO WORDS", givenRaw: "wrong answer", isCorrect: false },
    ];
    expect(detectFormatLosses(items)).toEqual([]);
  });

  it("флагует неверный ответ, превышающий лимит слов", () => {
    const items: FormatLossInput[] = [
      { number: 3, promptHtml: "Write NO MORE THAN TWO WORDS for each answer.", givenRaw: "way too many words here", isCorrect: false },
    ];
    expect(detectFormatLosses(items)).toEqual([{ number: 3, reason: "word-limit" }]);
  });

  it("AND/OR A NUMBER: числовой (в т.ч. дефисный) токен не считается словом", () => {
    const items: FormatLossInput[] = [
      { number: 4, promptHtml: "ONE WORD AND/OR A NUMBER", givenRaw: "1996-1999", isCorrect: false },
    ];
    // чисто числовой токен игнорируется countWords -> 0 слов <= лимита 1, формат не нарушен
    expect(detectFormatLosses(items)).toEqual([]);
  });

  it("не флагует пустой/пропущенный ответ при лимите слов", () => {
    const items: FormatLossInput[] = [
      { number: 5, promptHtml: "NO MORE THAN TWO WORDS", givenRaw: "", isCorrect: false },
      { number: 6, promptHtml: "NO MORE THAN TWO WORDS", givenRaw: null, isCorrect: false },
    ];
    expect(detectFormatLosses(items)).toEqual([]);
  });

  it("флагует multi-select недобор (выбрано меньше требуемого)", () => {
    const items: FormatLossInput[] = [
      { number: 7, promptHtml: "Choose TWO letters, A-E.", givenRaw: ["A"], isCorrect: false },
    ];
    expect(detectFormatLosses(items)).toEqual([{ number: 7, reason: "choice-count" }]);
  });

  it("флагует multi-select перебор (выбрано больше требуемого)", () => {
    const items: FormatLossInput[] = [
      { number: 8, promptHtml: "Choose TWO letters, A-E.", givenRaw: ["A", "B", "C"], isCorrect: false },
    ];
    expect(detectFormatLosses(items)).toEqual([{ number: 8, reason: "choice-count" }]);
  });

  it("multi-select: неверный ответ при верном числе выборов — не формат, не флагуется", () => {
    const items: FormatLossInput[] = [
      { number: 9, promptHtml: "Choose TWO letters, A-E.", givenRaw: ["A", "B"], isCorrect: false },
    ];
    expect(detectFormatLosses(items)).toEqual([]);
  });

  it("multi-select: строка через запятую/пробел считается так же, как массив", () => {
    const items: FormatLossInput[] = [
      { number: 10, promptHtml: "SELECT THREE ANSWERS", givenRaw: "A, B", isCorrect: false },
    ];
    expect(detectFormatLosses(items)).toEqual([{ number: 10, reason: "choice-count" }]);
  });

  it("не флагует пропущенный multi-select ответ", () => {
    const items: FormatLossInput[] = [
      { number: 11, promptHtml: "Choose TWO letters, A-E.", givenRaw: [], isCorrect: false },
    ];
    expect(detectFormatLosses(items)).toEqual([]);
  });

  it("не флагует, если формат промпта не распознан вовсе", () => {
    const items: FormatLossInput[] = [
      { number: 12, promptHtml: "Choose the correct heading.", givenRaw: "some very long unrelated answer text", isCorrect: false },
    ];
    expect(detectFormatLosses(items)).toEqual([]);
  });

  it("выдаёт несколько потерь для нескольких вопросов", () => {
    const items: FormatLossInput[] = [
      { number: 1, promptHtml: "NO MORE THAN TWO WORDS", givenRaw: "way too many words", isCorrect: false },
      { number: 2, promptHtml: "Choose TWO letters, A-E.", givenRaw: ["A"], isCorrect: false },
      { number: 3, promptHtml: "NO MORE THAN TWO WORDS", givenRaw: "one word", isCorrect: false },
    ];
    expect(detectFormatLosses(items)).toEqual([
      { number: 1, reason: "word-limit" },
      { number: 2, reason: "choice-count" },
    ]);
  });
});
