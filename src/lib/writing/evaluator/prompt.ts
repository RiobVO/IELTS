import { TASK2_MIN_WORDS } from "../lifecycle";
import type { EvaluateInput } from "./types";

export const PROMPT_VERSION = "writing-task2-v2";

// Rubric-anchored prompt for IELTS Writing Task 2. Returns a band RANGE + confidence
// + per-criterion verdicts tied to the essay, top-3 fixes, inline annotations, a
// PARTIAL rewrite (not the whole essay), and a next-attempt checklist. The model is
// an estimating coach, NOT an authoritative examiner (spec non-goals).
export function buildPrompt({ essay, taskPrompt, category, wordCount }: EvaluateInput): string {
  // Deterministic length signal (server word count, not the model's). Only below the
  // minimum, so prompts for valid-length essays are byte-identical to before.
  const lengthCheck =
    wordCount < TASK2_MIN_WORDS
      ? [
          "",
          `LENGTH CHECK: This essay is ${wordCount} words. IELTS Writing Task 2 requires at`,
          `least ${TASK2_MIN_WORDS} words, so this response is UNDER the minimum. Treat underlength`,
          "as a PRIMARY Task Response limitation: penalise Task Response and do NOT award it a",
          "high band.",
        ]
      : [];
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
    "Band anchors for the OVERALL estimate — calibrate against these and USE THE FULL",
    "SCALE (0–9). Do NOT default to the middle; award a high band when the essay earns it:",
    "- Band 9: fully addresses the task, seamless cohesion, wide and precise vocabulary,",
    "  near error-free — only rare minor slips.",
    "- Band 8: fully developed position, well-organised; wide range of vocabulary and",
    "  structures with only occasional errors.",
    "- Band 7: addresses all parts with a clear, developed position; flexible vocabulary",
    "  and a variety of structures; errors are present but do not impede communication.",
    "- Band 6: addresses the task (focus may be unclear in places), generally organised;",
    "  adequate range; errors are noticeable but meaning stays clear.",
    "- Band 5: partial or underdeveloped response; limited range and flexibility;",
    "  frequent errors that occasionally strain the reader.",
    "- Band 4 or below: minimal, tangential or hard-to-follow response; errors that",
    "  frequently impede meaning.",
    "A well-developed, clearly-argued, mostly accurate essay is a band 7–8, NOT a band 6.",
    "Reserve band 5–6 for essays with genuine development, coherence or accuracy",
    "limitations — judge each criterion on its merits rather than clustering near 6.",
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
    ...lengthCheck,
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
