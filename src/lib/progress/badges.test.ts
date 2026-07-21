// Юнит-тесты чистых предикатов бейджей (BRIEF §4.7). Относительный импорт — alias не нужен.
// isMet/badgeProgress детерминированы и работают над plain UserStats/Criteria — БД не трогаем.
import { describe, it, expect } from "vitest";
import {
  isMet,
  badgeProgress,
  aggregateAttemptStats,
  type Criteria,
  type UserStats,
  type AttemptStatRow,
} from "./badge-criteria";

// Базовый «нулевой» стат: каждый тест переопределяет только нужные поля через { ...base }.
const base: UserStats = {
  rating: 0,
  currentStreak: 0,
  volume: 0,
  hasPerfect: false,
  perQtype: new Map(),
  isFirstPlaceGlobalAllTime: false,
  closedMistakesTotal: 0,
  closedByQtype: new Map(),
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

  describe("mistakes_closed", () => {
    const c: Criteria = { type: "mistakes_closed", count: 15 };
    it("met на пороге и выше (>=, не >)", () => {
      expect(isMet(c, { ...base, closedMistakesTotal: 15 })).toBe(true);
      expect(isMet(c, { ...base, closedMistakesTotal: 16 })).toBe(true);
    });
    it("не-met ниже порога", () => {
      expect(isMet(c, { ...base, closedMistakesTotal: 14 })).toBe(false);
    });
  });

  describe("weak_type_cleared", () => {
    const c: Criteria = { type: "weak_type_cleared", perType: 5 };
    it("met, если хотя бы один qtype достиг порога", () => {
      const closedByQtype = new Map([
        ["tfng", 2],
        ["matching_headings", 5],
      ]);
      expect(isMet(c, { ...base, closedByQtype })).toBe(true);
    });
    it("не-met, если закрытия размазаны по типам ниже порога", () => {
      const closedByQtype = new Map([
        ["tfng", 3],
        ["matching_headings", 4],
      ]);
      expect(isMet(c, { ...base, closedByQtype })).toBe(false);
    });
    it("не-met без закрытий вовсе", () => {
      expect(isMet(c, base)).toBe(false);
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

  it("accuracy: набрал вопросы, но точность низкая → прогресс по точности, не ложные 100%", () => {
    // 40 отвечено (≥20), 12 верных = 30% при пороге 80% → 0.375, а не 1.0
    const perQtype = new Map([["tfng", { correct: 12, total: 40 }]]);
    const r = badgeProgress(
      { type: "accuracy", qtype: "tfng", minQuestions: 20, minPct: 80 },
      { ...base, perQtype },
    );
    expect(r.pct).toBeCloseTo(0.375);
    expect(r.hint).toBe("30% / 80% accuracy");
  });

  it("accuracy: числитель answered не пробивает знаменатель в хинте (репро прод-бага 76/20)", () => {
    // Ровно прод-случай: наотвечал 76 при пороге 20, но мимо → не «76 / 20», не 100%
    const perQtype = new Map([["tfng", { correct: 30, total: 76 }]]);
    const r = badgeProgress(
      { type: "accuracy", qtype: "tfng", minQuestions: 20, minPct: 90 },
      { ...base, perQtype },
    );
    expect(r.hint).not.toContain("76");
    expect(r.pct).toBeLessThan(1);
    expect(r.hint).toBe("39% / 90% accuracy");
  });

  it("accuracy: набрал вопросы И точность → 100% (порог достигнут)", () => {
    const perQtype = new Map([["tfng", { correct: 38, total: 40 }]]);
    const r = badgeProgress(
      { type: "accuracy", qtype: "tfng", minQuestions: 20, minPct: 80 },
      { ...base, perQtype },
    );
    expect(r.pct).toBe(1);
    expect(r.hint).toBe("95% / 80% accuracy");
  });

  it("accuracy: у самого порога не показывает ложные 100% (89.6% из 224/250 при minPct 90)", () => {
    // isMet=false (89.6 < 90); округление pct*100 в hero не должно дать 100%,
    // а хинт — не «90% / 90%» (округление вверх пересекло бы порог).
    const perQtype = new Map([["tfng", { correct: 224, total: 250 }]]);
    const r = badgeProgress(
      { type: "accuracy", qtype: "tfng", minQuestions: 20, minPct: 90 },
      { ...base, perQtype },
    );
    expect(r.pct).toBeLessThanOrEqual(0.99);
    expect(Math.round(r.pct * 100)).toBeLessThan(100);
    expect(r.hint).toBe("89% / 90% accuracy");
  });

  it("accuracy: minPct=0 (вырожденный критерий) → без NaN", () => {
    const perQtype = new Map([["tfng", { correct: 0, total: 40 }]]);
    const r = badgeProgress(
      { type: "accuracy", qtype: "tfng", minQuestions: 20, minPct: 0 },
      { ...base, perQtype },
    );
    expect(Number.isFinite(r.pct)).toBe(true);
    expect(r.pct).toBe(1); // любая точность удовлетворяет порог 0 → isMet=true
  });

  it("rating: у самого порога незаработанный бейдж не округляется до 100% (1195/1200)", () => {
    const r = badgeProgress({ type: "rating", min: 1200 }, { ...base, rating: 1195 });
    expect(r.pct).toBeLessThanOrEqual(0.99);
    expect(Math.round(r.pct * 100)).toBeLessThan(100);
    expect(r.hint).toBe("1195 / 1200 rating");
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

  it("mistakes_closed: ратио + hint 'N / M mistakes closed'", () => {
    const r = badgeProgress({ type: "mistakes_closed", count: 15 }, { ...base, closedMistakesTotal: 3 });
    expect(r.pct).toBeCloseTo(0.2);
    expect(r.hint).toBe("3 / 15 mistakes closed");
  });

  it("mistakes_closed: клиппинг сверху до 1 при превышении порога", () => {
    const r = badgeProgress({ type: "mistakes_closed", count: 15 }, { ...base, closedMistakesTotal: 40 });
    expect(r.pct).toBe(1);
    expect(r.hint).toBe("40 / 15 mistakes closed");
  });

  it("weak_type_cleared: трекает лучший qtype, а не сумму по всем", () => {
    const closedByQtype = new Map([
      ["tfng", 2],
      ["matching_headings", 4],
    ]);
    const r = badgeProgress({ type: "weak_type_cleared", perType: 5 }, { ...base, closedByQtype });
    expect(r.pct).toBeCloseTo(0.8);
    expect(r.hint).toBe("4 / 5 closed in one weak type");
  });

  it("weak_type_cleared: без закрытий → 0 / perType, без падения", () => {
    const r = badgeProgress({ type: "weak_type_cleared", perType: 5 }, base);
    expect(r.pct).toBe(0);
    expect(r.hint).toBe("0 / 5 closed in one weak type");
  });

  it("неизвестный criteria.type → pct 0, пустой hint (defensive)", () => {
    const bogus = { type: "galaxy_brain" } as unknown as Criteria;
    const r = badgeProgress(bogus, base);
    expect(r.pct).toBe(0);
    expect(r.hint).toBe("");
  });
});

// Хелпер строки попытки: дата задаётся числом (мс), поля breakdown — по нужде.
function att(
  contentItemId: string,
  submittedMs: number | null,
  rawScore: number | null,
  perTypeBreakdown: AttemptStatRow["perTypeBreakdown"] = null,
): AttemptStatRow {
  return {
    contentItemId,
    rawScore,
    perTypeBreakdown,
    submittedAt: submittedMs == null ? null : new Date(submittedMs),
  };
}

describe("aggregateAttemptStats (анти-фарм пересдач)", () => {
  it("КРАСНЫЙ: две сдачи одного теста (30/40, затем 40/40) — perfect НЕ выдаётся, volume=1", () => {
    const rows = [
      att("t1", 1000, 30, { tfng: { correct: 20, total: 20 }, mcq: { correct: 10, total: 20 } }),
      att("t1", 2000, 40, { tfng: { correct: 20, total: 20 }, mcq: { correct: 20, total: 20 } }),
    ];
    const r = aggregateAttemptStats(rows);
    expect(r.volume).toBe(1); // тест засчитан один раз
    expect(r.hasPerfect).toBe(false); // первая попытка 30/40, а не 40/40
    // accuracy тоже по первой: tfng 20/20, mcq 10/20 — вторая не суммируется
    expect(r.perQtype.get("mcq")).toEqual({ correct: 10, total: 20 });
  });

  it("порядок строк не важен: поздняя пересдача первой в массиве не перебивает раннюю первую попытку", () => {
    const rows = [
      att("t1", 2000, 40, { mcq: { correct: 20, total: 20 } }), // пересдача идёт первой
      att("t1", 1000, 30, { mcq: { correct: 10, total: 20 } }), // но раньше по времени
    ];
    const r = aggregateAttemptStats(rows);
    expect(r.volume).toBe(1);
    expect(r.hasPerfect).toBe(false);
    expect(r.perQtype.get("mcq")).toEqual({ correct: 10, total: 20 });
  });

  it("volume считает разные тесты, но не пересдачи (2 теста × 2 попытки → volume=2)", () => {
    const rows = [
      att("t1", 1000, 30, { mcq: { correct: 15, total: 20 } }),
      att("t1", 5000, 40, { mcq: { correct: 20, total: 20 } }),
      att("t2", 2000, 20, { tfng: { correct: 10, total: 20 } }),
      att("t2", 6000, 40, { tfng: { correct: 20, total: 20 } }),
    ];
    const r = aggregateAttemptStats(rows);
    expect(r.volume).toBe(2);
  });

  it("perfect по первой попытке РАЗНОГО теста всё ещё выдаётся (не ломаем законный кейс)", () => {
    const rows = [
      att("t1", 1000, 30, { mcq: { correct: 30, total: 40 } }), // не perfect
      att("t2", 2000, 40, { mcq: { correct: 40, total: 40 } }), // perfect на первой сдаче
    ];
    const r = aggregateAttemptStats(rows);
    expect(r.hasPerfect).toBe(true);
    expect(r.volume).toBe(2);
  });

  it("accuracy суммирует qtype по первым попыткам разных тестов", () => {
    const rows = [
      att("t1", 1000, 30, { tfng: { correct: 8, total: 10 } }),
      att("t1", 9000, 40, { tfng: { correct: 10, total: 10 } }), // пересдача игнор
      att("t2", 2000, 30, { tfng: { correct: 7, total: 10 } }),
    ];
    const r = aggregateAttemptStats(rows);
    // 8/10 (t1 первая) + 7/10 (t2 первая) = 15/20, пересдача t1 не входит
    expect(r.perQtype.get("tfng")).toEqual({ correct: 15, total: 20 });
  });

  it("пустой breakdown/нулевой total не считается perfect (вырожденная попытка)", () => {
    const rows = [att("t1", 1000, 0, {}), att("t2", 2000, 0, null)];
    const r = aggregateAttemptStats(rows);
    expect(r.hasPerfect).toBe(false);
    expect(r.volume).toBe(2);
    expect(r.perQtype.size).toBe(0);
  });

  it("null submittedAt проигрывает датированной попытке (NULLS LAST — берётся датированная первая)", () => {
    const rows = [
      att("t1", null, 40, { mcq: { correct: 40, total: 40 } }), // без даты
      att("t1", 1000, 30, { mcq: { correct: 30, total: 40 } }), // датированная — первая
    ];
    const r = aggregateAttemptStats(rows);
    expect(r.volume).toBe(1);
    expect(r.hasPerfect).toBe(false); // датированная 30/40 выигрывает как первая
    expect(r.perQtype.get("mcq")).toEqual({ correct: 30, total: 40 });
  });

  it("пустой вход → нулевые статы", () => {
    const r = aggregateAttemptStats([]);
    expect(r.volume).toBe(0);
    expect(r.hasPerfect).toBe(false);
    expect(r.perQtype.size).toBe(0);
  });
});
