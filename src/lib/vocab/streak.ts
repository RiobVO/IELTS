/**
 * Приватный vocab-стрик (план V3): сколько дней подряд (по UTC) пользователь делал
 * повторы, заканчивая сегодняшним днём. Если сегодня повторов ещё не было, но было
 * вчера — стрик ЖИВ (сегодняшний день просто не закрыт), считаем от вчера. Разрыв в
 * цепочке останавливает счёт.
 *
 * Чистая функция без IO: distinct UTC-дни (из vocab_progress.last_reviewed_at)
 * приходят из queries.ts, здесь только арифметика по дням — покрывается юнит-тестами
 * (streak.test.ts). НИКАК не связан с profile.current_streak / рейтингом / XP.
 */

/** ISO-дата 'YYYY-MM-DD' (UTC) → номер дня от эпохи (для проверки соседства дней). */
function isoToDayNumber(isoDate: string): number {
  return Math.floor(Date.parse(`${isoDate}T00:00:00Z`) / 86_400_000);
}

/**
 * @param reviewDaysUtc distinct UTC-дни с повторами, формат 'YYYY-MM-DD' (порядок и
 *   дубли не важны).
 * @param todayUtc      текущий UTC-день, формат 'YYYY-MM-DD'.
 * @returns длина непрерывной цепочки дней с повторами, заканчивающейся сегодня или
 *   (если сегодня пусто) вчера; иначе 0.
 */
export function computeStreak(reviewDaysUtc: string[], todayUtc: string): number {
  const days = new Set(reviewDaysUtc.map(isoToDayNumber));
  const today = isoToDayNumber(todayUtc);

  // Точка отсчёта: сегодня (если повтор был) либо вчера (стрик ещё жив). Иначе разрыв.
  let cursor: number;
  if (days.has(today)) cursor = today;
  else if (days.has(today - 1)) cursor = today - 1;
  else return 0;

  let streak = 0;
  while (days.has(cursor)) {
    streak += 1;
    cursor -= 1;
  }
  return streak;
}
