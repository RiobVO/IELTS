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
  annotations: [{ quote: "Many people think...", comment: "too general — be specific" }],
  rewrite: { thesis: "Improved thesis sentence.", paragraph: "One rewritten body paragraph.", replacements: [{ from: "good", to: "beneficial" }] },
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
});
