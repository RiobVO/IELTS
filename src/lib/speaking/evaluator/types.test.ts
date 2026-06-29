import { describe, it, expect } from "vitest";
import { FeedbackSchema } from "./types";

const valid = {
  bandLow: 6, bandHigh: 6.5, confidence: "high", transcript: "I would like to talk about...",
  criteria: ["fluency_coherence", "lexical_resource", "grammar_accuracy", "pronunciation"].map((name) => ({
    name, bandLow: 6, bandHigh: 6.5, strength: "s", mainIssue: "m", nextStep: "n",
  })),
  topFixes: ["fix one"], annotations: [], drills: ["drill one"], rewrites: [],
};

describe("Speaking FeedbackSchema", () => {
  it("accepts a valid feedback object", () => {
    expect(FeedbackSchema.parse(valid)).toBeTruthy();
  });
  it("rejects when criteria != 4", () => {
    expect(() => FeedbackSchema.parse({ ...valid, criteria: valid.criteria.slice(0, 3) })).toThrow();
  });
});
