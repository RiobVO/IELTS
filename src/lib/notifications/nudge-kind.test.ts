// Обе стороны метрики открываемости (G2-3) читают ОДИН словарь: если продюсер и
// клик разойдутся в написании, числитель и знаменатель посчитаются по пустому
// пересечению — молча, без единой ошибки. Эти тесты пиннят строки.
import { describe, it, expect } from "vitest";
import { toNudgeKind } from "./nudge-kind";

describe("toNudgeKind", () => {
  it("переводит подтипы напоминаний в словарь телеметрии", () => {
    expect(toNudgeKind("vocab_due_reminder")).toBe("vocab_due");
    expect(toNudgeKind("streak_reminder")).toBe("streak");
    expect(toNudgeKind("weekly_digest")).toBe("weekly_digest");
    expect(toNudgeKind("reactivation")).toBe("reactivation");
  });

  it("не-напоминания дают null — открытие бейджа не идёт в открываемость рассылки", () => {
    expect(toNudgeKind("badge_unlocked")).toBeNull();
    expect(toNudgeKind("payment")).toBeNull();
    expect(toNudgeKind("system")).toBeNull();
  });

  it("пустой/отсутствующий kind → null, без исключений", () => {
    expect(toNudgeKind(null)).toBeNull();
    expect(toNudgeKind(undefined)).toBeNull();
    expect(toNudgeKind("")).toBeNull();
  });
});
