// Ретеншен-сигнал сабмита (G2-3): dayActiveTelemetry решает, засчитывать ли этот
// сабмит как активный день и был ли это возврат после паузы. Ошибка здесь тихо
// портит D7-метрику всей волны 2, поэтому переходы пиннятся отдельно от
// транзакционных тестов applyPostSubmit.
import { describe, it, expect, vi } from "vitest";
vi.mock("@/db", () => ({ db: {} }));
// Аналитика тянет @/env (валидация переменных на импорте) — чистой функции она не
// нужна, как и в access.test.ts.
vi.mock("@/lib/analytics/server", () => ({ captureServer: vi.fn() }));
import { dayActiveTelemetry } from "./apply-post-submit";

describe("dayActiveTelemetry", () => {
  it("активность сегодня уже была → день не засчитывается повторно", () => {
    expect(dayActiveTelemetry("2026-08-05", "2026-08-05")).toEqual({
      firstToday: false,
      daysSinceLast: 0,
      returning: false,
    });
  });

  it("первый день аккаунта → засчитывается, но это не возврат", () => {
    expect(dayActiveTelemetry(null, "2026-08-05")).toEqual({
      firstToday: true,
      daysSinceLast: null,
      returning: false,
    });
  });

  it("вчера → продолжение, не возврат", () => {
    expect(dayActiveTelemetry("2026-08-04", "2026-08-05")).toEqual({
      firstToday: true,
      daysSinceLast: 1,
      returning: false,
    });
  });

  it("пауза в 2 дня → возврат", () => {
    const r = dayActiveTelemetry("2026-08-03", "2026-08-05");
    expect(r.daysSinceLast).toBe(2);
    expect(r.returning).toBe(true);
  });

  it("длинная пауза считается в календарных днях через границу месяца", () => {
    const r = dayActiveTelemetry("2026-07-29", "2026-08-05");
    expect(r.daysSinceLast).toBe(7);
    expect(r.returning).toBe(true);
  });

  it("битая дата не роняет телеметрию — трактуется как первый день", () => {
    expect(dayActiveTelemetry("not-a-date", "2026-08-05")).toEqual({
      firstToday: true,
      daysSinceLast: null,
      returning: false,
    });
  });
});
