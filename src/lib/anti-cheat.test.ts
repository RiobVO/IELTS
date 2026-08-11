// Юнит-тесты частотного анти-чит-капа на submit (BRIEF §4.6). Чистые функции
// (без I/O) — окно и решение проверяются без БД. Полностью inline.
import { describe, it, expect } from "vitest";
import {
  countSubmitsInWindow,
  exceedsSignupRate,
  exceedsSubmitRate,
  isHoneypotTripped,
  isTooFastToRate,
  shouldRateAttempt,
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

describe("shouldRateAttempt (P0 Practice/Mock)", () => {
  // Честный базовый кейс: mock, первая сданная попытка, нормальный темп.
  const base = {
    mode: "mock" as const,
    submittedCountForTest: 1,
    timeUsedSeconds: 20 * 60,
    totalQuestions: 40,
  };

  it("mock + абсолютно первая попытка + честный темп → рейтингуется", () => {
    expect(shouldRateAttempt(base)).toBe(true);
  });

  it("practice НИКОГДА не рейтингуется, даже первая честная попытка", () => {
    expect(shouldRateAttempt({ ...base, mode: "practice" })).toBe(false);
  });

  it("mock после любой прежней сдачи (practice или mock) → не рейтингуется", () => {
    expect(shouldRateAttempt({ ...base, submittedCountForTest: 2 })).toBe(false);
  });

  it("слишком быстрый mock (floor-guard) → не рейтингуется", () => {
    expect(
      shouldRateAttempt({
        ...base,
        timeUsedSeconds: 40 * MIN_RATED_SECONDS_PER_QUESTION - 1,
      }),
    ).toBe(false);
  });

  it("total 0 не наказывается floor-guard'ом (как isTooFastToRate)", () => {
    expect(
      shouldRateAttempt({ ...base, timeUsedSeconds: 0, totalQuestions: 0 }),
    ).toBe(true);
  });
});

describe("isHoneypotTripped", () => {
  it("пустое / отсутствующее поле → не бот (живой юзер приманку не трогает)", () => {
    expect(isHoneypotTripped("")).toBe(false);
    expect(isHoneypotTripped("   ")).toBe(false); // whitespace = пусто
    expect(isHoneypotTripped(undefined)).toBe(false);
    expect(isHoneypotTripped(null)).toBe(false);
  });
  it("непустое значение → бот (автозаполнил скрытое поле)", () => {
    expect(isHoneypotTripped("http://spam.example")).toBe(true);
    expect(isHoneypotTripped("x")).toBe(true);
  });
});
