// Юнит-тесты чистых предикатов бейджей (BRIEF §4.7). Относительный импорт — alias не нужен.
// isMet/badgeProgress детерминированы и работают над plain UserStats/Criteria — БД не трогаем.
import { describe, it, expect } from "vitest";
import { isMet, badgeProgress, type Criteria, type UserStats } from "./badge-criteria";

// Базовый «нулевой» стат: каждый тест переопределяет только нужные поля через { ...base }.
const base: UserStats = {
  rating: 0,
  currentStreak: 0,
  volume: 0,
  hasPerfect: false,
  perQtype: new Map(),
  isFirstPlaceGlobalAllTime: false,
};

describe("isMet", () => {
  describe("volume", () => {
    const c: Criteria = { type: "volume", tests: 10 };
    it("met на пороге и выше (>=, не >)", () => {
      expect(isMet(c, { ...base, volume: 10 })).toBe(true);
      expect(isMet(c, { ...base, volume: 11 })).toBe(true);
    });
    it("не-met ниже порога", () => {
      expect(isMet(c, { ...base, volume: 9 })).toBe(false);
    });
  });

  describe("streak", () => {
    const c: Criteria = { type: "streak", days: 7 };
    it("met на пороге", () => {
      expect(isMet(c, { ...base, currentStreak: 7 })).toBe(true);
    });
    it("не-met ниже порога", () => {
      expect(isMet(c, { ...base, currentStreak: 6 })).toBe(false);
    });
  });

  describe("rating", () => {
    const c: Criteria = { type: "rating", min: 1200 };
    it("met на пороге", () => {
      expect(isMet(c, { ...base, rating: 1200 })).toBe(true);
    });
    it("не-met ниже порога", () => {
      expect(isMet(c, { ...base, rating: 1199 })).toBe(false);
    });
  });

  describe("perfect", () => {
    const c: Criteria = { type: "perfect" };
    it("met при hasPerfect=true", () => {
      expect(isMet(c, { ...base, hasPerfect: true })).toBe(true);
    });
    it("не-met при hasPerfect=false", () => {
      expect(isMet(c, base)).toBe(false);
    });
  });

  describe("accuracy", () => {
    const c: Criteria = { type: "accuracy", qtype: "tfng", minQuestions: 20, minPct: 80 };
    it("met: выборка достаточна И % на пороге", () => {
      const perQtype = new Map([["tfng", { correct: 16, total: 20 }]]); // 80%
      expect(isMet(c, { ...base, perQtype })).toBe(true);
    });
    it("не-met: выборки хватает, но % ниже порога", () => {
      const perQtype = new Map([["tfng", { correct: 15, total: 20 }]]); // 75%
      expect(isMet(c, { ...base, perQtype })).toBe(false);
    });
    it("не-met: total < minQuestions, даже при 100% (не выдаём на малой выборке)", () => {
      const perQtype = new Map([["tfng", { correct: 19, total: 19 }]]); // 100%, но 19<20
      expect(isMet(c, { ...base, perQtype })).toBe(false);
    });
    it("не-met: по этому qtype нет агрегата вовсе", () => {
      expect(isMet(c, base)).toBe(false);
    });
    it("не-met: агрегат есть, но total=0 (защита от деления на ноль)", () => {
      const perQtype = new Map([["tfng", { correct: 0, total: 0 }]]);
      expect(isMet(c, { ...base, perQtype })).toBe(false);
    });
  });

  describe("first_place", () => {
    it("met только для global/all_time #1", () => {
      const c: Criteria = { type: "first_place", scope: "global", period: "all_time" };
      expect(isMet(c, { ...base, isFirstPlaceGlobalAllTime: true })).toBe(true);
    });
    it("не-met для global/all_time, если не #1", () => {
      const c: Criteria = { type: "first_place", scope: "global", period: "all_time" };
      expect(isMet(c, base)).toBe(false);
    });
    it("не-met для иного scope/period, даже когда пользователь #1 глобально", () => {
      const region: Criteria = { type: "first_place", scope: "region", period: "all_time" };
      const weekly: Criteria = { type: "first_place", scope: "global", period: "weekly" };
      const stats = { ...base, isFirstPlaceGlobalAllTime: true };
      expect(isMet(region, stats)).toBe(false);
      expect(isMet(weekly, stats)).toBe(false);
    });
  });

  it("неизвестный criteria.type → false (defensive)", () => {
    // невалидный дискриминант из jsonb не должен выдавать бейдж
    const bogus = { type: "galaxy_brain", min: 1 } as unknown as Criteria;
    expect(isMet(bogus, { ...base, rating: 9999, volume: 9999, hasPerfect: true })).toBe(false);
  });
});

describe("badgeProgress", () => {
  it("volume: ратио + hint вида 'N / M tests'", () => {
    const r = badgeProgress({ type: "volume", tests: 10 }, { ...base, volume: 3 });
    expect(r.pct).toBeCloseTo(0.3);
    expect(r.hint).toBe("3 / 10 tests");
  });

  it("клиппинг сверху до 1 при превышении порога (volume)", () => {
    const r = badgeProgress({ type: "volume", tests: 10 }, { ...base, volume: 25 });
    expect(r.pct).toBe(1);
    expect(r.hint).toBe("25 / 10 tests");
  });

  it("streak: ратио + hint 'N / M days'", () => {
    const r = badgeProgress({ type: "streak", days: 7 }, { ...base, currentStreak: 7 });
    expect(r.pct).toBe(1);
    expect(r.hint).toBe("7 / 7 days");
  });

  it("rating: ратио + hint 'N / M rating'", () => {
    const r = badgeProgress({ type: "rating", min: 1200 }, { ...base, rating: 600 });
    expect(r.pct).toBeCloseTo(0.5);
    expect(r.hint).toBe("600 / 1200 rating");
  });

  it("perfect: 0/подсказка пока не заработан, 1/Earned после", () => {
    const locked = badgeProgress({ type: "perfect" }, base);
    expect(locked.pct).toBe(0);
    expect(locked.hint).toBe("Score 100% on a test");
    const earned = badgeProgress({ type: "perfect" }, { ...base, hasPerfect: true });
    expect(earned.pct).toBe(1);
    expect(earned.hint).toBe("Earned");
  });

  it("accuracy: трекает видимый гейт 'answered', а не %", () => {
    // 5 отвечено из 20 нужных — pct по answered, не по доле верных
    const perQtype = new Map([["tfng", { correct: 5, total: 5 }]]);
    const r = badgeProgress(
      { type: "accuracy", qtype: "tfng", minQuestions: 20, minPct: 80 },
      { ...base, perQtype },
    );
    expect(r.pct).toBeCloseTo(0.25);
    expect(r.hint).toBe("5 / 20 answered");
  });

  it("accuracy: нет агрегата → 0 answered, без падения", () => {
    const r = badgeProgress(
      { type: "accuracy", qtype: "tfng", minQuestions: 20, minPct: 80 },
      base,
    );
    expect(r.pct).toBe(0);
    expect(r.hint).toBe("0 / 20 answered");
  });

  it("first_place: 0/подсказка пока не #1, 1/Earned после", () => {
    const c: Criteria = { type: "first_place", scope: "global", period: "all_time" };
    const locked = badgeProgress(c, base);
    expect(locked.pct).toBe(0);
    expect(locked.hint).toBe("Reach #1 globally");
    const earned = badgeProgress(c, { ...base, isFirstPlaceGlobalAllTime: true });
    expect(earned.pct).toBe(1);
    expect(earned.hint).toBe("Earned");
  });

  it("неизвестный criteria.type → pct 0, пустой hint (defensive)", () => {
    const bogus = { type: "galaxy_brain" } as unknown as Criteria;
    const r = badgeProgress(bogus, base);
    expect(r.pct).toBe(0);
    expect(r.hint).toBe("");
  });
});
