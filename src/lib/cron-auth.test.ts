// Юнит-тесты авторизации cron-эндпоинта (BRIEF §11). Контракт: проходит ТОЛЬКО
// точный `Bearer <secret>`; отсутствие секрета — fail-closed.
import { describe, it, expect } from "vitest";
import { isCronAuthorized } from "./cron-auth";

describe("isCronAuthorized", () => {
  it("false, когда секрет не настроен (fail-closed) — даже с любым заголовком", () => {
    expect(isCronAuthorized("Bearer whatever", null)).toBe(false);
    expect(isCronAuthorized(null, null)).toBe(false);
  });

  it("false при неверном Bearer (несовпадение и отсутствие заголовка)", () => {
    expect(isCronAuthorized("Bearer wrong", "s3cret")).toBe(false);
    expect(isCronAuthorized("s3cret", "s3cret")).toBe(false); // нет префикса Bearer
    expect(isCronAuthorized("Bearer s3cre", "s3cret")).toBe(false); // другая длина
    expect(isCronAuthorized(null, "s3cret")).toBe(false); // заголовок отсутствует
  });

  it("true при точном Bearer <secret>", () => {
    expect(isCronAuthorized("Bearer s3cret", "s3cret")).toBe(true);
  });
});
