// Юнит-тесты чистого computeBandPlan. band-plan.ts также содержит owner-путь
// getBandPlan (импортирует @/db → @/env с валидацией секретов при загрузке) —
// мокаем @/db, чтобы тест грузил чистую логику без БД/env (паттерн access.test.ts).
// getBandPlan — тонкая обёртка (owner-путь), тестами здесь не покрыта.
import { describe, it, expect, vi } from "vitest";
vi.mock("@/db", () => ({ db: {} }));
import { computeBandPlan, type BandPlanAttempt } from "./band-plan";

/** Билдер попытки с дефолтами — тесты переопределяют только нужные поля. */
function mkAttempt(overrides: Partial<BandPlanAttempt> = {}): BandPlanAttempt {
  return {
    bandScore: null,
    rawScore: null,
    perTypeBreakdown: null,
    section: "reading",
    bandScale: null,
    submittedAt: null,
    ...overrides,
  };
}

describe("computeBandPlan — пустой вход", () => {
  it("пустой список попыток и без target → пустой план", () => {
    const plan = computeBandPlan([], null);
    expect(plan).toEqual({
      currentBand: null,
      targetBand: null,
      distance: null,
      reached: false,
      weakTypes: [],
      drill: null,
    });
  });
});

describe("computeBandPlan — currentBand", () => {
  it("нет banded-попыток (все bandScore=null) → currentBand=null, distance/reached не считаются", () => {
    const attempts = [mkAttempt({ bandScore: null }), mkAttempt({ bandScore: null })];
    const plan = computeBandPlan(attempts, 7);
    expect(plan.currentBand).toBeNull();
    expect(plan.distance).toBeNull();
    expect(plan.reached).toBe(false);
  });

  it("берёт первую (most-recent-first) banded-попытку, а не среднее/минимум", () => {
    const attempts = [mkAttempt({ bandScore: 6.5 }), mkAttempt({ bandScore: 5.5 })];
    const plan = computeBandPlan(attempts, 7);
    expect(plan.currentBand).toBe(6.5);
  });
});

describe("computeBandPlan — distance/reached", () => {
  it("distance = target − current, цель ещё не достигнута", () => {
    const plan = computeBandPlan([mkAttempt({ bandScore: 6 })], 7);
    expect(plan.distance).toBe(1);
    expect(plan.reached).toBe(false);
  });

  it("current > target → distance=0 (не отрицательный), reached=true", () => {
    const plan = computeBandPlan([mkAttempt({ bandScore: 7.5 })], 7);
    expect(plan.distance).toBe(0);
    expect(plan.reached).toBe(true);
  });

  it("current === target → reached=true, distance=0", () => {
    const plan = computeBandPlan([mkAttempt({ bandScore: 6 })], 6);
    expect(plan.distance).toBe(0);
    expect(plan.reached).toBe(true);
  });

  it("нет target (null) → distance=null, reached=false", () => {
    const plan = computeBandPlan([mkAttempt({ bandScore: 6 })], null);
    expect(plan.distance).toBeNull();
    expect(plan.reached).toBe(false);
  });
});

describe("computeBandPlan — weakTypes (порог aggregateWeakness min-total=4)", () => {
  it("тип с total < 4 не попадает в weakTypes (шум, не сигнал)", () => {
    const attempts = [mkAttempt({ perTypeBreakdown: { matching_headings: { correct: 1, total: 3 } } })];
    const plan = computeBandPlan(attempts, null);
    expect(plan.weakTypes).toEqual([]);
  });

  it("тип с total >= 4 попадает, correct/total/pct/label верны", () => {
    const attempts = [mkAttempt({ perTypeBreakdown: { tfng: { correct: 4, total: 10 } } })];
    const plan = computeBandPlan(attempts, null);
    expect(plan.weakTypes).toHaveLength(1);
    expect(plan.weakTypes[0]).toMatchObject({
      qtype: "tfng",
      label: "True / False / Not Given",
      correct: 4,
      total: 10,
      pct: 40,
    });
  });

  it("section — атрибуция по секции, где реально теряются очки (больше missed)", () => {
    const attempts = [
      mkAttempt({ section: "reading", perTypeBreakdown: { tfng: { correct: 9, total: 10 } } }), // missed 1
      mkAttempt({ section: "listening", perTypeBreakdown: { tfng: { correct: 0, total: 10 } } }), // missed 10
    ];
    const plan = computeBandPlan(attempts, null);
    expect(plan.weakTypes[0].section).toBe("listening");
  });

  it("ничья по missed между секциями → reading (больший каталог)", () => {
    const attempts = [
      mkAttempt({ section: "reading", perTypeBreakdown: { tfng: { correct: 5, total: 10 } } }),
      mkAttempt({ section: "listening", perTypeBreakdown: { tfng: { correct: 5, total: 10 } } }),
    ];
    const plan = computeBandPlan(attempts, null);
    expect(plan.weakTypes[0].section).toBe("reading");
  });
});

describe("computeBandPlan — drill", () => {
  it("нет weak-типов → drill=null", () => {
    const plan = computeBandPlan([], null);
    expect(plan.drill).toBeNull();
  });

  it("bandGain=null без band_scale (шкалы нет ни у одной попытки)", () => {
    const attempts = [
      mkAttempt({
        bandScore: 6,
        rawScore: 26,
        bandScale: null,
        perTypeBreakdown: { tfng: { correct: 4, total: 10 } },
      }),
    ];
    const plan = computeBandPlan(attempts, null);
    expect(plan.drill).not.toBeNull();
    expect(plan.drill?.bandGain).toBeNull();
    expect(plan.drill?.estMinutes).toBeGreaterThan(0);
  });

  it("bandGain считается через bandForScore при наличии band_scale", () => {
    const attempts = [
      mkAttempt({
        bandScore: 6,
        rawScore: 20,
        bandScale: { "20": 6.0, "24": 7.0 },
        perTypeBreakdown: { matching_headings: { correct: 2, total: 6 } }, // missed 4 → rawScore+4=24
      }),
    ];
    const plan = computeBandPlan(attempts, null);
    expect(plan.drill?.qtype).toBe("matching_headings");
    expect(plan.drill?.bandGain).toBe(1);
    expect(plan.drill?.estMinutes).toBe(5);
  });

  it("gain < 0.5 band не засчитывается (bandGain=null)", () => {
    const attempts = [
      mkAttempt({
        bandScore: 6,
        rawScore: 20,
        bandScale: { "20": 6.0, "24": 6.2 },
        perTypeBreakdown: { matching_headings: { correct: 2, total: 6 } },
      }),
    ];
    const plan = computeBandPlan(attempts, null);
    expect(plan.drill?.bandGain).toBeNull();
  });
});

describe("computeBandPlan — детерминизм", () => {
  it("одинаковый вход → идентичный результат", () => {
    const attempts = [
      mkAttempt({ bandScore: 6, rawScore: 20, bandScale: { "20": 6.0 }, perTypeBreakdown: { tfng: { correct: 4, total: 10 } } }),
    ];
    const a = computeBandPlan(attempts, 7);
    const b = computeBandPlan(attempts, 7);
    expect(a).toEqual(b);
  });
});
