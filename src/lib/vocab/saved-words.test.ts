// Юнит-тесты чистой логики P11 (нормализация слова + вырезка контекста). Без IO.
import { describe, it, expect } from "vitest";
import { extractContext, MAX_CONTEXT_LEN, MAX_WORD_LEN, normalizeWord } from "./saved-words";

describe("normalizeWord", () => {
  it("одиночное слово — trim + схлоп пробелов", () => {
    expect(normalizeWord("  research ")).toBe("research");
    expect(normalizeWord("Ecosystem")).toBe("Ecosystem");
  });

  it("внутренний дефис и апостроф допустимы", () => {
    expect(normalizeWord("self-aware")).toBe("self-aware");
    expect(normalizeWord("don't")).toBe("don't");
    expect(normalizeWord("don’t")).toBe("don’t");
  });

  it("хвостовой/ведущий дефис или апостроф отклоняется (мусор в словаре)", () => {
    expect(normalizeWord("word-")).toBeNull();
    expect(normalizeWord("word'")).toBeNull();
    expect(normalizeWord("-word")).toBeNull();
    expect(normalizeWord("’word")).toBeNull();
  });

  it("не-латинские буквы допустимы (\\p{L})", () => {
    expect(normalizeWord("naïve")).toBe("naïve");
  });

  it("фраза из нескольких слов отклоняется", () => {
    expect(normalizeWord("climate change")).toBeNull();
  });

  it("цифры, знаки, HTML отклоняются", () => {
    expect(normalizeWord("word1")).toBeNull();
    expect(normalizeWord("<b>hi</b>")).toBeNull();
    expect(normalizeWord("a,b")).toBeNull();
    expect(normalizeWord("_lead")).toBeNull();
    expect(normalizeWord("-lead")).toBeNull();
  });

  it("пустое / только пробелы / перенос → null", () => {
    expect(normalizeWord("")).toBeNull();
    expect(normalizeWord("   ")).toBeNull();
    expect(normalizeWord("two\nlines")).toBeNull();
  });

  it("длиннее MAX_WORD_LEN → null (мусор/предложение без пробелов)", () => {
    expect(normalizeWord("a".repeat(MAX_WORD_LEN))).toBe("a".repeat(MAX_WORD_LEN));
    expect(normalizeWord("a".repeat(MAX_WORD_LEN + 1))).toBeNull();
  });

  it("не-строка → null", () => {
    expect(normalizeWord(null)).toBeNull();
    expect(normalizeWord(42)).toBeNull();
  });
});

describe("extractContext", () => {
  const text = "Coral reefs are fragile. The ocean warms quickly now. Fish migrate away.";

  it("возвращает предложение вокруг выделения, схлопнутое и с терминатором", () => {
    const start = text.indexOf("warms");
    const end = start + "warms".length;
    expect(extractContext(text, start, end)).toBe("The ocean warms quickly now.");
  });

  it("первое предложение (левая граница = начало текста)", () => {
    const start = text.indexOf("fragile");
    expect(extractContext(text, start, start + "fragile".length)).toBe("Coral reefs are fragile.");
  });

  it("последнее предложение (правая граница = конец текста)", () => {
    const start = text.indexOf("migrate");
    expect(extractContext(text, start, start + "migrate".length)).toBe("Fish migrate away.");
  });

  it("схлопывает переносы/множественные пробелы", () => {
    const t = "Line one\n\n  spans   here. Next.";
    const start = t.indexOf("spans");
    expect(extractContext(t, start, start + "spans".length)).toBe("spans here.");
  });

  it("некорректный вход → пустая строка", () => {
    expect(extractContext(text, 5, 5)).toBe("");
    expect(extractContext(text, 10, 3)).toBe("");
    expect(extractContext(null, 0, 3)).toBe("");
  });

  it("сверхдлинное предложение (без пунктуации) — окно ≤ MAX и содержит слово", () => {
    const filler = "word ".repeat(200); // ~1000 симв., без терминаторов
    const marker = "TARGET";
    const long = filler + marker + " " + filler;
    const start = long.indexOf(marker);
    const ctx = extractContext(long, start, start + marker.length);
    expect(ctx.length).toBeLessThanOrEqual(MAX_CONTEXT_LEN);
    expect(ctx).toContain(marker);
  });
});
