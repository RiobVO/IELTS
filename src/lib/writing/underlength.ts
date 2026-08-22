import { TASK2_MIN_WORDS } from "./lifecycle";
import type { Feedback } from "./evaluator/types";

// Deterministic underlength safety net. Length is a server fact (the submission's
// stored wordCount), never the model's count — so a short essay ALWAYS surfaces an
// underlength warning even if the model forgot it. We add a signal, not a band cap:
// the band stays the model's call (CLAUDE.md / spec — no uncalibrated heuristics).
// minWords is the part's official floor: 250 for Task 2, 150 for Task 1.

/** The candidate-facing underlength fix (English UI copy). */
function underlengthFix(wordCount: number, minWords: number): string {
  return `Your response is ${wordCount} words — below the ${minWords}-word minimum. This is a major task limitation; aim for at least ${minWords} words next time.`;
}

// TIGHT, length-specific phrases only. Precision over recall on purpose: a missed
// match merely yields a (mild) duplicate, whereas a false match would SUPPRESS a
// mandatory warning. So we only treat the clearest underlength wording as "already
// said" — generic vocab/grammar advice never matches. The minimums (150/250) count
// only with a length context («250-word», «150 words»): a bare number match
// suppressed the safety net on any unrelated mention (fix 2026-07-19).
const ALREADY_FLAGGED =
  /\b(150|250)[\s-]?words?\b|word count|word limit|word minimum|word requirement|under[\s-]?length|too short|below the (minimum|word)/i;

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
 * If the response is under its part's minimum, guarantee an underlength fix at the top
 * of topFixes (the most-impactful slot, already rendered on /result) — unless the
 * model already raised it. Pure: returns the same object unchanged when ≥ minimum.
 * minWords defaults to the Task 2 floor; the route passes 150 for Task 1.
 */
export function withUnderlengthFlag(
  feedback: Feedback,
  wordCount: number,
  minWords: number = TASK2_MIN_WORDS,
): Feedback {
  if (wordCount >= minWords) return feedback;
  if (alreadyFlagged(feedback)) return feedback;
  // Prepend as fix #1; keep within the schema's max of 3 (drops the least-impactful).
  const topFixes = [underlengthFix(wordCount, minWords), ...feedback.topFixes].slice(0, 3);
  return { ...feedback, topFixes };
}
