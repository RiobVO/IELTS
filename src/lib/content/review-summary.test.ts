import { describe, it, expect } from "vitest";
import { summarizeReview, type ReviewRow } from "./review-summary";

const row = (number: number, qtype: string, mode: string | null, emptyAccept = false): ReviewRow => ({
  number,
  qtype,
  mode,
  emptyAccept,
});

describe("summarizeReview", () => {
  it("считает total, разбивку по mode и по типу вопроса", () => {
    const s = summarizeReview([
      row(1, "tfng", "exact"),
      row(2, "tfng", "exact"),
      row(3, "note_completion", "text_accept"),
      row(4, "mcq_multi", "mcq_set"),
    ]);
    expect(s.total).toBe(4);
    expect(s.byMode).toEqual({ exact: 2, text_accept: 1, mcq_set: 1 });
    expect(s.byType).toEqual({ tfng: 2, note_completion: 1, mcq_multi: 1 });
  });

  it("считает пустые/отсутствующие ключи (флаг)", () => {
    const s = summarizeReview([
      row(1, "tfng", "exact"),
      row(2, "tfng", "exact", true), // пустой accept
      row(3, "tfng", null, true), // ключа нет вовсе
    ]);
    expect(s.emptyKeys).toBe(2);
  });

  it("флагует дубли номеров (список, отсортирован)", () => {
    const s = summarizeReview([row(1, "tfng", "exact"), row(2, "tfng", "exact"), row(1, "tfng", "exact")]);
    expect(s.duplicateNumbers).toEqual([1]);
  });

  it("флагует дыру в нумерации, но НЕ офсетный смежный набор (14..26)", () => {
    expect(summarizeReview([row(1, "tfng", "exact"), row(3, "tfng", "exact")]).numberGap).toBe(true);
    const offset = Array.from({ length: 13 }, (_, i) => row(14 + i, "tfng", "exact"));
    expect(summarizeReview(offset).numberGap).toBe(false);
  });

  it("пустой набор → total 0, numberGap true (0 вопросов — дефект)", () => {
    const s = summarizeReview([]);
    expect(s.total).toBe(0);
    expect(s.numberGap).toBe(true);
  });

  it("неположительные номера флагуются как numberGap (Codex 2026-07-09)", () => {
    const s = summarizeReview([
      row(-1, "tfng", "exact"),
      row(0, "tfng", "exact"),
      row(1, "tfng", "exact"),
    ]);
    expect(s.numberGap).toBe(true);
  });
});
