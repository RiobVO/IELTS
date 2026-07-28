// Юнит-тесты перевода raw score → band (BRIEF §11). Относительный импорт — alias не нужен.
import { describe, it, expect } from "vitest";
import { bandForScore } from "./band";

describe("bandForScore", () => {
  const scale = { "0": 5, "20": 7, "40": 9 };

  it("возвращает band для точного совпадения rawScore со шкалой", () => {
    expect(bandForScore(scale, 0)).toBe(5);
    expect(bandForScore(scale, 20)).toBe(7);
    expect(bandForScore(scale, 40)).toBe(9);
  });

  it("возвращает null для rawScore без записи в шкале (без интерполяции)", () => {
    expect(bandForScore(scale, 10)).toBeNull(); // между 0 и 20 — точного ключа нет
    expect(bandForScore(scale, 41)).toBeNull(); // вне диапазона
  });

  it("возвращает null при отсутствии шкалы (одиночный passage/part — только проценты)", () => {
    expect(bandForScore(null, 0)).toBeNull();
    expect(bandForScore(null, 20)).toBeNull();
  });
});
