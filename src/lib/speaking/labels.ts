import type { Feedback } from "./evaluator/types";

type CriterionName = Feedback["criteria"][number]["name"];

// Internal enum → official IELTS Speaking descriptor names shown in the UI. Speaking
// is scored on the same four criteria the public band descriptors use; the JSON keys
// stay snake_case (the FeedbackSchema). Mirrors writing/labels.ts.
const CRITERION_LABEL: Record<CriterionName, string> = {
  fluency_coherence: "Fluency and Coherence",
  lexical_resource: "Lexical Resource",
  grammar_accuracy: "Grammatical Range and Accuracy",
  pronunciation: "Pronunciation",
};

export const speakingCriterionLabel = (n: CriterionName) => CRITERION_LABEL[n];

export const confidenceLabel = (c: "low" | "medium" | "high") =>
  c.charAt(0).toUpperCase() + c.slice(1);
