// Shared view helpers for the feedback sub-components. Re-exports the pure pieces
// from the lib layer + the annotation-type → token map (legend, <mark>, cards).

export { confidencePills, axisPct, gapToTarget } from "@/lib/writing/feedback-view";
export { confidenceLabel as confidenceLabelFor } from "@/lib/writing/labels";

export type AnnoType = "good" | "style" | "grammar";

export interface TypeStyle {
  accent: string; // text/border accent token
  tint: string; // subtle background token
  label: string; // comment-card label
  legend: string; // legend label
}

// MISSING tokens --success-border/--warn-border/--error-border → accent uses the
// existing --*-text tokens (handoff fallback noted in the plan).
export const TYPE_STYLE: Record<AnnoType, TypeStyle> = {
  good: { accent: "var(--success-text)", tint: "var(--success-subtle)", label: "Good move", legend: "Good move" },
  style: { accent: "var(--warn-text)", tint: "var(--warn-subtle)", label: "Style", legend: "Style & clarity" },
  grammar: { accent: "var(--error-text)", tint: "var(--error-subtle)", label: "Grammar", legend: "Grammar" },
};
