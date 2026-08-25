// Юнит-тесты чистого computeExamPlan (G2-2). Мокаем @/db, потому что модуль тянет
// intensityFor из daily-plan.ts, а тот — owner-путь загрузчики (паттерн daily-plan.test.ts).
import { describe, it, expect, vi } from "vitest";
vi.mock("@/db", () => ({ db: {} }));
import { computeExamPlan, type ExamPlanInput, type ExamPlanWeakType } from "./exam-plan";

const tfng: ExamPlanWeakType = { qtype: "tfng", label: "True / False / Not Given" };
const headings: ExamPlanWeakType = { qtype: "matching_headings", label: "Matching Headings" };

function mkInput(overrides: Partial<ExamPlanInput> = {}): ExamPlanInput {
  return {
    daysUntilExam: 30,
    hasAttempts: true,
    weakest: tfng,
    second: headings,
    mocksThisWeek: 0,
    ...overrides,
  };
}

describe("computeExamPlan — фазы и их границы", () => {
  it("29 дней (>28) → base: 1 мок и 4 дня занятий в неделю", () => {
    const plan = computeExamPlan(mkInput({ daysUntilExam: 29 }));
    expect(plan?.phase).toBe("base");
    expect(plan?.rhythm).toEqual({ mocks: 1, studyDays: 4 });
  });

  it("28 дней → ramp (граница включительно): 2 мока и 5 дней", () => {
    const plan = computeExamPlan(mkInput({ daysUntilExam: 28 }));
    expect(plan?.phase).toBe("ramp");
    expect(plan?.rhythm).toEqual({ mocks: 2, studyDays: 5 });
  });

  it("8 дней → ещё ramp, 7 дней → уже final", () => {
    expect(computeExamPlan(mkInput({ daysUntilExam: 8 }))?.phase).toBe("ramp");
    expect(computeExamPlan(mkInput({ daysUntilExam: 7 }))?.phase).toBe("final");
  });

  it("final держит ОДИН мок в неделю — на большее нет времени разобрать ошибки", () => {
    expect(computeExamPlan(mkInput({ daysUntilExam: 3 }))?.rhythm.mocks).toBe(1);
  });
});

describe("computeExamPlan — когда карточки нет", () => {
  it("дата не задана → null (призыв задать её несёт countdown-карточка)", () => {
    expect(computeExamPlan(mkInput({ daysUntilExam: null }))).toBeNull();
  });

  it("экзамен сегодня → null", () => {
    expect(computeExamPlan(mkInput({ daysUntilExam: 0 }))).toBeNull();
  });

  it("дата прошла → null", () => {
    expect(computeExamPlan(mkInput({ daysUntilExam: -3 }))).toBeNull();
  });

  it("NaN (битая дата/таймзона) → null, а не план на NaN недель", () => {
    expect(computeExamPlan(mkInput({ daysUntilExam: NaN }))).toBeNull();
  });
});

describe("computeExamPlan — фокус недели", () => {
  it("base: только слабейший тип, второй не размывает фокус", () => {
    const plan = computeExamPlan(mkInput({ daysUntilExam: 40 }));
    expect(plan?.focus).toEqual([tfng]);
  });

  it("final: два типа — второй добавляется только в последнюю неделю", () => {
    const plan = computeExamPlan(mkInput({ daysUntilExam: 5 }));
    expect(plan?.focus).toEqual([tfng, headings]);
  });

  it("final без второго типа → один, без дыры в списке", () => {
    const plan = computeExamPlan(mkInput({ daysUntilExam: 5, second: null }));
    expect(plan?.focus).toEqual([tfng]);
  });

  it("нет попыток → фокуса нет вовсе, план начинается с калибровки", () => {
    const plan = computeExamPlan(mkInput({ hasAttempts: false, daysUntilExam: 20 }));
    expect(plan?.needsCalibration).toBe(true);
    expect(plan?.focus).toEqual([]);
  });

  it("попытки есть, но слабый тип не выделен → фокус пуст, калибровка не нужна", () => {
    const plan = computeExamPlan(mkInput({ weakest: null, second: null }));
    expect(plan?.needsCalibration).toBe(false);
    expect(plan?.focus).toEqual([]);
  });
});

describe("computeExamPlan — недели и прогресс моков", () => {
  it("недели округляются ВВЕРХ: 1 день и 6 дней — одинаково последняя неделя", () => {
    expect(computeExamPlan(mkInput({ daysUntilExam: 1 }))?.weeksLeft).toBe(1);
    expect(computeExamPlan(mkInput({ daysUntilExam: 6 }))?.weeksLeft).toBe(1);
    expect(computeExamPlan(mkInput({ daysUntilExam: 8 }))?.weeksLeft).toBe(2);
  });

  it("остаток моков недели не уходит в минус при перевыполнении", () => {
    const plan = computeExamPlan(mkInput({ daysUntilExam: 20, mocksThisWeek: 5 }));
    expect(plan?.mocksLeftThisWeek).toBe(0);
    expect(plan?.mocksThisWeek).toBe(5);
  });

  it("дистанция в моках = недели × норма фазы", () => {
    const plan = computeExamPlan(mkInput({ daysUntilExam: 21 }));
    expect(plan?.weeksLeft).toBe(3);
    expect(plan?.mocksTotalLeft).toBe(6); // ramp: 2 мока в неделю
  });

  it("экзамен завтра → флаг разгрузочного дня", () => {
    expect(computeExamPlan(mkInput({ daysUntilExam: 1 }))?.restDayAhead).toBe(true);
    expect(computeExamPlan(mkInput({ daysUntilExam: 2 }))?.restDayAhead).toBe(false);
  });
});
