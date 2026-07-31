import { describe, it, expect } from "vitest";
import { withUnderlengthFlag } from "./underlength";
import type { Feedback } from "./evaluator/types";

// Minimal well-formed feedback; tests override only what they assert on.
function baseFeedback(overrides: Partial<Feedback> = {}): Feedback {
  return {
    bandLow: 6.0,
    bandHigh: 6.5,
    confidence: "medium",
    criteria: [
      { name: "task_response", bandLow: 6.0, bandHigh: 6.5, strength: "a", mainIssue: "b", nextStep: "c" },
      { name: "coherence_cohesion", bandLow: 6.0, bandHigh: 6.5, strength: "a", mainIssue: "b", nextStep: "c" },
      { name: "lexical_resource", bandLow: 5.5, bandHigh: 6.0, strength: "a", mainIssue: "b", nextStep: "c" },
      { name: "grammar_accuracy", bandLow: 6.0, bandHigh: 6.5, strength: "a", mainIssue: "b", nextStep: "c" },
    ],
    topFixes: ["clarify thesis"],
    annotations: [],
    rewrite: { thesisOld: "o", thesis: "t", paragraph: "p", replacements: [] },
    checklist: ["clear position"],
    ...overrides,
  };
}

describe("withUnderlengthFlag", () => {
  it("adds an underlength fix when the essay is under 250 words", () => {
    const out = withUnderlengthFlag(baseFeedback(), 162);
    expect(out.topFixes[0]).toMatch(/162 words/);
    expect(out.topFixes[0]).toMatch(/250/);
  });

  it("leaves feedback untouched at exactly 250 words (250 is the minimum, not below it)", () => {
    const fb = baseFeedback();
    expect(withUnderlengthFlag(fb, 250)).toEqual(fb);
  });

  it("leaves feedback untouched above 250 words", () => {
    const fb = baseFeedback();
    expect(withUnderlengthFlag(fb, 280)).toEqual(fb);
  });

  it("flags a very short essay without touching the bands (no hard band cap)", () => {
    const fb = baseFeedback({ bandLow: 7.0, bandHigh: 7.5 });
    const out = withUnderlengthFlag(fb, 30);
    expect(out.topFixes[0]).toMatch(/30 words/);
    expect(out.bandLow).toBe(7.0);
    expect(out.bandHigh).toBe(7.5);
    expect(out.criteria).toEqual(fb.criteria);
  });

  it("does not duplicate when the model already flagged underlength", () => {
    const fb = baseFeedback({
      topFixes: ["Your essay is only 200 words, below the 250-word minimum — expand it."],
    });
    const out = withUnderlengthFlag(fb, 200);
    expect(out.topFixes).toEqual(fb.topFixes);
  });

  it("keeps topFixes within the schema max of 3, underlength first", () => {
    const fb = baseFeedback({ topFixes: ["fix one", "fix two", "fix three"] });
    const out = withUnderlengthFlag(fb, 100);
    expect(out.topFixes).toHaveLength(3);
    expect(out.topFixes[0]).toMatch(/100 words/);
    expect(out.topFixes).toContain("fix one");
    expect(out.topFixes).toContain("fix two");
  });
});
