import type { Evaluator } from "./types";
import { evaluateWithGemini } from "./gemini";
export type { EvaluateInput, EvaluateResult, Feedback, Evaluator } from "./types";
export { FeedbackSchema } from "./types";

export function getEvaluator(): Evaluator {
  return { evaluate: evaluateWithGemini };
}
