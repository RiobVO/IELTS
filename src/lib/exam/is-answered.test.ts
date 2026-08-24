import { describe, expect, it } from "vitest";
import { isAnswered } from "./is-answered";

describe("isAnswered", () => {
  it("пустой / отсутствующий ввод — не отвечено", () => {
    expect(isAnswered(undefined)).toBe(false);
    expect(isAnswered("")).toBe(false);
    expect(isAnswered("   ")).toBe(false); // только пробелы
    expect(isAnswered([])).toBe(false);
  });

  it("непустая строка — отвечено (пробелы по краям не мешают)", () => {
    expect(isAnswered("river")).toBe(true);
    expect(isAnswered("  x  ")).toBe(true);
  });

  it("непустой набор букв (mcq_multi) — отвечено", () => {
    expect(isAnswered(["A"])).toBe(true);
    expect(isAnswered(["A", "C"])).toBe(true);
  });
});
