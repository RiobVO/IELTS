// Юнит-тесты чистой агрегации Weak spots (aggregateWeakness). Контракт: суммирует
// per_type_breakdown нескольких попыток по qtype, отбрасывает типы ниже min-порога
// надёжности, сортирует слабейшие первыми (tiebreak — больше total), не падает на
// битых/null записях.
import { describe, it, expect } from "vitest";
import { aggregateWeakness } from "./weakness";

describe("aggregateWeakness", () => {
  it("пустой вход → пустой результат", () => {
    expect(aggregateWeakness([])).toEqual([]);
  });

  it("тип ниже min-порога (total < 4 по умолчанию) не показывается", () => {
    const out = aggregateWeakness([{ tfng: { correct: 1, total: 3 } }]);
    expect(out).toEqual([]);
  });

  it("тип на пороге (total === 4) показывается", () => {
    const out = aggregateWeakness([{ tfng: { correct: 1, total: 4 } }]);
    expect(out).toEqual([{ qtype: "tfng", correct: 1, total: 4, pct: 25 }]);
  });

  it("суммирует несколько попыток по одному qtype", () => {
    const out = aggregateWeakness([
      { tfng: { correct: 1, total: 3 } },
      { tfng: { correct: 2, total: 3 } },
    ]);
    expect(out).toEqual([{ qtype: "tfng", correct: 3, total: 6, pct: 50 }]);
  });

  it("сортирует слабейшие первыми (низкий pct выше)", () => {
    const out = aggregateWeakness([
      { tfng: { correct: 8, total: 10 } },
      { mcq_single: { correct: 2, total: 10 } },
      { matching_headings: { correct: 5, total: 10 } },
    ]);
    expect(out.map((r) => r.qtype)).toEqual(["mcq_single", "matching_headings", "tfng"]);
  });

  it("при равном pct надёжнее (больше total) идёт выше", () => {
    const out = aggregateWeakness([
      { a: { correct: 1, total: 4 } },
      { b: { correct: 2, total: 8 } },
    ]);
    expect(out.map((r) => r.qtype)).toEqual(["b", "a"]);
  });

  it("применяет custom minTotal и limit", () => {
    const out = aggregateWeakness(
      [
        { a: { correct: 0, total: 10 } },
        { b: { correct: 1, total: 10 } },
        { c: { correct: 2, total: 10 } },
      ],
      { minTotal: 1, limit: 2 },
    );
    expect(out.map((r) => r.qtype)).toEqual(["a", "b"]);
  });

  it("null/undefined breakdown в списке не роняет агрегацию", () => {
    const out = aggregateWeakness([null, undefined, { tfng: { correct: 2, total: 4 } }]);
    expect(out).toEqual([{ qtype: "tfng", correct: 2, total: 4, pct: 50 }]);
  });

  it("битые записи (не число / отрицательный total / не объект) игнорируются", () => {
    // Симулирует непроверенный JSON из БД — намеренно нарушает объявленный тип поля.
    const broken = {
      broken1: { correct: "x", total: 4 },
      broken2: null,
      broken3: { correct: 1, total: -1 },
      broken4: { correct: 1, total: 0 },
      ok: { correct: 1, total: 4 },
    } as unknown as Record<string, { correct?: unknown; total?: unknown }>;
    const out = aggregateWeakness([broken]);
    expect(out).toEqual([{ qtype: "ok", correct: 1, total: 4, pct: 25 }]);
  });
});
