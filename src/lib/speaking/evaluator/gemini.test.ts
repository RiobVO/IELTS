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
// Mock @/env so importing gemini.ts doesn't trip the module-load env validation.
vi.mock("@/env", () => ({ speakingEvalConfig: () => ({ apiKey: "test-key", model: "gemini-2.5-flash" }) }));

import { evaluateWithGemini } from "./gemini";

const fb = {
  bandLow: 6, bandHigh: 6.5, confidence: "high", transcript: "um, I would like...",
  criteria: ["fluency_coherence", "lexical_resource", "grammar_accuracy", "pronunciation"].map((name) => ({
    name, bandLow: 6, bandHigh: 6.5, strength: "s", mainIssue: "m", nextStep: "n",
  })),
  topFixes: ["fix"], annotations: [{ quote: "um", comment: "filled pause", type: "filler" }], drills: ["d"],
  rewrites: [{ original: "I would like", improved: "I'd like to" }],
};

beforeEach(() => generateContent.mockReset());

describe("evaluateWithGemini (audio)", () => {
  it("sends audio inline + validates the JSON", async () => {
    generateContent.mockResolvedValue({ text: JSON.stringify(fb) });
    const r = await evaluateWithGemini({
      audio: { data: "AAAA", mimeType: "audio/webm" },
      cueCard: { prompt: "Describe a skill", bullets: ["b1", "b2", "b3"], closingPrompt: "and explain why" },
    });
    expect(r.feedback.criteria).toHaveLength(4);
    expect(r.provider).toBe("gemini");
    expect(r.promptVersion).toBe("speaking-part2-v3");
    const arg = generateContent.mock.calls[0][0];
    expect(arg.contents[1].inlineData.mimeType).toBe("audio/webm");
  });
  it("throws on a schema-invalid response (caller fails the submission)", async () => {
    generateContent.mockResolvedValue({ text: JSON.stringify({ ...fb, confidence: "certain" }) });
    await expect(
      evaluateWithGemini({
        audio: { data: "AAAA", mimeType: "audio/webm" },
        cueCard: { prompt: "p", bullets: ["b"], closingPrompt: "c" },
      }),
    ).rejects.toThrow();
  });
});
