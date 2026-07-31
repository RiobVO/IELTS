import { describe, it, expect } from "vitest";
import { axisPct, gapToTarget, confidencePills, midpoint, sortWeakestFirst, blockerIndex, buildAnnotationSegments } from "./feedback-view";

const crit = (name: string, lo: number, hi: number) => ({ name, bandLow: lo, bandHigh: hi, strength: "s", mainIssue: "m", nextStep: "n" });

describe("axisPct", () => {
  it("maps 4..9 → 0..100, clamps outside", () => {
    expect(axisPct(4)).toBe(0);
    expect(axisPct(9)).toBe(100);
    expect(axisPct(7)).toBe(60);
    expect(axisPct(3)).toBe(0);
    expect(axisPct(10)).toBe(100);
  });
});

describe("gapToTarget", () => {
  it("'+X to T' when below, 'at target' when reached", () => {
    expect(gapToTarget(6, 7)).toBe("+1 to 7.0");
    expect(gapToTarget(6.5, 7)).toBe("+0.5 to 7.0");
    expect(gapToTarget(7, 7)).toBe("at target");
    expect(gapToTarget(8, 7)).toBe("at target");
  });
});

describe("confidencePills", () => {
  it("low=1 medium=2 high=3", () => {
    expect(confidencePills("low")).toBe(1);
    expect(confidencePills("medium")).toBe(2);
    expect(confidencePills("high")).toBe(3);
  });
});

describe("sortWeakestFirst / blockerIndex", () => {
  const cs = [crit("a", 6, 6.5), crit("b", 5.5, 6), crit("c", 6, 6.5), crit("d", 6, 6.5)];
  it("midpoint", () => expect(midpoint(crit("x", 5.5, 6))).toBe(5.75));
  it("sorts ascending by midpoint, stable on ties", () => {
    const out = sortWeakestFirst(cs).map((c) => c.name);
    expect(out).toEqual(["b", "a", "c", "d"]);
  });
  it("blockerIndex = lowest midpoint, first on tie (original array index)", () => {
    expect(blockerIndex(cs)).toBe(1); // 'b'
    expect(blockerIndex([crit("a", 6, 6.5), crit("b", 6, 6.5)])).toBe(0);
  });
});

describe("buildAnnotationSegments", () => {
  it("wraps quotes in document order, annIndex points to the quote", () => {
    const segs = buildAnnotationSegments("the quick brown fox", ["quick", "fox"]);
    expect(segs).toEqual([
      { text: "the ", annIndex: null },
      { text: "quick", annIndex: 0 },
      { text: " brown ", annIndex: null },
      { text: "fox", annIndex: 1 },
    ]);
  });
  it("skips a quote not found, keeps the rest", () => {
    const segs = buildAnnotationSegments("hello world", ["world", "nope"]);
    expect(segs).toEqual([
      { text: "hello ", annIndex: null },
      { text: "world", annIndex: 0 },
    ]);
  });
  it("returns the whole essay as one plain segment when no quotes match", () => {
    expect(buildAnnotationSegments("plain text", ["zzz"])).toEqual([{ text: "plain text", annIndex: null }]);
  });
});
