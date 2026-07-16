// Юнит-тесты чистого computeSectionProgress. Контракт: total = tests.length (весь
// published-каталог секции, консистентно с «N tests» на карте), done — attempted
// среди них, left = total - done. startable в контракте нет (отвергнут живым
// прогоном 2026-07-16 — см. section-progress.ts).
import { describe, it, expect } from "vitest";
import { computeSectionProgress } from "./section-progress";

describe("computeSectionProgress", () => {
  it("пустой список → 0/0/0", () => {
    expect(computeSectionProgress([], new Set())).toEqual({ done: 0, total: 0, left: 0 });
  });

  it("никого не пройдено → done=0, left=total", () => {
    const tests = [{ id: "a" }, { id: "b" }];
    expect(computeSectionProgress(tests, new Set())).toEqual({ done: 0, total: 2, left: 2 });
  });

  it("смешанный случай — 2 теста, 1 attempted → done=1, left=1", () => {
    const tests = [{ id: "a" }, { id: "b" }];
    expect(computeSectionProgress(tests, new Set(["a"]))).toEqual({ done: 1, total: 2, left: 1 });
  });

  it("все пройдены → done=total, left=0", () => {
    const tests = [{ id: "a" }, { id: "b" }];
    expect(computeSectionProgress(tests, new Set(["a", "b"]))).toEqual({ done: 2, total: 2, left: 0 });
  });

  it("attemptedIds с id чужой секции не влияют на счёт", () => {
    const tests = [{ id: "a" }];
    expect(computeSectionProgress(tests, new Set(["foreign-id", "a"]))).toEqual({ done: 1, total: 1, left: 0 });
    expect(computeSectionProgress(tests, new Set(["foreign-id-only"]))).toEqual({ done: 0, total: 1, left: 1 });
  });
});
