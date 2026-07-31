import type { EvaluateInput } from "./types";

export const PROMPT_VERSION = "writing-task2-v1";

// Rubric-anchored prompt for IELTS Writing Task 2. Returns a band RANGE + confidence
// + per-criterion verdicts tied to the essay, top-3 fixes, inline annotations, a
// PARTIAL rewrite (not the whole essay), and a next-attempt checklist. The model is
// an estimating coach, NOT an authoritative examiner (spec non-goals).
export function buildPrompt({ essay, taskPrompt, category }: EvaluateInput): string {
  return [
    "You are an IELTS Writing coach. Assess the candidate's Task 2 essay against the",
    "four official band descriptors. You are NOT issuing an official score — give an",
    "ESTIMATED band RANGE (e.g. 6.0–6.5) with a confidence level, then actionable coaching.",
    "",
    `Test type: ${category === "academic" ? "Academic" : "General Training"} Task 2.`,
    "",
    "Score each criterion as a band range with one strength, one main issue, and one",
    "concrete next step:",
    "- task_response (Task Response): position, development, relevance.",
    "- coherence_cohesion (Coherence and Cohesion): organisation, paragraphing, linking.",
    "- lexical_resource (Lexical Resource): range, precision, repetition.",
    "- grammar_accuracy (Grammatical Range and Accuracy): structures, error density.",
    "",
    "Then: overall band range + confidence (low|medium|high), top 3 fixes (most",
    "impactful first), short inline annotations quoting the essay — each tagged with a",
    "type: good (a strong move to reinforce), style (style/clarity), or grammar (a",
    "grammar/accuracy slip) — a PARTIAL rewrite (the candidate's original thesis",
    "verbatim as thesisOld, an improved thesis, one rewritten paragraph, and",
    "weak-phrase replacements — do NOT rewrite the whole essay), and a next-attempt",
    "checklist.",
    "",
    "If the essay is too short or off-topic to judge, set confidence='low' and say so",
    "in the criteria notes rather than inventing a score.",
    "",
    "<task_prompt>",
    taskPrompt,
    "</task_prompt>",
    "",
    "<essay>",
    essay,
    "</essay>",
  ].join("\n");
}
