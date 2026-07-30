import { evaluateWithGemini } from "./gemini";
import type { Evaluator } from "./types";

export type { Evaluator, EvaluateInput, EvaluateResult, Feedback } from "./types";

// MVP: a single provider (Gemini). The factory is the only thing Plan 3 imports —
// adding a second provider or a fallback later changes ONLY this file, never callers.
const geminiEvaluator: Evaluator = { evaluate: evaluateWithGemini };

export function getEvaluator(): Evaluator {
  return geminiEvaluator;
}
