// Юнит-тесты частотного анти-чит-капа на submit (BRIEF §4.6). Чистые функции
// (без I/O) — окно и решение проверяются без БД. Полностью inline.
import { describe, it, expect } from "vitest";
import {
  countSubmitsInWindow,
  exceedsSignupRate,
  exceedsSubmitRate,
  isTooFastToRate,
  MIN_RATED_SECONDS_PER_QUESTION,
  SIGNUP_THROTTLE_MAX,
  SUBMIT_THROTTLE_MAX,
  SUBMIT_THROTTLE_WINDOW_SECONDS,
} from "./anti-cheat";

describe("countSubmitsInWindow", () => {
  const now = new Date("2026-06-17T12:00:00.000Z");
  // Граница окна: now - window. Строится из времени now, чтобы кейс не зависел
  // от реальных часов и оставался читаемым относительно окна.
  const cutoff = new Date(now.getTime() - SUBMIT_THROTTLE_WINDOW_SECONDS * 1000);

  it("граница cutoff включительна (>=): ровно на границе считается", () => {
    expect(countSubmitsInWindow([new Date(cutoff)], now)).toBe(1);
  });

  it("строго раньше cutoff не считается", () => {
    const before = new Date(cutoff.getTime() - 1);
    expect(countSubmitsInWindow([before], now)).toBe(0);
  });

  it("null (in_progress без submitted_at) отфильтрован", () => {
    const inside = new Date(now.getTime() - 1000);
    expect(countSubmitsInWindow([null, inside, null], now)).toBe(1);
  });

  it("считает только попадающие в окно [now - window, now]", () => {
    const inside = new Date(now.getTime() - 1000);
    const before = new Date(cutoff.getTime() - 1);
    expect(countSubmitsInWindow([inside, inside, before, null], now)).toBe(2);
  });
});

describe("exceedsSubmitRate", () => {
  it("меньше потолка → false", () => {
    expect(exceedsSubmitRate(SUBMIT_THROTTLE_MAX - 1)).toBe(false);
  });

  it("ровно потолок → true (граница включительна, >=)", () => {
    expect(exceedsSubmitRate(SUBMIT_THROTTLE_MAX)).toBe(true);
  });

  it("больше потолка → true", () => {
    expect(exceedsSubmitRate(SUBMIT_THROTTLE_MAX + 1)).toBe(true);
  });
});

describe("exceedsSignupRate", () => {
  it("меньше потолка → false", () => {
    expect(exceedsSignupRate(SIGNUP_THROTTLE_MAX - 1)).toBe(false);
  });
  it("ровно потолок → true (граница включительна, >=)", () => {
    expect(exceedsSignupRate(SIGNUP_THROTTLE_MAX)).toBe(true);
  });
  it("больше потолка → true", () => {
    expect(exceedsSignupRate(SIGNUP_THROTTLE_MAX + 1)).toBe(true);
  });
});

describe("isTooFastToRate", () => {
  const N = MIN_RATED_SECONDS_PER_QUESTION;

  it("инстант-сабмит (0с на 40 вопросов) → too fast", () => {
    expect(isTooFastToRate(0, 40)).toBe(true);
  });

  it("строго ниже порога (на границе минус 1с) → too fast", () => {
    expect(isTooFastToRate(40 * N - 1, 40)).toBe(true);
  });

  it("ровно на пороге (N сек/вопрос) → НЕ too fast (граница не включительна)", () => {
    expect(isTooFastToRate(40 * N, 40)).toBe(false);
  });

  it("реальный темп (минуты на тест) → НЕ too fast", () => {
    expect(isTooFastToRate(20 * 60, 40)).toBe(false);
  });

  it("нет вопросов (total 0) → НЕ too fast (нет делителя, не наказываем)", () => {
    expect(isTooFastToRate(0, 0)).toBe(false);
  });
});
