/**
 * Чистая логика периодических уведомлений (daily-cron): UTC-даты и построение
 * dedup_key. Без server/db-зависимостей — импортируется cron-роутом и покрывается
 * vitest'ом. Семантика UTC-дня совпадает с streak-логикой (apply-post-submit:
 * toISOString().slice(0,10)), чтобы «стрик под угрозой» считался в той же таймзоне.
 */

/** UTC-календарный день (yyyy-mm-dd) даты. */
export function utcDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** UTC yyyy-mm-dd ровно на день раньше `day` (день = yyyy-mm-dd). */
export function prevUtcDateStr(day: string): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return utcDateStr(d);
}

/** Ключ дедупа vocab-due напоминания: одно на (user, UTC-день). */
export function vocabDueDedupKey(day: string): string {
  return `vocab_due:${day}`;
}

/** Ключ дедупа streak-напоминания: одно на (user, UTC-день). */
export function streakDedupKey(day: string): string {
  return `streak:${day}`;
}

/**
 * Пороги тишины для реактивации (G2-4), в днях с последней активности. Два, а не
 * один: первый ловит «закрутился и забыл», второй — тех, кого первый не поднял.
 * Дальше не преследуем — третье письмо в пустоту читается как спам и стоит отписки.
 */
export const REACTIVATION_THRESHOLD_DAYS = [7, 14] as const;

/** UTC yyyy-mm-dd ровно `days` дней назад от `day`. */
export function shiftUtcDateStr(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return utcDateStr(d);
}

/**
 * Ключ дедупа реактивации: одно на (user, порог, UTC-день прогона). Дата в ключе
 * нужна, потому что письмо привязано к ЭПИЗОДУ тишины, а не к аккаунту: вернувшийся
 * и снова пропавший человек должен получить напоминание опять. Однократность внутри
 * эпизода даёт само условие отбора («последняя активность ровно N дней назад»
 * наступает один раз), а ключ закрывает повторный прогон крона в тот же день.
 */
export function reactivationDedupKey(thresholdDays: number, day: string): string {
  return `reactivation:${thresholdDays}:${day}`;
}
