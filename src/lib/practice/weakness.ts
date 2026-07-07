/**
 * Чистая агрегация «Weak spots» (Practice hub виджет) — БЕЗ IO-импортов (как
 * weakest-type.ts рядом в vocab/), поэтому тестируется без БД/env. Владелец
 * owner-path запроса — вызывающая страница (app/app/practice/page.tsx), тот же
 * приём, что дашборд (app/app/page.tsx) уже использует для своего weak-type блока.
 */

// Меньше 4 ответов по типу — шум, не сигнал; тип не показываем вовсе.
const DEFAULT_MIN_TOTAL = 4;
// Виджет показывает несколько худших типов, не весь разбор.
const DEFAULT_LIMIT = 5;

/** Сырая форма одной записи attempt.per_type_breakdown (см. app/app/practice/page.tsx). */
export type PerTypeBreakdown = Record<string, { correct?: unknown; total?: unknown }> | null | undefined;

export interface WeaknessRow {
  qtype: string;
  correct: number;
  total: number;
  /** Округлённый процент верных, 0–100. */
  pct: number;
}

/**
 * Суммирует per_type_breakdown нескольких попыток по qtype, отбрасывает типы ниже
 * min-порога надёжности (мало данных → не показываем) и возвращает слабейшие первыми
 * (при равном pct — надёжнее, т.е. с большим total, выше). Битые/null записи
 * (legacy-попытки без breakdown, испорченные поля) игнорируются молча — виджет не
 * должен падать на неполной истории.
 */
export function aggregateWeakness(
  breakdowns: PerTypeBreakdown[],
  opts: { minTotal?: number; limit?: number } = {},
): WeaknessRow[] {
  const minTotal = opts.minTotal ?? DEFAULT_MIN_TOTAL;
  const limit = opts.limit ?? DEFAULT_LIMIT;

  const agg: Record<string, { correct: number; total: number }> = {};
  for (const b of breakdowns) {
    if (!b || typeof b !== "object") continue;
    for (const [qtype, v] of Object.entries(b)) {
      if (!v || typeof v !== "object") continue;
      const correct = Number((v as { correct?: unknown }).correct);
      const total = Number((v as { total?: unknown }).total);
      if (!Number.isFinite(correct) || !Number.isFinite(total) || total <= 0) continue;
      const cur = agg[qtype] ?? { correct: 0, total: 0 };
      cur.correct += correct;
      cur.total += total;
      agg[qtype] = cur;
    }
  }

  return Object.entries(agg)
    .filter(([, v]) => v.total >= minTotal)
    .map(([qtype, v]) => ({ qtype, correct: v.correct, total: v.total, pct: Math.round((v.correct / v.total) * 100) }))
    .sort((a, b) => a.pct - b.pct || b.total - a.total)
    .slice(0, limit);
}
