import { GoogleGenAI } from "@google/genai";
import { writingEvalConfig } from "@/env";
import { buildPrompt, PROMPT_VERSION } from "./prompt";
import { FeedbackSchema, feedbackResponseSchema, type EvaluateInput, type EvaluateResult } from "./types";

// Single Gemini call → JSON → Zod-validate. Throws on missing config, transport
// error, non-JSON, or schema mismatch; the caller (route, Plan 3) maps that to a
// failed submission. Cost metrics later: res.usageMetadata.{prompt,candidates,total}TokenCount.
export async function evaluateWithGemini(input: EvaluateInput): Promise<EvaluateResult> {
  const cfg = writingEvalConfig();
  if (!cfg) throw new Error("Writing evaluator not configured (GEMINI_API_KEY / WRITING_EVAL_MODEL)");
  const { apiKey, model } = cfg;

  const ai = new GoogleGenAI({ apiKey });
  const res = await ai.models.generateContent({
    model,
    contents: buildPrompt(input),
    config: { responseMimeType: "application/json", responseSchema: feedbackResponseSchema },
  });

  const raw = res.text ?? "";
  const feedback = FeedbackSchema.parse(JSON.parse(raw)); // throws → caller handles
  return { feedback, raw, provider: "gemini", model, promptVersion: PROMPT_VERSION };
}
