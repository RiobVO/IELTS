/**
 * Section progress (Reading/Listening skill-cards, /app/practice) — «пройдено N из M,
 * осталось K». Чистая функция: вызывающая сторона (app/app/practice/page.tsx) уже
 * знает, какой тест кликабелен (Start) и какой заблокирован (Unlock) — тот же
 * `startable`-флаг должен попасть сюда, а не пересчитываться заново, иначе счётчик
 * разойдётся с кнопками под ним (например, после понижения тира юзер видит "5 of 8",
 * а половина карточек в списке — 🔒).
 */

export interface SectionProgress {
  done: number;
  total: number;
  left: number;
}

/**
 * `total` — только startable-тесты (доступные юзеру прямо сейчас, как считает тот же
 * предикат, что рисует Start/Unlock). `done` — startable И attempted: тест, попытка
 * по которому есть, но который сейчас не startable (например, даунгрейд тира после
 * прохождения по trial), не попадает ни в total, ни в done — инвариант `done <= total`
 * держится всегда.
 */
export function computeSectionProgress(
  tests: ReadonlyArray<{ id: string; startable: boolean }>,
  attemptedIds: ReadonlySet<string>,
): SectionProgress {
  let total = 0;
  let done = 0;
  for (const t of tests) {
    if (!t.startable) continue;
    total += 1;
    if (attemptedIds.has(t.id)) done += 1;
  }
  return { done, total, left: total - done };
}
