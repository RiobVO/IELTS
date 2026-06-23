// Юнит-тесты частотного анти-чит-капа на submit (BRIEF §4.6). Чистые функции
// (без I/O) — окно и решение проверяются без БД. Полностью inline.
import { describe, it, expect } from "vitest";
import {
  countSubmitsInWindow,
  exceedsSubmitRate,
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
