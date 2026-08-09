// Предикат «полный тест» — чистая логика, тестируется без БД (как tiers.ts).
import { describe, it, expect } from "vitest";
import { isFullCategory } from "./categories";

describe("isFullCategory", () => {
  it("full_reading / full_listening — полные тесты", () => {
    expect(isFullCategory("full_reading")).toBe(true);
    expect(isFullCategory("full_listening")).toBe(true);
  });
  it("одиночные passage/part и пустая строка — нет", () => {
    expect(isFullCategory("passage_1")).toBe(false);
    expect(isFullCategory("part_2")).toBe(false);
    expect(isFullCategory("")).toBe(false);
  });
});
