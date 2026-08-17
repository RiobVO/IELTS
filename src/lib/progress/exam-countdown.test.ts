import { describe, it, expect } from "vitest";
import { daysUntilExam, examCountdownStatus, getExamCountdown, validExamDate } from "./exam-countdown";

describe("daysUntilExam — базовые смещения (UTC)", () => {
  it("сегодня → 0", () => {
    expect(daysUntilExam("2026-07-11", new Date("2026-07-11T12:00:00.000Z"), "UTC")).toBe(0);
  });

  it("завтра → 1", () => {
    expect(daysUntilExam("2026-07-12", new Date("2026-07-11T12:00:00.000Z"), "UTC")).toBe(1);
  });

  it("вчера → -1", () => {
    expect(daysUntilExam("2026-07-10", new Date("2026-07-11T12:00:00.000Z"), "UTC")).toBe(-1);
  });
});

describe("daysUntilExam — граница суток в таймзоне юзера", () => {
  // 2026-07-10T20:00:00Z: в UTC ещё 10-е, но в Asia/Tashkent (UTC+5) уже 01:00
  // 11-го — сутки сдвинуты таймзоной юзера, не сервера.
  const instant = new Date("2026-07-10T20:00:00.000Z");

  it("Asia/Tashkent уже встретил exam-день → 0", () => {
    expect(daysUntilExam("2026-07-11", instant, "Asia/Tashkent")).toBe(0);
  });

  it("тот же инстант в UTC — экзамен ещё завтра → 1", () => {
    expect(daysUntilExam("2026-07-11", instant, "UTC")).toBe(1);
  });
});

describe("daysUntilExam — невалидный вход", () => {
  it("не yyyy-mm-dd → NaN", () => {
    expect(Number.isNaN(daysUntilExam("not-a-date", new Date(), "UTC"))).toBe(true);
  });

  it("пустая строка → NaN", () => {
    expect(Number.isNaN(daysUntilExam("", new Date(), "UTC"))).toBe(true);
  });

  it("неизвестная IANA-таймзона → NaN", () => {
    expect(Number.isNaN(daysUntilExam("2026-07-11", new Date(), "Not/AZone"))).toBe(true);
  });
});

describe("examCountdownStatus", () => {
  it("положительные дни → upcoming", () => {
    expect(examCountdownStatus(5)).toBe("upcoming");
  });

  it("0 → today", () => {
    expect(examCountdownStatus(0)).toBe("today");
  });

  it("отрицательные → past", () => {
    expect(examCountdownStatus(-3)).toBe("past");
  });

  it("NaN → past (консервативный дефолт)", () => {
    expect(examCountdownStatus(NaN)).toBe("past");
  });
});

describe("validExamDate — форма onboarding/редактора", () => {
  const now = new Date("2026-07-11T12:00:00.000Z");

  it("сегодня (UTC) → true", () => {
    expect(validExamDate("2026-07-11", now)).toBe(true);
  });

  it("вчера по UTC → true (юзер западнее UTC ещё живёт в этом дне)", () => {
    expect(validExamDate("2026-07-10", now)).toBe(true);
  });

  it("позавчера → false", () => {
    expect(validExamDate("2026-07-09", now)).toBe(false);
  });

  it("ровно +2 года → true, дальше → false", () => {
    expect(validExamDate("2028-07-11", now)).toBe(true);
    expect(validExamDate("2028-07-12", now)).toBe(false);
  });

  it("несуществующая календарная дата не нормализуется молча (2026-02-31)", () => {
    expect(validExamDate("2026-02-31", now)).toBe(false);
  });

  it("невалидный формат → false", () => {
    expect(validExamDate("31-02-2026", now)).toBe(false);
    expect(validExamDate("", now)).toBe(false);
  });
});

describe("getExamCountdown", () => {
  it("валидная дата → { days, status }", () => {
    expect(getExamCountdown("2026-07-12", new Date("2026-07-11T12:00:00.000Z"), "UTC")).toEqual({
      days: 1,
      status: "upcoming",
    });
  });

  it("невалидный вход → null", () => {
    expect(getExamCountdown("garbage", new Date(), "UTC")).toBeNull();
  });
});
