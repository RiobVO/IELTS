import type { Feedback } from "./evaluator/types";

type CriterionName = Feedback["criteria"][number]["name"];

// Internal enum → official IELTS descriptor names shown in the UI. Only the first
// criterion differs by part: it is "Task Response" for Task 2 (essay) and "Task
// Achievement" for Task 1 (chart description); the other three are identical. The
// JSON key stays "task_response" either way (the FeedbackSchema is shared).
const CRITERION_LABEL: Record<CriterionName, string> = {
  task_response: "Task Response",
  coherence_cohesion: "Coherence and Cohesion",
  lexical_resource: "Lexical Resource",
  grammar_accuracy: "Grammatical Range and Accuracy",
};
export const criterionLabel = (n: CriterionName, taskPart: "task1" | "task2" = "task2") =>
  taskPart === "task1" && n === "task_response" ? "Task Achievement" : CRITERION_LABEL[n];

export const writingCategoryLabel = (c: "academic" | "general") =>
  c === "academic" ? "Academic" : "General Training";

export const confidenceLabel = (c: "low" | "medium" | "high") =>
  c.charAt(0).toUpperCase() + c.slice(1);
