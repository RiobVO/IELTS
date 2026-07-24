/**
 * Onboarding mini-diagnostic (W1-2b). A self-contained 6-question test over one
 * short passage — NOT pulled from real content, because a Reading question is
 * meaningless without its passage, so a "mix from different tests" can't work.
 * It gives a new user a rough weakest-type signal in ~3 minutes without making a
 * full 40-question mock the price of first value.
 *
 * Grading is client-side (this is a non-rated diagnostic, so the keys here are
 * not secret like the real answer_key). qtype keys match the canon enum so
 * qtypeLabel() renders them. Pure function — trivial to reason about/test.
 */
export interface DiagQuestion {
  number: number;
  qtype: "tfng" | "sentence_completion" | "mcq_single";
  prompt: string;
  /** Choices for tfng / mcq_single. Absent → free-text (completion). */
  options?: string[];
  /** Correct answer, compared case-insensitively after trim. */
  answer: string;
}

export const DIAGNOSTIC_PASSAGE = `For most of human history, people slept in two distinct phases. Records from the seventeenth century describe a "first sleep" that began shortly after dusk, followed by a period of wakefulness around midnight, and then a "second sleep" until dawn. During the waking hours in between, people would read, pray, or visit neighbours. The arrival of artificial lighting changed this pattern. As streets and homes grew brighter in the evening, people went to bed later and consolidated their rest into a single block. Some researchers argue that the modern complaint of waking in the night is not a disorder at all, but a faint echo of this older, segmented rhythm. They suggest that lying awake calmly, rather than anxiously, may be closer to how humans are built to sleep.`;

export const DIAGNOSTIC_QUESTIONS: DiagQuestion[] = [
  {
    number: 1,
    qtype: "tfng",
    prompt: "People in the seventeenth century stayed awake for a period in the middle of the night.",
    options: ["TRUE", "FALSE", "NOT GIVEN"],
    answer: "TRUE",
  },
  {
    number: 2,
    qtype: "tfng",
    prompt: "Artificial lighting made people go to bed earlier in the evening.",
    options: ["TRUE", "FALSE", "NOT GIVEN"],
    answer: "FALSE",
  },
  {
    number: 3,
    qtype: "sentence_completion",
    prompt: "During the gap between sleeps, people would read, pray, or visit ______.",
    answer: "neighbours",
  },
  {
    number: 4,
    qtype: "sentence_completion",
    prompt: "Researchers describe the older sleep pattern as a ______ rhythm.",
    answer: "segmented",
  },
  {
    number: 5,
    qtype: "mcq_single",
    prompt: "According to the passage, the 'first sleep' began:",
    options: ["At midnight", "Shortly after dusk", "At dawn"],
    answer: "Shortly after dusk",
  },
  {
    number: 6,
    qtype: "mcq_single",
    prompt: "Some researchers suggest that waking in the night is:",
    options: ["A serious sleep disorder", "Caused only by lighting", "A natural echo of an older pattern"],
    answer: "A natural echo of an older pattern",
  },
];

export interface DiagnosticResult {
  weakType: string | null;
  perType: Record<string, { correct: number; total: number }>;
  correct: number;
  total: number;
}

/** Grade the answers and surface the weakest question type (null if all correct). */
export function gradeDiagnostic(answers: Record<number, string>): DiagnosticResult {
  const perType: Record<string, { correct: number; total: number }> = {};
  let correct = 0;
  const total = DIAGNOSTIC_QUESTIONS.length;

  for (const q of DIAGNOSTIC_QUESTIONS) {
    const given = (answers[q.number] ?? "").trim().toUpperCase();
    const ok = given !== "" && given === q.answer.trim().toUpperCase();
    const pt = perType[q.qtype] ?? { correct: 0, total: 0 };
    pt.total += 1;
    if (ok) {
      pt.correct += 1;
      correct += 1;
    }
    perType[q.qtype] = pt;
  }

  // Weakest = lowest correct ratio; ties resolve to the first type seen. All
  // correct → no weak spot (strong start).
  let weakType: string | null = null;
  let worst = Infinity;
  for (const [type, s] of Object.entries(perType)) {
    const ratio = s.correct / s.total;
    if (ratio < worst) {
      worst = ratio;
      weakType = type;
    }
  }
  if (correct === total) weakType = null;

  return { weakType, perType, correct, total };
}
