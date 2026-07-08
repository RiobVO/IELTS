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
