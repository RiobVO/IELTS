// Отбор реактивации (G2-4) держится на двух чистых вещах: дате «ровно N дней назад»
// и ключе дедупа. Ошибка в первой рассылает письма не тем, во второй — дублирует
// письмо при повторном прогоне крона.
import { describe, it, expect } from "vitest";
import {
  REACTIVATION_THRESHOLD_DAYS,
  reactivationDedupKey,
  shiftUtcDateStr,
} from "./schedule";

describe("shiftUtcDateStr", () => {
  it("сдвигает на календарные дни назад", () => {
    expect(shiftUtcDateStr("2026-08-05", 7)).toBe("2026-07-29");
    expect(shiftUtcDateStr("2026-08-05", 14)).toBe("2026-07-22");
  });

  it("переходит через границу месяца и года", () => {
    expect(shiftUtcDateStr("2026-03-03", 7)).toBe("2026-02-24");
    expect(shiftUtcDateStr("2026-01-05", 14)).toBe("2025-12-22");
  });

  it("високосный февраль не теряет день", () => {
    expect(shiftUtcDateStr("2028-03-01", 1)).toBe("2028-02-29");
  });
});

describe("reactivationDedupKey", () => {
  it("различает пороги — письмо на 14-й день не гасится семидневным", () => {
    expect(reactivationDedupKey(7, "2026-08-05")).not.toBe(reactivationDedupKey(14, "2026-08-05"));
  });

  it("в пределах дня ключ стабилен — повторный прогон крона схлопывается", () => {
    expect(reactivationDedupKey(7, "2026-08-05")).toBe(reactivationDedupKey(7, "2026-08-05"));
  });

  it("новый эпизод тишины в другой день даёт новый ключ", () => {
    expect(reactivationDedupKey(7, "2026-08-05")).not.toBe(reactivationDedupKey(7, "2026-09-20"));
  });
});

describe("пороги", () => {
  it("их два и они возрастают: одно напоминание, одно повторное, дальше молчим", () => {
    expect([...REACTIVATION_THRESHOLD_DAYS]).toEqual([7, 14]);
  });
});
