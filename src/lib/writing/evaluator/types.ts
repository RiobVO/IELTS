import { z } from "zod";

// Band 0–9 in 0.5 steps; we store a range, not a point (spec: estimate, not authoritative).
const band = z.number().min(0).max(9);

// Annotation type drives the legend + <mark> tint + comment-card accent in the UI:
// good = a strong move to reinforce, style = style/clarity, grammar = a grammar slip.
const AnnotationType = z.enum(["good", "style", "grammar"]);

const CriterionSchema = z.object({
  name: z.enum(["task_response", "coherence_cohesion", "lexical_resource", "grammar_accuracy"]),
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
  criteria: z.array(CriterionSchema).length(4),
  topFixes: z.array(z.string().min(1)).min(1).max(3),
  annotations: z.array(z.object({ quote: z.string(), comment: z.string(), type: AnnotationType })),
  rewrite: z.object({
    thesisOld: z.string(), // candidate's original thesis — shown struck as "YOURS"
    thesis: z.string(), // the improved thesis — shown as "STRONGER"
    paragraph: z.string(),
    replacements: z.array(z.object({ from: z.string(), to: z.string() })),
  }),
  checklist: z.array(z.string().min(1)),
});

export type Feedback = z.infer<typeof FeedbackSchema>;

// Gemini responseSchema (OpenAPI-subset). VERIFIED at implementation: z.toJSONSchema
// (zod v4) emits a plain JSON Schema (minItems/maxItems/enum/minimum/maximum) and
// @google/genai types responseSchema as `SchemaUnion = Schema | unknown`, so this
// object is accepted by the SDK. Runtime fit with the live Gemini OpenAPI-subset
// (it ignores/forbids `$schema` + `additionalProperties`) is the ops-gate's concern
// — the benchmark run surfaces any rejection. If the live API rejects a construct,
// hand-author the equivalent JSON Schema here and keep FeedbackSchema for validation
// only. Tests are fully mocked, so this never hits a live call in CI.
export const feedbackResponseSchema = z.toJSONSchema(FeedbackSchema);

export interface EvaluateInput {
  essay: string;
  taskPrompt: string;
  category: "academic" | "general";
  wordCount: number; // server-trusted length (submission.wordCount), never the model's count
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
