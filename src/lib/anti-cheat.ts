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

/**
 * Минимальный «честный» темп: секунд на вопрос, ниже которого сабмит физически не
 * может быть человеческим (start → почти мгновенная сдача). Консервативный — в разы
 * быстрее самого быстрого реального чтения, поэтому не задевает живых пользователей.
 */
export const MIN_RATED_SECONDS_PER_QUESTION = 3;

/**
 * true, если сабмит слишком быстрый для своего объёма и НЕ должен идти в рейтинг
 * (анти-фарм Elo/сложности теста, §4.6). Floor-guard поверх first-attempt-only:
 * инстант-сабмит (start→submit за секунды) перестаёт двигать рейтинг и difficulty.
 * Стрик/XP осознанно не трогает — это не вектор лидерборда (рейтинг + first-attempt).
 * `timeUsedSeconds` — серверное (submit − start), не клиентское.
 */
export function isTooFastToRate(
  timeUsedSeconds: number,
  totalQuestions: number,
): boolean {
  if (totalQuestions <= 0) return false;
  return timeUsedSeconds < totalQuestions * MIN_RATED_SECONDS_PER_QUESTION;
}
