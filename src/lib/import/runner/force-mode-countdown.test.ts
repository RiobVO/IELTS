// @vitest-environment jsdom
// Поведенческий тест обратного отсчёта семейства C: строковые проверки в
// force-mode.test.ts пинят ФОРМУ инъекции, здесь исполняем её в DOM и проверяем
// ПОВЕДЕНИЕ — отсчёт стартует вместе с тестом, красит #testTimer и по нулю сдаёт
// нативным путём (showResults, перехваченный мостом bridge.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forceRunnerMode } from "./force-mode";

const INSPERA =
  "<html><head></head><body>" +
  '<span id="testTimer">00:00</span>' +
  '<button id="startTestBtn">Start</button>' +
  "<script>function startTimer(){}</script>" +
  "</body></html>";

/** Достаёт тело инжектированного скрипта и исполняет его в текущем jsdom-окне. */
function runInjectedScript(minutes: number): void {
  const out = forceRunnerMode(INSPERA, "mock", minutes);
  const body = /<script id="bando-mock-countdown">([\s\S]*?)<\/script>/.exec(out)?.[1];
  if (!body) throw new Error("инъекция отсчёта не найдена");
  // Аналог исполнения инлайн-скрипта раннера: тот же глобальный объект, что у шаблона.
  new Function(body).call(window);
}

describe("семейство C: обратный отсчёт в DOM", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<span id="testTimer">00:00</span>';
  });

  afterEach(() => {
    vi.useRealTimers();
    // startTimer/disableAll/showResults живут на window — чистим между тестами.
    for (const k of ["startTimer", "disableAll", "showResults"]) {
      delete (window as unknown as Record<string, unknown>)[k];
    }
  });

  const timerText = () => document.getElementById("testTimer")?.textContent;

  it("до старта показывает полный лимит, но не тикает сам", () => {
    runInjectedScript(20);
    expect(timerText()).toBe("20:00");
    vi.advanceTimersByTime(5000);
    expect(timerText()).toBe("20:00"); // тест ещё не начат — время не идёт
  });

  it("после startTimer() считает ВНИЗ", () => {
    runInjectedScript(20);
    (window as unknown as { startTimer: () => void }).startTimer();
    vi.advanceTimersByTime(1000);
    expect(timerText()).toBe("19:59");
    vi.advanceTimersByTime(59_000);
    expect(timerText()).toBe("19:00");
  });

  it("по нулю сдаёт: disableAll + showResults, таймер встаёт на 00:00", () => {
    const showResults = vi.fn();
    const disableAll = vi.fn();
    Object.assign(window, { showResults, disableAll });

    runInjectedScript(1);
    (window as unknown as { startTimer: () => void }).startTimer();
    vi.advanceTimersByTime(59_000);
    expect(showResults).not.toHaveBeenCalled(); // ещё секунда в запасе

    vi.advanceTimersByTime(1000);
    expect(timerText()).toBe("00:00");
    expect(disableAll).toHaveBeenCalledTimes(1);
    expect(showResults).toHaveBeenCalledTimes(1);
  });

  it("сдаёт РОВНО один раз — интервал снят, время дальше не уходит в минус", () => {
    const showResults = vi.fn();
    Object.assign(window, { showResults });

    runInjectedScript(1);
    (window as unknown as { startTimer: () => void }).startTimer();
    vi.advanceTimersByTime(60_000);
    vi.advanceTimersByTime(600_000); // ещё 10 минут после сдачи

    expect(showResults).toHaveBeenCalledTimes(1);
    expect(timerText()).toBe("00:00");
  });

  it("повторный startTimer() не запускает второй интервал (двойная скорость)", () => {
    runInjectedScript(20);
    const start = (window as unknown as { startTimer: () => void }).startTimer;
    start();
    start();
    vi.advanceTimersByTime(10_000);
    expect(timerText()).toBe("19:50"); // 10 секунд, не 20
  });

  it("отсутствие showResults/disableAll не роняет отсчёт (голый шаблон без моста)", () => {
    runInjectedScript(1);
    (window as unknown as { startTimer: () => void }).startTimer();
    expect(() => vi.advanceTimersByTime(60_000)).not.toThrow();
    expect(timerText()).toBe("00:00");
  });
});
