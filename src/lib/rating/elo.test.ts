// Юнит-тесты Elo-математики (BRIEF §4.6). Чистые функции, без I/O.
// Ожидаемые значения — свойства/ручной счёт, а не пересчёт самой формулы.
import { describe, it, expect } from "vitest";
import { expectedScore, ratingDeltas, ELO_K } from "./elo";

describe("expectedScore", () => {
  it("при равных рейтингах равен ровно 0.5", () => {
    expect(expectedScore(1500, 1500)).toBe(0.5);
  });

  it("выше рейтинг A → ожидание > 0.5 (и < 1)", () => {
    const e = expectedScore(1200, 1000);
    expect(e).toBeGreaterThan(0.5);
    expect(e).toBeLessThan(1);
  });

  it("симметричен: E(A,B) + E(B,A) = 1", () => {
    expect(expectedScore(1234, 987) + expectedScore(987, 1234)).toBeCloseTo(1, 10);
  });
});

describe("ratingDeltas", () => {
  it("нулевая сумма: пользователь получает ровно то, что теряет тест", () => {
    const r = ratingDeltas(1100, 900, 0.4); // несимметричный кейс
    expect(r.userDelta).toBe(-r.testDelta);
  });

  it("знак дельты следует за результатом относительно ожидания", () => {
    const above = ratingDeltas(1000, 1000, 1); // perf 1 > ожидание 0.5
    const below = ratingDeltas(1000, 1000, 0); // perf 0 < ожидание 0.5
    const exact = ratingDeltas(1000, 1000, 0.5); // perf == ожидание
    expect(above.userDelta).toBeGreaterThan(0);
    expect(above.testDelta).toBeLessThan(0);
    expect(below.userDelta).toBeLessThan(0);
    expect(exact.userDelta).toBe(0);
  });

  it("округляет дельту до целого (12.5 → 13, ловит floor/trunc)", () => {
    // равные рейтинги → ожидание ровно 0.5; k*(1-0.5) = 25*0.5 = 12.5
    const r = ratingDeltas(1000, 1000, 1, 25);
    expect(r.userDelta).toBe(13);
    expect(Number.isInteger(r.userDelta)).toBe(true);
  });

  it("масштабируется по K и по умолчанию использует ELO_K", () => {
    // при равных рейтингах и perf=1 дельта = k*0.5
    expect(ratingDeltas(1000, 1000, 1, 12).userDelta).toBe(6);
    expect(ratingDeltas(1000, 1000, 1, 24).userDelta).toBe(12);
    expect(ratingDeltas(1000, 1000, 1).userDelta).toBe(
      ratingDeltas(1000, 1000, 1, ELO_K).userDelta,
    );
  });
});
