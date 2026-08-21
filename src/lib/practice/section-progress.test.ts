// Юнит-тесты чистого computeSectionProgress. Контракт: total считает только
// startable-тесты, done — startable И attempted, инвариант done<=total не
// нарушается даже attempted-но-заблокированным тестом (даунгрейд тира после trial).
import { describe, it, expect } from "vitest";
import { computeSectionProgress } from "./section-progress";

describe("computeSectionProgress", () => {
  it("пустой список → 0/0/0", () => {
    expect(computeSectionProgress([], new Set())).toEqual({ done: 0, total: 0, left: 0 });
  });

  it("никого не пройдено → done=0, left=total", () => {
    const tests = [
      { id: "a", startable: true },
      { id: "b", startable: true },
    ];
    expect(computeSectionProgress(tests, new Set())).toEqual({ done: 0, total: 2, left: 2 });
  });

  it("смешанный случай — 2 startable, 1 attempted → done=1, left=1", () => {
    const tests = [
      { id: "a", startable: true },
      { id: "b", startable: true },
    ];
    expect(computeSectionProgress(tests, new Set(["a"]))).toEqual({ done: 1, total: 2, left: 1 });
  });

  it("все пройдены → done=total, left=0", () => {
    const tests = [
      { id: "a", startable: true },
      { id: "b", startable: true },
    ];
    expect(computeSectionProgress(tests, new Set(["a", "b"]))).toEqual({ done: 2, total: 2, left: 0 });
  });

  it("attempted, но не startable (даунгрейд тира) — вне total И вне done", () => {
    const tests = [
      { id: "a", startable: true },
      { id: "b", startable: false },
    ];
    // "b" отмечен как пройденный, но сейчас не startable — не должен раздувать total.
    const out = computeSectionProgress(tests, new Set(["a", "b"]));
    expect(out).toEqual({ done: 1, total: 1, left: 0 });
    expect(out.done).toBeLessThanOrEqual(out.total);
  });

  it("attemptedIds с id чужой секции не влияют на счёт", () => {
    const tests = [{ id: "a", startable: true }];
    expect(computeSectionProgress(tests, new Set(["foreign-id", "a"]))).toEqual({ done: 1, total: 1, left: 0 });
    expect(computeSectionProgress(tests, new Set(["foreign-id-only"]))).toEqual({ done: 0, total: 1, left: 1 });
  });
});
