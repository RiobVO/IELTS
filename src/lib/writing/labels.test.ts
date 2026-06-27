import { describe, it, expect } from "vitest";
import { criterionLabel } from "./labels";

describe("criterionLabel", () => {
  it("Task 2 (default): first criterion is 'Task Response'", () => {
    expect(criterionLabel("task_response")).toBe("Task Response");
    expect(criterionLabel("task_response", "task2")).toBe("Task Response");
  });
  it("Task 1: first criterion is 'Task Achievement'", () => {
    expect(criterionLabel("task_response", "task1")).toBe("Task Achievement");
  });
  it("the other three labels are identical across parts", () => {
    for (const name of ["coherence_cohesion", "lexical_resource", "grammar_accuracy"] as const) {
      expect(criterionLabel(name, "task1")).toBe(criterionLabel(name, "task2"));
    }
    expect(criterionLabel("grammar_accuracy", "task1")).toBe("Grammatical Range and Accuracy");
  });
});
