// Server-side grading (BRIEF §5.1). The client NEVER sends a score; this runs
// only on the server with the answer key. Three modes route by how the answer
// is stored (BRIEF §4.2): mcq_set / text_accept / exact.

export type AnswerMode = "mcq_set" | "text_accept" | "exact";

export interface GradeKey {
  number: number;
  qtype: string;
  mode: AnswerMode;
  accept: string[];
}

export interface PerQuestionResult {
  number: number;
  qtype: string;
  given: string | string[] | null;
  correct: boolean;
}

export interface GradeResult {
  rawScore: number;
  total: number;
  percent: number;
  perType: Record<string, { correct: number; total: number }>;
  perQuestion: PerQuestionResult[];
}

/** trim + uppercase + collapse internal whitespace (BRIEF §4.2). */
const norm = (s: unknown): string =>
  String(s ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");

export function isCorrect(
  mode: AnswerMode,
  accept: string[],
  given: string | string[] | null | undefined,
): boolean {
  if (given == null) return false;
  if (typeof given === "string" && given.trim() === "") return false;

  if (mode === "mcq_set") {
    const g = Array.isArray(given)
      ? given
      : String(given).split(/[\s,]+/).filter(Boolean);
    const want = new Set(accept.map(norm));
    const got = new Set(g.map(norm));
    return want.size === got.size && [...want].every((x) => got.has(x));
  }

  const single = Array.isArray(given) ? (given[0] ?? "") : given;
  if (mode === "text_accept") return accept.map(norm).includes(norm(single));
  return norm(accept[0] ?? "") === norm(single); // exact
}

export function grade(
  keys: GradeKey[],
  answers: Record<string, string | string[] | null>,
): GradeResult {
  const perType: Record<string, { correct: number; total: number }> = {};
  const perQuestion: PerQuestionResult[] = [];
  let rawScore = 0;

  for (const k of keys) {
    const given = answers[String(k.number)] ?? null;
    const ok = isCorrect(k.mode, k.accept, given);
    if (ok) rawScore++;
    (perType[k.qtype] ??= { correct: 0, total: 0 }).total++;
    if (ok) perType[k.qtype].correct++;
    perQuestion.push({ number: k.number, qtype: k.qtype, given, correct: ok });
  }

  const total = keys.length;
  return {
    rawScore,
    total,
    percent: total ? Math.round((rawScore / total) * 100) : 0,
    perType,
    perQuestion,
  };
}
