// Unit tests for the pure /result "debrief" derivations (no DB, no React).
import { describe, it, expect } from "vitest";
import {
  computeNearMiss,
  computeBlindSpot,
  computeGeneralizedBlindSpot,
  computeGrowth,
  stripHtml,
  blindSpotTag,
  resolveFocusQType,
  buildShareHeadline,
} from "./debrief";
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

describe("computeGeneralizedBlindSpot", () => {
  it("returns null when there is only one type (nothing to compare against)", () => {
    expect(computeGeneralizedBlindSpot([["tfng", { correct: 1, total: 6 }]])).toBeNull();
  });

  it("returns null on an all-miss attempt (every type scores 0%)", () => {
    const perType: [string, { correct: number; total: number }][] = [
      ["tfng", { correct: 0, total: 6 }],
      ["mcq_single", { correct: 0, total: 5 }],
      ["short_answer", { correct: 0, total: 7 }],
    ];
    expect(computeGeneralizedBlindSpot(perType)).toBeNull();
  });

  it("returns null when every type ties at the same percentage", () => {
    const perType: [string, { correct: number; total: number }][] = [
      ["tfng", { correct: 3, total: 6 }],
      ["mcq_single", { correct: 2, total: 4 }],
    ];
    expect(computeGeneralizedBlindSpot(perType)).toBeNull();
  });

  it("generalizes to the weakest type when it is strictly below the average of the rest", () => {
    const perType: [string, { correct: number; total: number }][] = [
      ["tfng", { correct: 0, total: 6 }],
      ["mcq_single", { correct: 4, total: 5 }],
      ["short_answer", { correct: 6, total: 7 }],
    ];
    expect(computeGeneralizedBlindSpot(perType)).toEqual({
      label: "True / False / Not Given",
      weakBucket: { correct: 0, total: 6 },
      strongBucket: null,
      costMarks: 6,
    });
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

describe("blindSpotTag", () => {
  const ngBlindSpot = { label: "Not Given", weakBucket: { correct: 0, total: 2 }, strongBucket: { correct: 2, total: 2 }, costMarks: 2 };
  const valueBlindSpot = { label: "Yes / No", weakBucket: { correct: 0, total: 1 }, strongBucket: { correct: 2, total: 2 }, costMarks: 1 };
  const generalBlindSpot = { label: "Matching Headings", weakBucket: { correct: 1, total: 4 }, strongBucket: null, costMarks: 3 };

  it("returns null when there is no blind spot", () => {
    expect(blindSpotTag({ qtype: "tfng", accept: ["NOT GIVEN"] }, null)).toBeNull();
  });

  it("tags a Not-Given question as 'your blind spot' when NG is the weak bucket", () => {
    expect(blindSpotTag({ qtype: "tfng", accept: ["NOT GIVEN"] }, ngBlindSpot)).toBe("your blind spot");
  });

  it("returns null for a value (True/False) question when NG is the weak bucket — it's in the strong bucket", () => {
    expect(blindSpotTag({ qtype: "tfng", accept: ["TRUE"] }, ngBlindSpot)).toBeNull();
  });

  it("tags a value question as 'common trap' when the value bucket is weak", () => {
    expect(blindSpotTag({ qtype: "ynng", accept: ["YES"] }, valueBlindSpot)).toBe("common trap");
  });

  it("returns null for Not Given when the value bucket is weak", () => {
    expect(blindSpotTag({ qtype: "ynng", accept: ["NOT GIVEN"] }, valueBlindSpot)).toBeNull();
  });

  it("tags a matching type as 'common trap' under a generalized (non-ternary) blind spot", () => {
    expect(blindSpotTag({ qtype: "matching_headings", accept: ["B"] }, generalBlindSpot)).toBe("common trap");
  });

  it("returns null for an unrelated type under a generalized blind spot", () => {
    expect(blindSpotTag({ qtype: "mcq_single", accept: ["A"] }, generalBlindSpot)).toBeNull();
  });
});

describe("resolveFocusQType", () => {
  const ngBlindSpot = { label: "Not Given", weakBucket: { correct: 0, total: 2 }, strongBucket: { correct: 2, total: 2 }, costMarks: 2 };
  const generalBlindSpot = { label: "Matching Headings", weakBucket: { correct: 1, total: 4 }, strongBucket: null, costMarks: 3 };

  it("returns the fallback when there is no blind spot", () => {
    expect(resolveFocusQType([], new Map(), null, "mcq_single")).toBe("mcq_single");
  });

  it("resolves to the ternary type behind an NG blind spot", () => {
    const perQuestion = [{ number: 1, qtype: "tfng" }, { number: 2, qtype: "tfng" }];
    const meta = new Map([
      [1, { accept: ["NOT GIVEN"] }],
      [2, { accept: ["NOT GIVEN"] }],
    ]);
    expect(resolveFocusQType(perQuestion, meta, ngBlindSpot, null)).toBe("tfng");
  });

  it("picks the majority qtype when an NG blind spot mixes tfng and ynng questions", () => {
    const perQuestion = [
      { number: 1, qtype: "tfng" },
      { number: 2, qtype: "tfng" },
      { number: 3, qtype: "ynng" },
    ];
    const meta = new Map([
      [1, { accept: ["NOT GIVEN"] }],
      [2, { accept: ["NOT GIVEN"] }],
      [3, { accept: ["NOT GIVEN"] }],
    ]);
    expect(resolveFocusQType(perQuestion, meta, ngBlindSpot, null)).toBe("tfng");
  });

  it("resolves to the generalized blind spot's own type", () => {
    const perQuestion = [{ number: 1, qtype: "matching_headings" }, { number: 2, qtype: "mcq_single" }];
    const meta = new Map([
      [1, { accept: ["B"] }],
      [2, { accept: ["A"] }],
    ]);
    expect(resolveFocusQType(perQuestion, meta, generalBlindSpot, null)).toBe("matching_headings");
  });

  it("falls back when no question actually belongs to the blind spot", () => {
    const perQuestion = [{ number: 1, qtype: "mcq_single" }];
    const meta = new Map([[1, { accept: ["A"] }]]);
    expect(resolveFocusQType(perQuestion, meta, generalBlindSpot, "mcq_single")).toBe("mcq_single");
  });
});

describe("buildShareHeadline", () => {
  it("has no trailing colon in either branch", () => {
    expect(buildShareHeadline(true, 6.5, 78, "reading")).not.toMatch(/:$/);
    expect(buildShareHeadline(false, null, 42, "reading")).not.toMatch(/:$/);
  });

  it("uses the banded copy when a band score is present", () => {
    expect(buildShareHeadline(true, 6.5, 78, "reading")).toBe(
      "I just hit Band 6.5 on IELTS Reading with bando — and finally found the one habit costing me marks.",
    );
  });

  it("uses the percentage copy when there is no band", () => {
    expect(buildShareHeadline(false, null, 42, "reading")).toBe(
      "I scored 42% on IELTS Reading with bando and pinned down exactly which question type is costing me marks.",
    );
  });

  it("interpolates IELTS Listening for the listening section", () => {
    expect(buildShareHeadline(true, 6.5, 78, "listening")).toBe(
      "I just hit Band 6.5 on IELTS Listening with bando — and finally found the one habit costing me marks.",
    );
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
