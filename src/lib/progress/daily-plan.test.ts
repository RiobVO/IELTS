// Юнит-тесты чистого computeDailyPlan. Файл также содержит owner-путь загрузчики
// (getMistakesDueSummary/getCatalogAvailability) — мокаем @/db, чтобы тест грузил
// чистую логику без БД/env (паттерн band-plan.test.ts).
import { describe, it, expect, vi } from "vitest";
vi.mock("@/db", () => ({ db: {} }));
import { computeDailyPlan, type DailyPlanInput } from "./daily-plan";
import type { BandPlanDrill, BandPlanWeakType } from "./band-plan";

/** Билдер входа с дефолтами — тесты переопределяют только нужные поля. */
function mkInput(overrides: Partial<DailyPlanInput> = {}): DailyPlanInput {
  return {
    daysUntilExam: null,
    drill: null,
    secondDrill: null,
    mistakes: { due: 0, reviewedToday: 0 },
    vocab: { dueToday: 5, reviewedToday: 0, goal: 10 },
    drillDoneToday: false,
    mockDoneThisWeek: false,
    hasAttempts: true,
    catalog: { hasPublishedTests: true, fullMockCategory: "full_reading" as const },
    ...overrides,
  };
}

const drill1: BandPlanDrill = {
  qtype: "tfng",
  label: "True / False / Not Given",
  section: "reading",
  estMinutes: 15,
  bandGain: 0.5,
};

const weak2: BandPlanWeakType = {
  qtype: "matching_headings",
  label: "Matching Headings",
  section: "reading",
  correct: 2,
  total: 8,
  pct: 25,
};

const kinds = (plan: ReturnType<typeof computeDailyPlan>) => plan.items.map((i) => i.kind);

describe("computeDailyPlan — intensity по daysUntilExam", () => {
  it("null (дата не задана) → generic, 3 пункта, examPassed=false", () => {
    const plan = computeDailyPlan(mkInput({ daysUntilExam: null }));
    expect(plan.intensity).toBe("generic");
    expect(plan.examDateSet).toBe(false);
    expect(plan.examPassed).toBe(false);
    expect(kinds(plan)).toEqual(["mistakes", "vocab", "drill"]);
  });

  it("40 (>28) → base, те же 3 пункта", () => {
    const plan = computeDailyPlan(mkInput({ daysUntilExam: 40 }));
    expect(plan.intensity).toBe("base");
    expect(kinds(plan)).toEqual(["mistakes", "vocab", "drill"]);
  });

  it("20 (8..28) → ramp, + mock (4 пункта)", () => {
    const plan = computeDailyPlan(mkInput({ daysUntilExam: 20 }));
    expect(plan.intensity).toBe("ramp");
    expect(kinds(plan)).toEqual(["mistakes", "vocab", "drill", "mock"]);
  });

  it("5 (0..7) + secondDrill → final, 5 пунктов (+ drill2)", () => {
    const plan = computeDailyPlan(mkInput({ daysUntilExam: 5, secondDrill: weak2 }));
    expect(plan.intensity).toBe("final");
    expect(kinds(plan)).toEqual(["mistakes", "vocab", "drill", "drill2", "mock"]);
  });

  it("5 (0..7) без secondDrill → final, 4 пункта (drill2 выпал)", () => {
    const plan = computeDailyPlan(mkInput({ daysUntilExam: 5 }));
    expect(plan.intensity).toBe("final");
    expect(kinds(plan)).toEqual(["mistakes", "vocab", "drill", "mock"]);
  });

  it("-3 (прошла) → generic + examPassed=true, без краша", () => {
    const plan = computeDailyPlan(mkInput({ daysUntilExam: -3 }));
    expect(plan.intensity).toBe("generic");
    expect(plan.examDateSet).toBe(true);
    expect(plan.examPassed).toBe(true);
    expect(kinds(plan)).toEqual(["mistakes", "vocab", "drill"]);
  });

  it("0 → final (нижняя граница включительно)", () => {
    const plan = computeDailyPlan(mkInput({ daysUntilExam: 0 }));
    expect(plan.intensity).toBe("final");
    expect(plan.examPassed).toBe(false);
    expect(kinds(plan)).toEqual(["mistakes", "vocab", "drill", "mock"]);
  });

  it("границы 28/29: 28 → ramp, 29 → base", () => {
    expect(computeDailyPlan(mkInput({ daysUntilExam: 28 })).intensity).toBe("ramp");
    expect(computeDailyPlan(mkInput({ daysUntilExam: 29 })).intensity).toBe("base");
  });

  it("границы 7/8: 7 → final, 8 → ramp", () => {
    expect(computeDailyPlan(mkInput({ daysUntilExam: 7 })).intensity).toBe("final");
    expect(computeDailyPlan(mkInput({ daysUntilExam: 8 })).intensity).toBe("ramp");
  });
});

describe("computeDailyPlan — гейты по каталогу", () => {
  it("пустой каталог (hasPublishedTests=false) → drill и mock выпали, даже в ramp", () => {
    const plan = computeDailyPlan(
      mkInput({ daysUntilExam: 20, catalog: { hasPublishedTests: false, fullMockCategory: null } }),
    );
    expect(kinds(plan)).toEqual(["mistakes", "vocab"]);
  });

  it("fullMockCategory=null → mock выпал, drill остался", () => {
    const plan = computeDailyPlan(
      mkInput({ daysUntilExam: 20, catalog: { hasPublishedTests: true, fullMockCategory: null } }),
    );
    expect(kinds(plan)).toEqual(["mistakes", "vocab", "drill"]);
  });

  it("каталог только с full-listening → mock-href ведёт в listening-фильтр, не в пустой reading", () => {
    const plan = computeDailyPlan(
      mkInput({
        daysUntilExam: 20,
        catalog: { hasPublishedTests: true, fullMockCategory: "full_listening" as const },
      }),
    );
    const mock = plan.items.find((i) => i.kind === "mock");
    expect(mock?.href).toBe("/app/practice?category=full_listening");
  });
});

describe("computeDailyPlan — drill без bandPlan.drill", () => {
  it("drill=null, каталог непуст, hasAttempts → «Practice a test» на /app/practice", () => {
    const plan = computeDailyPlan(mkInput({ drill: null, hasAttempts: true }));
    const item = plan.items.find((i) => i.kind === "drill")!;
    expect(item.label).toBe("Practice a test");
    expect(item.href).toBe("/app/practice");
  });

  it("drill=null, !hasAttempts → «Take your first test», mistakes выпал", () => {
    const plan = computeDailyPlan(mkInput({ drill: null, hasAttempts: false }));
    expect(kinds(plan)).toEqual(["vocab", "drill"]);
    const item = plan.items.find((i) => i.kind === "drill")!;
    expect(item.label).toBe("Take your first test");
  });

  it("drill задан → «Drill {label}», href с q_type", () => {
    const plan = computeDailyPlan(mkInput({ drill: drill1 }));
    const item = plan.items.find((i) => i.kind === "drill")!;
    expect(item.label).toBe("Drill True / False / Not Given");
    expect(item.href).toBe("/app/practice?q_type=tfng");
  });
});

describe("computeDailyPlan — done-правила и allDone", () => {
  it("всё done → allDone=true, doneCount===totalCount", () => {
    const plan = computeDailyPlan(
      mkInput({
        daysUntilExam: 20,
        mistakes: { due: 0, reviewedToday: 3 },
        vocab: { dueToday: 0, reviewedToday: 0, goal: 10 },
        drillDoneToday: true,
        mockDoneThisWeek: true,
      }),
    );
    expect(plan.allDone).toBe(true);
    expect(plan.doneCount).toBe(plan.totalCount);
    expect(plan.totalCount).toBe(4);
  });

  it("due=0 + hasAttempts → «Review your mistakes» без числа, done=true", () => {
    const plan = computeDailyPlan(mkInput({ mistakes: { due: 0, reviewedToday: 0 } }));
    const item = plan.items.find((i) => i.kind === "mistakes")!;
    expect(item.label).toBe("Review your mistakes");
    expect(item.done).toBe(true);
  });

  it("due>0 → «Review {due}+ due mistakes», done=false", () => {
    const plan = computeDailyPlan(mkInput({ mistakes: { due: 5, reviewedToday: 0 } }));
    const item = plan.items.find((i) => i.kind === "mistakes")!;
    expect(item.label).toBe("Review 5+ due mistakes");
    expect(item.done).toBe(false);
  });

  it("!hasAttempts → mistakes выпал целиком", () => {
    const plan = computeDailyPlan(mkInput({ hasAttempts: false, mistakes: { due: 5, reviewedToday: 0 } }));
    expect(kinds(plan)).not.toContain("mistakes");
  });

  it("vocab done при dueToday=0, даже если reviewedToday < goal", () => {
    const plan = computeDailyPlan(mkInput({ vocab: { dueToday: 0, reviewedToday: 1, goal: 10 } }));
    const item = plan.items.find((i) => i.kind === "vocab")!;
    expect(item.done).toBe(true);
  });

  it("vocab done при reviewedToday>=goal, даже если dueToday>0", () => {
    const plan = computeDailyPlan(mkInput({ vocab: { dueToday: 3, reviewedToday: 10, goal: 10 } }));
    const item = plan.items.find((i) => i.kind === "vocab")!;
    expect(item.done).toBe(true);
  });
});

describe("computeDailyPlan — порядок и vocab target/progress", () => {
  it("порядок фиксирован (mistakes → vocab → drill → drill2 → mock) независимо от done", () => {
    const plan = computeDailyPlan(
      mkInput({
        daysUntilExam: 5,
        secondDrill: weak2,
        mistakes: { due: 0, reviewedToday: 0 }, // done
        drillDoneToday: false, // не done
        mockDoneThisWeek: true, // done
      }),
    );
    expect(kinds(plan)).toEqual(["mistakes", "vocab", "drill", "drill2", "mock"]);
  });

  it("vocab.target=goal, vocab.progress=reviewedToday", () => {
    const plan = computeDailyPlan(mkInput({ vocab: { dueToday: 4, reviewedToday: 3, goal: 10 } }));
    const item = plan.items.find((i) => i.kind === "vocab")!;
    expect(item.target).toBe(10);
    expect(item.progress).toBe(3);
  });
});

describe("computeDailyPlan — пустой вход", () => {
  it("минимальный вход (нет попыток, каталог пуст) → минимум vocab-пункт", () => {
    const plan = computeDailyPlan(
      mkInput({ hasAttempts: false, catalog: { hasPublishedTests: false, fullMockCategory: null } }),
    );
    expect(kinds(plan)).toEqual(["vocab"]);
    expect(plan.totalCount).toBe(1);
  });
});
