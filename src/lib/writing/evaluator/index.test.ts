import { describe, it, expect, vi } from "vitest";
vi.mock("./gemini", () => ({ evaluateWithGemini: vi.fn(async () => ({ provider: "gemini", model: "m", raw: "{}", promptVersion: "writing-task2-v1", feedback: {} })) }));
import { getEvaluator } from "./index";

describe("getEvaluator", () => {
  it("returns an evaluator whose evaluate() delegates to the Gemini adapter", async () => {
    const r = await getEvaluator().evaluate({ essay: "e", taskPrompt: "t", category: "general", taskPart: "task2", wordCount: 280 });
    expect(r.provider).toBe("gemini");
  });
});
