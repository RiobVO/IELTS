import { GoogleGenAI, type PartUnion } from "@google/genai";
import { writingEvalConfig } from "@/env";
import { buildPrompt, PROMPT_VERSION } from "./prompt";
import { buildTask1Prompt, TASK1_PROMPT_VERSION } from "./prompt-task1";
import { FeedbackSchema, feedbackResponseSchema, type EvaluateInput, type EvaluateResult } from "./types";

// Single Gemini call → JSON → Zod-validate. Throws on missing config, transport
// error, non-JSON, or schema mismatch; the caller (route, Plan 3) maps that to a
// failed submission. Cost metrics later: res.usageMetadata.{prompt,candidates,total}TokenCount.
//
// Routes by task_part: Task 1 uses the vision prompt + version and attaches the visual
// as an inline_data part (bytes come pre-loaded in input.image — the evaluator never
// touches Storage). Task 2 stays a text-only essay call. Both keep the same
// responseSchema so the FeedbackSchema shape is API-guaranteed, not prompt-hoped.
export async function evaluateWithGemini(input: EvaluateInput): Promise<EvaluateResult> {
  const cfg = writingEvalConfig();
  if (!cfg) throw new Error("Writing evaluator not configured (GEMINI_API_KEY / WRITING_EVAL_MODEL)");
  const { apiKey, model } = cfg;

  const isTask1 = input.taskPart === "task1";
  const prompt = isTask1 ? buildTask1Prompt(input) : buildPrompt(input);
  const promptVersion = isTask1 ? TASK1_PROMPT_VERSION : PROMPT_VERSION;
  const contents: PartUnion[] = input.image
    ? [{ text: prompt }, { inlineData: { mimeType: input.image.mimeType, data: input.image.data } }]
    : [{ text: prompt }];

  const ai = new GoogleGenAI({ apiKey });
  const res = await ai.models.generateContent({
    model,
    contents,
    config: { responseMimeType: "application/json", responseSchema: feedbackResponseSchema },
  });

  const raw = res.text ?? "";
  const feedback = FeedbackSchema.parse(JSON.parse(raw)); // throws → caller handles
  return { feedback, raw, provider: "gemini", model, promptVersion };
}
