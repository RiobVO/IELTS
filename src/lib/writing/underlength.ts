import { TASK2_MIN_WORDS } from "./lifecycle";
import type { Feedback } from "./evaluator/types";

// Deterministic underlength safety net. Length is a server fact (the submission's
// stored wordCount), never the model's count — so a short essay ALWAYS surfaces an
// underlength warning even if the model forgot it. We add a signal, not a band cap:
// the band stays the model's call (CLAUDE.md / spec — no uncalibrated heuristics).

/** The candidate-facing underlength fix (English UI copy). */
function underlengthFix(wordCount: number): string {
  return `Your essay is ${wordCount} words — below the ${TASK2_MIN_WORDS}-word minimum for Task 2. This is a major Task Response limitation; aim for at least ${TASK2_MIN_WORDS} words next time.`;
}

// TIGHT, length-specific phrases only. Precision over recall on purpose: a missed
// match merely yields a (mild) duplicate, whereas a false match would SUPPRESS a
// mandatory warning. So we only treat the clearest underlength wording as "already
// said" — generic vocab/grammar advice never matches.
const ALREADY_FLAGGED =
  /\b250\b|word count|word limit|word minimum|word requirement|under[\s-]?length|too short|below the (minimum|word)/i;

function alreadyFlagged(f: Feedback): boolean {
  const text = [
    ...f.topFixes,
    ...f.checklist,
    ...f.criteria.flatMap((c) => [c.strength, c.mainIssue, c.nextStep]),
    ...f.annotations.map((a) => a.comment),
  ].join("\n");
  return ALREADY_FLAGGED.test(text);
}

/**
 * If the essay is under the Task 2 minimum, guarantee an underlength fix at the top
 * of topFixes (the most-impactful slot, already rendered on /result) — unless the
 * model already raised it. Pure: returns the same object unchanged when ≥ minimum.
 */
export function withUnderlengthFlag(feedback: Feedback, wordCount: number): Feedback {
  if (wordCount >= TASK2_MIN_WORDS) return feedback;
  if (alreadyFlagged(feedback)) return feedback;
  // Prepend as fix #1; keep within the schema's max of 3 (drops the least-impactful).
  const topFixes = [underlengthFix(wordCount), ...feedback.topFixes].slice(0, 3);
  return { ...feedback, topFixes };
}
