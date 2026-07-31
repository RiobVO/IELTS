import { describe, it, expect } from "vitest";
import { FeedbackSchema } from "./types";

const valid = {
  bandLow: 6.0,
  bandHigh: 6.5,
  confidence: "medium",
  criteria: [
    { name: "task_response", bandLow: 6.0, bandHigh: 6.5, strength: "clear position", mainIssue: "thin examples", nextStep: "develop one example fully" },
    { name: "coherence_cohesion", bandLow: 6.0, bandHigh: 6.5, strength: "logical paragraphs", mainIssue: "weak linking", nextStep: "vary cohesive devices" },
    { name: "lexical_resource", bandLow: 5.5, bandHigh: 6.0, strength: "topic vocab", mainIssue: "repetition", nextStep: "replace repeated words" },
    { name: "grammar_accuracy", bandLow: 6.0, bandHigh: 6.5, strength: "mixed structures", mainIssue: "article slips", nextStep: "proofread articles" },
  ],
  topFixes: ["clarify thesis", "add specific example", "reduce repeated vocabulary"],
  annotations: [{ quote: "Many people think...", comment: "too general — be specific", type: "style" }],
  rewrite: { thesisOld: "Original thesis sentence.", thesis: "Improved thesis sentence.", paragraph: "One rewritten body paragraph.", replacements: [{ from: "good", to: "beneficial" }] },
  checklist: ["clear position", "two developed ideas", "paragraph links", "fewer grammar slips"],
};

describe("FeedbackSchema", () => {
  it("accepts a well-formed feedback object", () => {
    expect(FeedbackSchema.parse(valid)).toMatchObject({ bandLow: 6.0, confidence: "medium" });
  });
  it("rejects an out-of-range band", () => {
    expect(() => FeedbackSchema.parse({ ...valid, bandHigh: 12 })).toThrow();
  });
  it("rejects an unknown confidence", () => {
    expect(() => FeedbackSchema.parse({ ...valid, confidence: "certain" })).toThrow();
  });
  it("requires exactly 4 criteria", () => {
    expect(() => FeedbackSchema.parse({ ...valid, criteria: valid.criteria.slice(0, 3) })).toThrow();
  });
  it("requires an annotation type in good|style|grammar", () => {
    expect(FeedbackSchema.safeParse({ ...valid, annotations: [{ quote: "x", comment: "y", type: "good" }] }).success).toBe(true);
    expect(FeedbackSchema.safeParse({ ...valid, annotations: [{ quote: "x", comment: "y" }] }).success).toBe(false);
    expect(FeedbackSchema.safeParse({ ...valid, annotations: [{ quote: "x", comment: "y", type: "bogus" }] }).success).toBe(false);
  });
  it("requires rewrite.thesisOld", () => {
    const { thesisOld: _omit, ...rewriteNoOld } = valid.rewrite;
    void _omit;
    expect(FeedbackSchema.safeParse({ ...valid, rewrite: rewriteNoOld }).success).toBe(false);
  });
  it("accepts the optional delta/technique rewrite fields when present", () => {
    const rewrite = {
      ...valid.rewrite,
      thesisMoves: [{ quote: "Improved thesis", label: "Concession" }],
      paragraphMoves: ["Topic sentence", "Formal register"],
      paragraphOld: "The candidate's original paragraph.",
    };
    expect(FeedbackSchema.safeParse({ ...valid, rewrite }).success).toBe(true);
  });
  it("stays valid when the optional rewrite fields are absent (older snapshots)", () => {
    expect(FeedbackSchema.safeParse(valid).success).toBe(true);
  });
});
