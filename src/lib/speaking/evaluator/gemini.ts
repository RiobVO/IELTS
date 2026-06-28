import { GoogleGenAI, type PartUnion } from "@google/genai";
import { speakingEvalConfig } from "@/env";
import { buildSpeakingPrompt, SPEAKING_PROMPT_VERSION } from "./prompt";
import { FeedbackSchema, feedbackResponseSchema, type EvaluateInput, type EvaluateResult } from "./types";

// Single audio-native Gemini call → JSON → Zod-validate. The recording is attached as
// an inline_data part (base64 bytes pre-loaded by the route via the service-role Storage
// client — the evaluator never touches Storage, mirroring writing/evaluator/gemini.ts).
// Throws on missing config, transport error, non-JSON, or schema mismatch; the route maps
// that to a failed submission.
export async function evaluateWithGemini(input: EvaluateInput): Promise<EvaluateResult> {
  const cfg = speakingEvalConfig();
  if (!cfg) throw new Error("Speaking evaluator not configured (GEMINI_API_KEY / SPEAKING_EVAL_MODEL)");
  const { apiKey, model } = cfg;

  const contents: PartUnion[] = [
    { text: buildSpeakingPrompt(input) },
    { inlineData: { mimeType: input.audio.mimeType, data: input.audio.data } },
  ];
  const ai = new GoogleGenAI({ apiKey });
  const res = await ai.models.generateContent({
    model,
    contents,
    config: { responseMimeType: "application/json", responseSchema: feedbackResponseSchema },
  });
  const raw = res.text ?? "";
  const feedback = FeedbackSchema.parse(JSON.parse(raw));
  return { feedback, raw, provider: "gemini", model, promptVersion: SPEAKING_PROMPT_VERSION };
}
