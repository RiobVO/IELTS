// Unit tests for the pure /result "debrief" derivations (no DB, no React).
import { describe, it, expect } from "vitest";
import { computeNearMiss, computeBlindSpot, computeGrowth, stripHtml } from "./debrief";
import type { PerQuestionResult } from "@/lib/grading/grade";

describe("computeNearMiss", () => {
  const scale = { "20": 5, "23": 5.5, "26": 6, "40": 9 };

  it("finds the next higher band and how many marks are missing", () => {
    expect(computeNearMiss(scale, 23)).toEqual({ band: 5.5, nextBand: 6, marksToNext: 3 });
  });

  it("returns null nextBand when already at the top of the scale", () => {
    expect(computeNearMiss(scale, 40)).toEqual({ band: 9, nextBand: null, marksToNext: null });
  });

  it("returns all null when the raw score has no exact scale entry", () => {
    expect(computeNearMiss(scale, 21)).toEqual({ band: null, nextBand: null, marksToNext: null });
  });

  it("returns all null when there is no scale (single passage/part)", () => {
    expect(computeNearMiss(null, 5)).toEqual({ band: null, nextBand: null, marksToNext: null });
  });
});

describe("computeBlindSpot", () => {
  const q = (number: number, qtype: string, correct: boolean): PerQuestionResult => ({
    number,
    qtype,
    given: correct ? "x" : "y",
    correct,
  });

  it("flags Not Given as the weak bucket when it scores worse than True/False", () => {
    const perQuestion = [
      q(1, "tfng", true),
      q(2, "tfng", true),
      q(3, "tfng", false), // Not Given, missed
      q(4, "tfng", false), // Not Given, missed
    ];
    const meta = new Map([
      [1, { accept: ["TRUE"] }],
      [2, { accept: ["FALSE"] }],
      [3, { accept: ["NOT GIVEN"] }],
      [4, { accept: ["NOT GIVEN"] }],
    ]);
    const result = computeBlindSpot(perQuestion, meta);
    expect(result).toEqual({
      label: "Not Given",
      weakBucket: { correct: 0, total: 2 },
      strongBucket: { correct: 2, total: 2 },
      costMarks: 2,
    });
  });

  it("flags the value bucket (Yes/No) as weak when Not Given is the strength", () => {
    const perQuestion = [
      q(1, "ynng", false), // Yes, missed
      q(2, "ynng", true), // Not Given, correct
      q(3, "ynng", true), // Not Given, correct
    ];
    const meta = new Map([
      [1, { accept: ["YES"] }],
      [2, { accept: ["NOT GIVEN"] }],
      [3, { accept: ["NOT GIVEN"] }],
    ]);
    const result = computeBlindSpot(perQuestion, meta);
    expect(result?.label).toBe("Yes / No");
    expect(result?.weakBucket).toEqual({ correct: 0, total: 1 });
  });

  it("returns null when the attempt has no tfng/ynng questions at all", () => {
    const perQuestion = [q(1, "matching_headings", true)];
    const meta = new Map([[1, { accept: ["B"] }]]);
    expect(computeBlindSpot(perQuestion, meta)).toBeNull();
  });

  it("returns null when every ternary question falls in a single bucket", () => {
    const perQuestion = [q(1, "tfng", true), q(2, "tfng", false)];
    const meta = new Map([
      [1, { accept: ["TRUE"] }],
      [2, { accept: ["FALSE"] }],
    ]);
    expect(computeBlindSpot(perQuestion, meta)).toBeNull();
  });

  it("returns null when both buckets score the same non-trivial percentage (a tie, no real blind spot)", () => {
    const perQuestion = [
      q(1, "tfng", true),
      q(2, "tfng", false), // Not Given, missed
      q(3, "tfng", true),
      q(4, "tfng", false), // True/False, missed
    ];
    const meta = new Map([
      [1, { accept: ["NOT GIVEN"] }],
      [2, { accept: ["NOT GIVEN"] }],
      [3, { accept: ["TRUE"] }],
      [4, { accept: ["FALSE"] }],
    ]);
    expect(computeBlindSpot(perQuestion, meta)).toBeNull();
  });

  it("returns null on a perfect score (both buckets 100%)", () => {
    const perQuestion = [q(1, "tfng", true), q(2, "tfng", true), q(3, "tfng", true)];
    const meta = new Map([
      [1, { accept: ["NOT GIVEN"] }],
      [2, { accept: ["TRUE"] }],
      [3, { accept: ["FALSE"] }],
    ]);
    expect(computeBlindSpot(perQuestion, meta)).toBeNull();
  });

  it("returns null on an all-miss attempt (both buckets 0%)", () => {
    const perQuestion = [q(1, "tfng", false), q(2, "tfng", false), q(3, "tfng", false)];
    const meta = new Map([
      [1, { accept: ["NOT GIVEN"] }],
      [2, { accept: ["TRUE"] }],
      [3, { accept: ["FALSE"] }],
    ]);
    expect(computeBlindSpot(perQuestion, meta)).toBeNull();
  });
});

describe("computeGrowth", () => {
  it("returns null when there is no previous attempt (first attempt ever)", () => {
    const history = [{ perTypeBreakdown: { tfng: { correct: 3, total: 6 } } }];
    expect(computeGrowth(history, "tfng")).toBeNull();
  });

  it("returns null when weakType is null", () => {
    const history = [
      { perTypeBreakdown: { tfng: { correct: 1, total: 6 } } },
      { perTypeBreakdown: { tfng: { correct: 3, total: 6 } } },
    ];
    expect(computeGrowth(history, null)).toBeNull();
  });

  it("builds a 1st/now series and the mark delta with a single previous attempt", () => {
    const history = [
      { perTypeBreakdown: { tfng: { correct: 1, total: 6 } } },
      { perTypeBreakdown: { tfng: { correct: 3, total: 6 } } },
    ];
    expect(computeGrowth(history, "tfng")).toEqual({
      label: "True / False / Not Given",
      series: [
        { tag: "1st", correct: 1, total: 6 },
        { tag: "now", correct: 3, total: 6 },
      ],
      deltaType: 2,
    });
  });

  it("caps at 1st/2nd/now with three or more previous attempts, '2nd' being the actual second attempt", () => {
    const history = [
      { perTypeBreakdown: { tfng: { correct: 1, total: 6 } } },
      { perTypeBreakdown: { tfng: { correct: 2, total: 6 } } },
      { perTypeBreakdown: { tfng: { correct: 3, total: 6 } } },
      { perTypeBreakdown: { tfng: { correct: 5, total: 6 } } },
    ];
    const result = computeGrowth(history, "tfng");
    expect(result?.series.map((s) => s.tag)).toEqual(["1st", "2nd", "now"]);
    // "2nd" is points[1] (the real second attempt), NOT points[length - 2]
    // (the second-to-last, which here would wrongly be the third attempt).
    expect(result?.series[1]).toEqual({ tag: "2nd", correct: 2, total: 6 });
    expect(result?.deltaType).toBe(4);
  });

  it("skips attempts with no data for the weak type", () => {
    const history = [
      { perTypeBreakdown: { tfng: { correct: 1, total: 6 } } },
      { perTypeBreakdown: null },
      { perTypeBreakdown: { tfng: { correct: 4, total: 6 } } },
    ];
    const result = computeGrowth(history, "tfng");
    expect(result?.series).toEqual([
      { tag: "1st", correct: 1, total: 6 },
      { tag: "now", correct: 4, total: 6 },
    ]);
  });
});

describe("stripHtml", () => {
  it("strips nested tags and decodes HTML entities", () => {
    const html = "<p>The author believes <b>shipping &amp; trade</b> grew.</p>";
    expect(stripHtml(html)).toBe("The author believes shipping & trade grew.");
  });

  it("collapses newlines/whitespace between block elements into single spaces", () => {
    const html = "<p>First paragraph.</p>\n<p>Second   paragraph.</p>";
    expect(stripHtml(html)).toBe("First paragraph. Second paragraph.");
  });

  it("returns an empty string for empty input", () => {
    expect(stripHtml("")).toBe("");
  });
});
