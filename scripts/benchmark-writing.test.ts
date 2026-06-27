import { describe, it, expect } from "vitest";
import { withinHalfBand, bandMid, accuracy, meanBias } from "./benchmark-writing";

describe("benchmark metrics", () => {
  it("bandMid averages the range", () => {
    expect(bandMid({ bandLow: 6.0, bandHigh: 6.5 })).toBe(6.25);
  });
  it("withinHalfBand true when |mid - truth| <= 0.5", () => {
    expect(withinHalfBand(6.25, 6.5)).toBe(true);
    expect(withinHalfBand(6.25, 7.0)).toBe(false);
  });
  it("accuracy is the share within ±0.5", () => {
    expect(accuracy([{ predMid: 6.0, truth: 6.0 }, { predMid: 6.0, truth: 7.0 }])).toBe(0.5);
  });
  it("meanBias is the mean signed error (positive = leans high)", () => {
    expect(meanBias([{ predMid: 6.5, truth: 6.0 }, { predMid: 7.0, truth: 6.5 }])).toBe(0.5);
    expect(meanBias([{ predMid: 5.5, truth: 6.0 }, { predMid: 6.0, truth: 6.5 }])).toBe(-0.5);
    expect(meanBias([])).toBe(0);
  });
});
