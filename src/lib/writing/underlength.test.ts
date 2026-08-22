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

  // Fix 2026-07-19: bare \b150\b|\b250\b in ALREADY_FLAGGED suppressed the mandatory
  // warning whenever a scanned field mentioned the number in an UNRELATED context.
  it("keeps the safety net when a scanned field mentions 250 in an unrelated context", () => {
    const fb = baseFeedback({
      annotations: [{ quote: "improve", comment: "You should study 250 hours to improve.", type: "style" }],
    });
    const out = withUnderlengthFlag(fb, 200);
    expect(out.topFixes[0]).toMatch(/200 words/);
  });

  it("still dedupes on a length-context number without other trigger phrases (\"250-word\")", () => {
    // «250-word essay is required» не матчит ни одну словесную альтернативу
    // (word count/minimum/…), держится ТОЛЬКО на \b(150|250)[\s-]?words?\b.
    const fb = baseFeedback({ topFixes: ["A 250-word essay is required here."] });
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

  describe("Task 1 floor (minWords = 150)", () => {
    it("flags a sub-150 Task 1 response against the 150-word minimum", () => {
      const out = withUnderlengthFlag(baseFeedback(), 120, 150);
      expect(out.topFixes[0]).toMatch(/120 words/);
      expect(out.topFixes[0]).toMatch(/150/);
    });
    it("leaves a 150-word Task 1 response untouched (150 is the minimum, not below it)", () => {
      const fb = baseFeedback();
      expect(withUnderlengthFlag(fb, 150, 150)).toEqual(fb);
    });
    it("does NOT flag a 200-word response as Task 1 (≥150) though it would as Task 2 (<250)", () => {
      const fb = baseFeedback();
      expect(withUnderlengthFlag(fb, 200, 150)).toEqual(fb); // Task 1: fine
      expect(withUnderlengthFlag(fb, 200).topFixes[0]).toMatch(/200 words/); // Task 2 default: flagged
    });
  });
});
