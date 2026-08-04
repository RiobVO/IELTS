// Нормализация реф-кода из ссылки/cookie (G1-5). Граница доверия: значение едет
// в cookie и в метаданные signup, поэтому «пропустить лишнее» дороже, чем отсечь.
import { describe, it, expect } from "vitest";
import { sanitizeRefCode } from "./link";

describe("sanitizeRefCode", () => {
  it("канонический код триггера 0005 (10 hex-символов) проходит как есть", () => {
    expect(sanitizeRefCode("A1B2C3D4E5")).toBe("A1B2C3D4E5");
  });

  it("нижний регистр и пробелы нормализуются", () => {
    expect(sanitizeRefCode("  a1b2c3d4e5 ")).toBe("A1B2C3D4E5");
  });

  it("мусор отсекается целиком, а не обрезается до валидного куска", () => {
    expect(sanitizeRefCode("A1B2-C3D4")).toBeNull(); // дефис вне алфавита
    expect(sanitizeRefCode("КОД12345")).toBeNull(); // кириллица
    expect(sanitizeRefCode("<script>")).toBeNull();
    expect(sanitizeRefCode("A".repeat(33))).toBeNull(); // длиннее потолка
    expect(sanitizeRefCode("A1B")).toBeNull(); // короче минимума
  });

  it("пустое/не-строка → null", () => {
    expect(sanitizeRefCode("")).toBeNull();
    expect(sanitizeRefCode("   ")).toBeNull();
    expect(sanitizeRefCode(null)).toBeNull();
    expect(sanitizeRefCode(undefined)).toBeNull();
    expect(sanitizeRefCode(42 as unknown as string)).toBeNull();
  });
});
