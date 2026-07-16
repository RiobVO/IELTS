/**
 * Section progress (Reading/Listening skill-cards, /app/practice) — «пройдено N из M,
 * осталось K». Знаменатель `total` — ВЕСЬ опубликованный каталог секции, тот же
 * набор, что даёт карте строку «N tests» — счётчик обязан с ней согласовываться.
 *
 * Был startable-вариант (total только по кликабельным сейчас тестам) — отвергнут
 * живым прогоном на проде 2026-07-16 (Basic-аккаунт владельца): на Reading карта
 * читала «4 tests» / «All 2 done» (2 из 4 locked → нечитаемый бред), на Listening
 * (все 3 теста locked) total схлопывался в 0 и строка исчезала целиком. Недоступность
 * по тиру юзер и так видит на самих строках списка (замок/Unlock) — «K left» под
 * замком осознанно остаётся в счёте, это upsell-точка, а не баг.
 */

export interface SectionProgress {
  done: number;
  total: number;
  left: number;
}

/** `total` = tests.length (весь published-каталог секции), `done` = attempted среди
 *  них, `left = total − done`. */
export function computeSectionProgress(
  tests: ReadonlyArray<{ id: string }>,
  attemptedIds: ReadonlySet<string>,
): SectionProgress {
  const total = tests.length;
  let done = 0;
  for (const t of tests) {
    if (attemptedIds.has(t.id)) done += 1;
  }
  return { done, total, left: total - done };
}
