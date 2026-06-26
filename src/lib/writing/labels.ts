import type { Feedback } from "./evaluator/types";

type CriterionName = Feedback["criteria"][number]["name"];

// Internal enum → official IELTS Task 2 descriptor names shown in the UI.
const CRITERION_LABEL: Record<CriterionName, string> = {
  task_response: "Task Response",
  coherence_cohesion: "Coherence and Cohesion",
  lexical_resource: "Lexical Resource",
  grammar_accuracy: "Grammatical Range and Accuracy",
};
export const criterionLabel = (n: CriterionName) => CRITERION_LABEL[n];

export const writingCategoryLabel = (c: "academic" | "general") =>
  c === "academic" ? "Academic" : "General Training";

export const confidenceLabel = (c: "low" | "medium" | "high") =>
  c.charAt(0).toUpperCase() + c.slice(1);
