// Юнит-тесты нормализации/сравнения quiz-ответа (чистая логика). Акценты строятся
// из кодовых точек (String.fromCodePoint) — исходник ASCII, форма Unicode однозначна.
import { describe, it, expect } from "vitest";
import { normalizeAnswer, isAnswerCorrect, gradeForAnswer } from "./answer";

// "cafe" с острым ударением над e:
//   composed   = e-acute одной кодовой точкой (U+00E9)
//   decomposed = обычная e + combining acute accent (U+0301)
const CAFE_COMPOSED = "caf" + String.fromCodePoint(0x00e9);
const CAFE_DECOMPOSED = "cafe" + String.fromCodePoint(0x0301);

describe("normalizeAnswer", () => {
  it("нижний регистр", () => {
    expect(normalizeAnswer("HeLLo")).toBe("hello");
  });

  it("trim ведущих/хвостовых пробелов", () => {
    expect(normalizeAnswer("  hello  ")).toBe("hello");
  });

  it("схлопывает внутренние пробелы/табы в один", () => {
    expect(normalizeAnswer("a   b\tc")).toBe("a b c");
  });

  it("NFC: decomposed и composed акценты нормализуются одинаково", () => {
    // До нормализации это РАЗНЫЕ строки (5 vs 4 кодовых точки) — тест не тривиален.
    expect(CAFE_DECOMPOSED).not.toBe(CAFE_COMPOSED);
    expect(normalizeAnswer(CAFE_DECOMPOSED)).toBe(normalizeAnswer(CAFE_COMPOSED));
    expect(normalizeAnswer(CAFE_COMPOSED)).toBe(CAFE_COMPOSED);
  });

  it("пустая/пробельная строка → пусто", () => {
    expect(normalizeAnswer("")).toBe("");
    expect(normalizeAnswer("   \t ")).toBe("");
  });
});

describe("isAnswerCorrect", () => {
  it("верно с точностью до регистра и краевых пробелов", () => {
    expect(isAnswerCorrect("  Hello ", "hello")).toBe(true);
  });

  it("верно с точностью до NFC-эквивалентности акцентов", () => {
    expect(isAnswerCorrect(CAFE_DECOMPOSED, CAFE_COMPOSED)).toBe(true);
  });

  it("неверно при другом слове", () => {
    expect(isAnswerCorrect("world", "hello")).toBe(false);
  });

  it("пустой ввод не равен непустому слову", () => {
    expect(isAnswerCorrect("", "hello")).toBe(false);
  });
});

describe("gradeForAnswer", () => {
  it("верно → good", () => {
    expect(gradeForAnswer(true)).toBe("good");
  });
  it("неверно → again", () => {
    expect(gradeForAnswer(false)).toBe("again");
  });
});
