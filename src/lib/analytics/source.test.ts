// Юнит-тесты sanitizeSource (source-атрибуция P5).
// Контракт: lowercase → обрезка до 32 → алфавит [a-z0-9_-]; иначе null.
import { describe, it, expect } from "vitest";
import { sanitizeSource, SOURCE_COOKIE_NAME, SOURCE_COOKIE_MAX_AGE_SECONDS } from "./source";

describe("sanitizeSource", () => {
  it("пропускает валидный слаг и приводит к lowercase", () => {
    expect(sanitizeSource("tg_main")).toBe("tg_main");
    expect(sanitizeSource("TG-Main_2")).toBe("tg-main_2");
    expect(sanitizeSource("a")).toBe("a");
    expect(sanitizeSource("123")).toBe("123");
  });

  it("обрезает длинный ввод до 32 символов", () => {
    const input = "a".repeat(40);
    expect(sanitizeSource(input)).toBe("a".repeat(32));
    // Хвост за границей 32 не протаскивает мусорный символ в результат.
    expect(sanitizeSource("b".repeat(32) + "!!!")).toBe("b".repeat(32));
  });

  it("отсекает символы вне алфавита → null", () => {
    expect(sanitizeSource("tg main")).toBeNull(); // пробел
    expect(sanitizeSource("tg.main")).toBeNull(); // точка
    expect(sanitizeSource("tg/main")).toBeNull(); // слэш
    expect(sanitizeSource("<script>")).toBeNull(); // угловые скобки
    expect(sanitizeSource("tg@main")).toBeNull(); // @
  });

  it("отсекает кириллицу → null", () => {
    expect(sanitizeSource("телеграм")).toBeNull();
    expect(sanitizeSource("tg_канал")).toBeNull();
  });

  it("отсекает пустое и не-строку → null", () => {
    expect(sanitizeSource("")).toBeNull();
    expect(sanitizeSource(undefined)).toBeNull();
    expect(sanitizeSource(null)).toBeNull();
  });

  it("константы cookie стабильны (контракт для middleware/потребителей)", () => {
    expect(SOURCE_COOKIE_NAME).toBe("bando_src");
    expect(SOURCE_COOKIE_MAX_AGE_SECONDS).toBe(2592000);
  });
});
