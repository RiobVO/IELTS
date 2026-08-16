import type { ParsedTest, ParsedPassage } from "../types";

export interface MergeResult {
  /** Слитый ParsedTest, либо исходный runner (тот же объект), если мерж не применён. */
  parsed: ParsedTest;
  /** Применена ли атомизация. */
  atomized: boolean;
  /** Причина пропуска — оседает в import_warnings (review-экран). */
  reason?: string;
}

/**
 * Прищепляет атомизацию (реальный текст пассажей + prompt/options) из parseTest к
 * базовому ParsedTest из parseRunner. Runner остаётся source of truth для всего, от
 * чего зависят mock и каталог: answer_key, qtype, groupKey, number, category,
 * duration, bandScale, tierRequired — из atom берутся ТОЛЬКО презентационные поля.
 *
 * Гейт: множества номеров вопросов должны совпасть 1:1 (без пропусков, лишних и
 * дублей в atom) — иначе доверять частичной атомизации нельзя, возвращаем runner
 * как есть (Practice остаётся practice-lite, mock не тронут). Тот же жёсткий гейт,
 * что в scripts/backfill-atomize.ts.
 */
export function mergeAtomization(runner: ParsedTest, atom: ParsedTest): MergeResult {
  const runnerNums = runner.questions.map((q) => q.number);
  const atomNums = atom.questions.map((q) => q.number);

  const seen = new Set<number>();
  const dupes = new Set<number>();
  for (const n of atomNums) {
    if (seen.has(n)) dupes.add(n);
    seen.add(n);
  }
  const runnerSet = new Set(runnerNums);
  const missing = runnerNums.filter((n) => !seen.has(n)); // есть в runner, нет в atom
  const extra = [...seen].filter((n) => !runnerSet.has(n)); // есть в atom, нет в runner

  if (dupes.size > 0 || missing.length > 0 || extra.length > 0) {
    const reason =
      `atomization skipped — question-number set mismatch ` +
      `(missing-in-atom=[${missing.sort((a, b) => a - b).join(",")}], ` +
      `extra-in-atom=[${extra.sort((a, b) => a - b).join(",")}], ` +
      `duplicates=[${[...dupes].sort((a, b) => a - b).join(",")}])`;
    return { parsed: runner, atomized: false, reason };
  }

  // Структурная целостность: каждый вопрос обязан ссылаться на реальный пассаж
  // atom, иначе persist смапит его на fallback (чужой пассаж) или уронит NOT NULL
  // passage_id при пустом наборе — регрессия против runner-only (1 fallback-пассаж).
  const atomOrders = new Set(atom.passages.map((p) => p.order));
  const orphanOrders = [
    ...new Set(atom.questions.map((q) => q.passageOrder).filter((o) => !atomOrders.has(o))),
  ].sort((a, b) => a - b);
  if (atom.passages.length === 0 || orphanOrders.length > 0) {
    const reason =
      `atomization skipped — question(s) reference missing passage order(s) ` +
      `[${orphanOrders.join(",")}] (atom passages: [${[...atomOrders].sort((a, b) => a - b).join(",")}])`;
    return { parsed: runner, atomized: false, reason };
  }

  // passages: берём атомизированные (order/title/bodyHtml/questionsHtml), но
  // audioPath НЕ затираем — он привязан на runner-пути (listening) и его у atom нет.
  const runnerAudioByOrder = new Map<number, string | null>(
    runner.passages.map((p) => [p.order, p.audioPath]),
  );
  const passages: ParsedPassage[] = atom.passages.map((p) => ({
    ...p,
    audioPath: runnerAudioByOrder.get(p.order) ?? p.audioPath ?? null,
  }));

  // questions: базовый ряд из runner (answer/qtype/groupKey/number/evidenceRef),
  // поверх — ТОЛЬКО презентация из atom, сматченная по номеру.
  const atomByNum = new Map(atom.questions.map((q) => [q.number, q]));
  const questions = runner.questions.map((rq) => {
    const aq = atomByNum.get(rq.number);
    if (!aq) return rq;
    return { ...rq, promptHtml: aq.promptHtml, options: aq.options, passageOrder: aq.passageOrder };
  });

  return { parsed: { ...runner, passages, questions }, atomized: true };
}
