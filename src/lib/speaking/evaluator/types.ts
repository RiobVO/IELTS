import { z } from "zod";

// Band 0–9 in 0.5 steps; we store a range, not a point (spec: estimate, not authoritative).
const band = z.number().min(0).max(9);

// Annotation type drives the legend + transcript tint + comment-card accent in the UI:
// pause/filler/repair surface hesitation, grammar a slip, good a strong move to reinforce.
const AnnotationType = z.enum(["pause", "filler", "repair", "grammar", "good"]);

const CriterionSchema = z.object({
  name: z.enum(["fluency_coherence", "lexical_resource", "grammar_accuracy", "pronunciation"]),
  bandLow: band,
  bandHigh: band,
  strength: z.string().min(1),
  mainIssue: z.string().min(1),
  nextStep: z.string().min(1),
});

export const FeedbackSchema = z.object({
  bandLow: band,
  bandHigh: band,
  confidence: z.enum(["low", "medium", "high"]),
  transcript: z.string(),
  criteria: z.array(CriterionSchema).length(4),
  topFixes: z.array(z.string().min(1)).min(1).max(3),
  annotations: z.array(z.object({ quote: z.string(), comment: z.string(), type: AnnotationType })),
  drills: z.array(z.string().min(1)),
  // "Say it stronger" (#1): 2–3 of the candidate's OWN weak-but-fixable lines upgraded to
  // band 7–8. Empty on a short / no-speech answer (nothing worth rewriting).
  rewrites: z.array(z.object({ original: z.string().min(1), improved: z.string().min(1) })).max(3),
});
export type Feedback = z.infer<typeof FeedbackSchema>;

export const feedbackResponseSchema = z.toJSONSchema(FeedbackSchema);

export interface EvaluateInput {
  audio: { data: string; mimeType: string }; // base64 + MIME (audio/webm | audio/mp4)
  cueCard: { prompt: string; bullets: string[]; closingPrompt: string };
}
export interface EvaluateResult {
  feedback: Feedback;
  raw: string;
  provider: string;
  model: string;
  promptVersion: string;
}
export interface Evaluator {
  evaluate(input: EvaluateInput): Promise<EvaluateResult>;
}
