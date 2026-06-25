import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted: the vi.mock factory is hoisted above this line, so the mock fn it
// references must be hoisted too (a plain `const` would ReferenceError at runtime).
const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }));
// GoogleGenAI is a class — gemini.ts does `new GoogleGenAI(...)`, so the mock impl
// must be a `function` (an arrow fn is not constructable → "not a constructor").
vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn(function () {
    return { models: { generateContent } };
  }),
}));
// env exposes writingEvalConfig() (getter style), not a bare env object — see src/env.ts.
vi.mock("@/env", () => ({ writingEvalConfig: () => ({ apiKey: "test-key", model: "gemini-2.5-flash-lite" }) }));

import { evaluateWithGemini } from "./gemini";

const validFeedback = {
  bandLow: 6.0, bandHigh: 6.5, confidence: "medium",
  criteria: [
    { name: "task_response", bandLow: 6, bandHigh: 6.5, strength: "a", mainIssue: "b", nextStep: "c" },
    { name: "coherence_cohesion", bandLow: 6, bandHigh: 6.5, strength: "a", mainIssue: "b", nextStep: "c" },
    { name: "lexical_resource", bandLow: 5.5, bandHigh: 6, strength: "a", mainIssue: "b", nextStep: "c" },
    { name: "grammar_accuracy", bandLow: 6, bandHigh: 6.5, strength: "a", mainIssue: "b", nextStep: "c" },
  ],
  topFixes: ["x"], annotations: [], rewrite: { thesis: "t", paragraph: "p", replacements: [] }, checklist: ["x"],
};
const input = { essay: "e", taskPrompt: "t", category: "academic" as const };

beforeEach(() => generateContent.mockReset());

describe("evaluateWithGemini", () => {
  it("returns validated feedback + metadata on a valid response", async () => {
    generateContent.mockResolvedValue({ text: JSON.stringify(validFeedback) });
    const r = await evaluateWithGemini(input);
    expect(r.feedback.bandLow).toBe(6.0);
    expect(r.provider).toBe("gemini");
    expect(r.model).toBe("gemini-2.5-flash-lite");
    expect(r.raw).toContain("bandLow");
  });
  it("throws on a schema-invalid response (caller retries/fails)", async () => {
    generateContent.mockResolvedValue({ text: JSON.stringify({ ...validFeedback, confidence: "certain" }) });
    await expect(evaluateWithGemini(input)).rejects.toThrow();
  });
  it("throws when the model returns non-JSON", async () => {
    generateContent.mockResolvedValue({ text: "I cannot help with that." });
    await expect(evaluateWithGemini(input)).rejects.toThrow();
  });
});
