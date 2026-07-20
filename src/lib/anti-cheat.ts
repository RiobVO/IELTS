/**
 * Server-side анти-чит throttle для submit-эндпоинта (BRIEF §4.6). Идемпотентность
 * по (user, test) и серверное время старта/сдачи уже закрыты в submitAttempt; здесь
 * — последний зазор: ЧАСТОТНЫЙ лимит. Цель — отсечь автоматическую накрутку
 * рейтинга/XP/лидерборда пачкой быстрых сабмитов. Живой человек физически не сдаёт
 * столько тестов в минуту, поэтому порог не задевает реальных пользователей.
 *
 * Логика вынесена в чистые функции (без I/O) — решение и окно тестируются без БД;
 * сам запрос «последние N сабмитов» живёт в действии и опирается на индекс
 * attempt_user_submitted_idx (user_id, submitted_at).
 */

/** Скользящее окно, секунд. */
export const SUBMIT_THROTTLE_WINDOW_SECONDS = 60;

/** Максимум засчитанных сабмитов на пользователя в окне. >= порога -> отказ. */
export const SUBMIT_THROTTLE_MAX = 5;

/**
 * Сколько сабмитов попадает в окно [now - window, now]. `submitted_at` может быть
 * null (in_progress-строки) — такие не считаем. Граница включительна (>= cutoff).
 */
export function countSubmitsInWindow(
  submittedAts: Array<Date | null>,
  now: Date,
): number {
  const cutoff = now.getTime() - SUBMIT_THROTTLE_WINDOW_SECONDS * 1000;
  return submittedAts.filter((d) => d != null && d.getTime() >= cutoff).length;
}

/** true, если число сабмитов в окне достигло потолка — текущий сабмит отклоняем. */
export function exceedsSubmitRate(submitsInWindow: number): boolean {
  return submitsInWindow >= SUBMIT_THROTTLE_MAX;
}
