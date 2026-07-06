// Тесты чистого маппинга целевого band → CEFR-уровень (уровневый каталог 0039).
import { describe, it, expect } from "vitest";
import { bandToCefr, LEVEL_ORDER } from "./level";

describe("bandToCefr — границы band → CEFR", () => {
  it("null (band не задан) → null", () => {
    expect(bandToCefr(null)).toBeNull();
  });
  it("ниже 5.5 → B1", () => {
    expect(bandToCefr(5.0)).toBe("B1");
    expect(bandToCefr(4.5)).toBe("B1");
  });
  it("5.5 (нижняя граница включительно) → B2", () => {
    expect(bandToCefr(5.5)).toBe("B2");
  });
  it("6.5 (верх диапазона B2) → B2", () => {
    expect(bandToCefr(6.5)).toBe("B2");
  });
  it("7.0 (нижняя граница включительно) → C1", () => {
    expect(bandToCefr(7.0)).toBe("C1");
    expect(bandToCefr(8.5)).toBe("C1");
  });
});

describe("LEVEL_ORDER", () => {
  it("канонический порядок B1 → B2 → C1", () => {
    expect(LEVEL_ORDER).toEqual(["B1", "B2", "C1"]);
  });
});
