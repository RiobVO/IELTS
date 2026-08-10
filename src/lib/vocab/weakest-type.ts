/**
 * Чистая логика выбора слабейшего типа вопросов (V10, /app/vocabulary) — БЕЗ
 * IO-импортов (как badge-criteria.ts рядом в progress/), поэтому тестируется без
 * БД/env. IO-обёртка (чтение попыток из БД, подбор дека) — в recommend.ts.
 */

/** Shape of an attempt's stored `per_type_breakdown` jsonb (as in badges.ts). */
export type PerTypeBreakdown = Record<string, { correct: number; total: number }>;

/**
 * Минимум суммарных вопросов по типу, чтобы считать точность по нему достоверной
 * (иначе 1-2 вопроса могут случайно обогнать честную статистику по другим типам).
 */
export const MIN_ATTEMPTS_FOR_WEAK_TYPE = 6;

/**
 * Слабейший тип вопросов по накопленной статистике: суммирует per_type_breakdown
 * по всем переданным попыткам (correct/total на тип), берёт тип с минимальной
 * точностью среди тех, что набрали >= MIN_ATTEMPTS_FOR_WEAK_TYPE вопросов суммарно.
 * Нет попыток / ни один тип не прошёл порог → null.
 */
export function computeWeakestType(breakdowns: Array<PerTypeBreakdown | null>): string | null {
  const agg: Record<string, { correct: number; total: number }> = {};
  for (const b of breakdowns) {
    if (!b) continue;
    for (const [type, v] of Object.entries(b)) {
      const cur = agg[type] ?? { correct: 0, total: 0 };
      cur.correct += Number(v?.correct) || 0;
      cur.total += Number(v?.total) || 0;
      agg[type] = cur;
    }
  }

  let weakest: string | null = null;
  let weakestAccuracy = Infinity;
  for (const [type, v] of Object.entries(agg)) {
    if (v.total < MIN_ATTEMPTS_FOR_WEAK_TYPE) continue;
    const accuracy = v.correct / v.total;
    if (accuracy < weakestAccuracy) {
      weakestAccuracy = accuracy;
      weakest = type;
    }
  }
  return weakest;
}
