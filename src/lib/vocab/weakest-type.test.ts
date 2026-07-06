// Юнит-тесты чистой логики выбора слабейшего типа (без IO, без БД). Покрывают:
// пустые данные, порог достоверности, выбор минимума, агрегацию нескольких попыток.
import { describe, it, expect } from "vitest";
import { computeWeakestType, MIN_ATTEMPTS_FOR_WEAK_TYPE, type PerTypeBreakdown } from "./weakest-type";

describe("computeWeakestType", () => {
  it("пустой список попыток → null", () => {
    expect(computeWeakestType([])).toBeNull();
  });

  it("список из одних null-breakdown'ов → null", () => {
    expect(computeWeakestType([null, null])).toBeNull();
  });

  it("тип не набрал порог total → null", () => {
    expect(
      computeWeakestType([{ tfng: { correct: 1, total: MIN_ATTEMPTS_FOR_WEAK_TYPE - 1 } }]),
    ).toBeNull();
  });

  it("тип ровно на пороге total → учитывается", () => {
    expect(
      computeWeakestType([{ tfng: { correct: 3, total: MIN_ATTEMPTS_FOR_WEAK_TYPE } }]),
    ).toBe("tfng");
  });

  it("выбирает тип с минимальной точностью среди прошедших порог", () => {
    const breakdown = {
      tfng: { correct: 5, total: 6 }, // 0.83
      matching_headings: { correct: 2, total: 8 }, // 0.25 — слабейший
      mcq_single: { correct: 4, total: 8 }, // 0.5
    };
    expect(computeWeakestType([breakdown])).toBe("matching_headings");
  });

  it("тип с высокой точностью, но малым total не выбирается вместо прошедшего порог", () => {
    const breakdown = {
      tfng: { correct: 0, total: 2 }, // 0 точность, но ниже порога
      matching_headings: { correct: 3, total: 6 }, // 0.5, единственный прошедший порог
    };
    expect(computeWeakestType([breakdown])).toBe("matching_headings");
  });

  it("агрегирует по типу через несколько попыток, включая null-попытки между ними", () => {
    const breakdowns: Array<PerTypeBreakdown | null> = [
      { matching_headings: { correct: 2, total: 3 } },
      null,
      { matching_headings: { correct: 1, total: 3 } },
      { tfng: { correct: 8, total: 8 } },
    ];
    // matching_headings: correct=3 total=6 → 0.5; tfng: correct=8 total=8 → 1.0
    expect(computeWeakestType(breakdowns)).toBe("matching_headings");
  });

  it("все типы с 100% точностью и total >= порога → возвращает один из них, не null", () => {
    const breakdown = { tfng: { correct: 6, total: 6 } };
    expect(computeWeakestType([breakdown])).toBe("tfng");
  });
});
