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

/** Скользящее окно signup-лимита, секунд (1 час). */
export const SIGNUP_THROTTLE_WINDOW_SECONDS = 60 * 60;

/** Максимум регистраций с одного IP в окне. >= порога -> отказ. Tunable. */
export const SIGNUP_THROTTLE_MAX = 10;

/**
 * true, если число регистраций с одного IP в окне достигло потолка — текущую
 * регистрацию отклоняем (§11 anti-abuse, поверх captcha). Чистая — порог
 * тестируется без БД; сам COUNT в окне делает server action по индексу
 * signup_throttle (ip_hash, created_at).
 */
export function exceedsSignupRate(signupsInWindow: number): boolean {
  return signupsInWindow >= SIGNUP_THROTTLE_MAX;
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

/**
 * P0 Practice/Mock: рейтингуется ТОЛЬКО mock-попытка, и только когда она —
 * АБСОЛЮТНО первая сданная попытка этого теста (в любом режиме, §4.6
 * first-attempt-only). Practice-прогон «сжигает» рейтингуемость теста: иначе
 * будущие practice-фичи (проверка/разбор до сдачи) превращали бы последующий
 * «первый mock» в накрутку Elo. Floor-guard по темпу сохраняется. Чистая
 * функция — форк-условие рейтинга тестируется без БД.
 */
export function shouldRateAttempt(input: {
  mode: "practice" | "mock";
  /** Сданные попытки этого (user, test) ВКЛЮЧАЯ текущую. */
  submittedCountForTest: number;
  /** Серверное время (submit − start), не клиентское. */
  timeUsedSeconds: number;
  totalQuestions: number;
}): boolean {
  return (
    input.mode === "mock" &&
    input.submittedCountForTest === 1 &&
    !isTooFastToRate(input.timeUsedSeconds, input.totalQuestions)
  );
}

/**
 * IP/email-throttle для login/reset-password (§11 anti-abuse) — тот же механизм и та
 * же таблица signup_throttle, что signup-cap выше (миграция под отдельную колонку
 * scope не заводится — ключ вместо этого несёт префикс scope, см. checkAuthThrottle
 * в app/auth/actions.ts). Login и reset (по IP) — щедрый порог: общий IP за NAT
 * (университет/офис) не должен блокировать легитимных юзеров, отсекаем только
 * автоматизированный спам с одного адреса. resetEmail — строгий per-email лимит
 * поверх reset: живой юзер жмёт "send" один раз, не трижды, а NAT его не размывает.
 */
export const AUTH_THROTTLE_LIMITS = {
  login: { windowSeconds: 10 * 60, max: 10 },
  reset: { windowSeconds: 10 * 60, max: 10 },
  resetEmail: { windowSeconds: 10 * 60, max: 3 },
} as const;

export type AuthThrottleScope = keyof typeof AUTH_THROTTLE_LIMITS;

/** true, если число попыток в окне достигло потолка для данного scope — текущую
 *  попытку отклоняем. Чистая — порог тестируется без БД (тот же паттерн, что
 *  exceedsSignupRate выше); сам COUNT в окне и запись делает checkAuthThrottle. */
export function exceedsAuthThrottle(scope: AuthThrottleScope, countInWindow: number): boolean {
  return countInWindow >= AUTH_THROTTLE_LIMITS[scope].max;
}

/**
 * Honeypot (§11 anti-bot, без внешних зависимостей): в signup-форме есть скрытое
 * поле-приманка, невидимое живому пользователю (offscreen + aria-hidden). Бот,
 * автозаполняющий все поля, отправит его непустым. true => это бот. Чистая функция —
 * решение тестируется без формы; заполнение поля читает server action из FormData.
 */
export function isHoneypotTripped(value: unknown): boolean {
  return typeof value === "string" && value.trim() !== "";
}
