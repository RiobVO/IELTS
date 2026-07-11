/**
 * Чистое ядро обратного отсчёта до даты экзамена (BRIEF §12.3, dashboard exam-date
 * countdown, 2026-07-11). Никакого доступа к БД/env — только календарная
 * арифметика, чтобы дашборд (и любой будущий email/уведомление) считали ОДНО И ТО
 * ЖЕ поверх одного контракта входа.
 */

export type ExamCountdownStatus = "upcoming" | "today" | "past";

export interface ExamCountdown {
  days: number;
  status: ExamCountdownStatus;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * «Сегодня» юзера как полночь UTC того календарного дня, который сейчас идёт в
 * его таймзоне — не полночь сервера. В 20:00 UTC житель Ташкента (UTC+5) уже
 * встретил следующий день, а exam_date сам по себе — дата без времени/таймзоны,
 * поэтому обе стороны сравнения приводим к одной и той же условной «полночи UTC»
 * календарного дня.
 */
function timezoneDayUTC(now: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(get("year"), get("month") - 1, get("day"));
}

/**
 * Календарные дни от «сегодня в таймзоне юзера» до examDate (yyyy-mm-dd).
 * 0 = сегодня, 1 = завтра, отрицательное = дата уже прошла. NaN на невалидный
 * вход (не yyyy-mm-dd или неизвестная IANA-таймзона) — вызывающая сторона
 * обязана проверить Number.isFinite перед рендером, дефолтную дату не подставляем.
 */
export function daysUntilExam(examDate: string, now: Date, timezone: string): number {
  if (!ISO_DATE.test(examDate)) return NaN;
  const [y, m, d] = examDate.split("-").map(Number);
  const examUTC = Date.UTC(y, m - 1, d);

  let todayUTC: number;
  try {
    todayUTC = timezoneDayUTC(now, timezone);
  } catch {
    return NaN; // неизвестное имя IANA-таймзоны
  }

  return Math.round((examUTC - todayUTC) / 86_400_000);
}

/**
 * Валидация exam_date из формы (onboarding / dashboard-редактор). Границы:
 * «вчера по UTC» … «+2 года» — нижняя граница смещена на день назад, потому что
 * на записи мы ещё не знаем таймзону юзера (onboarding её не захватывает), а
 * «сегодня» в зоне UTC+14…-12 отличается от UTC-сегодня на день в обе стороны.
 * Цель — отсечь прошлое и мусор, не отбраковав честное «сегодня»; точную
 * семантику «прошла/впереди» рендер считает по profile.timezone.
 */
export function validExamDate(raw: string, now: Date = new Date()): boolean {
  if (!ISO_DATE.test(raw)) return false;
  const [y, m, d] = raw.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d);
  // Date.UTC нормализует несуществующие даты (2026-02-31 → 3 марта) — round-trip
  // проверяет, что компоненты не «переехали», иначе Postgres упадёт на INSERT.
  const dt = new Date(ms);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return false;
  const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return ms >= todayMs - 86_400_000 && ms <= Date.UTC(now.getUTCFullYear() + 2, now.getUTCMonth(), now.getUTCDate());
}

/** Статус по уже посчитанным дням. NaN трактуем как «past» — консервативный дефолт. */
export function examCountdownStatus(days: number): ExamCountdownStatus {
  if (!Number.isFinite(days)) return "past";
  if (days > 0) return "upcoming";
  if (days === 0) return "today";
  return "past";
}

/** Обёртка для рендера: дни + статус одним вызовом, null на невалидный вход. */
export function getExamCountdown(examDate: string, now: Date, timezone: string): ExamCountdown | null {
  const days = daysUntilExam(examDate, now, timezone);
  if (!Number.isFinite(days)) return null;
  return { days, status: examCountdownStatus(days) };
}

/**
 * date и now — один и тот же календарный день в таймзоне юзера. Живёт здесь (не в
 * отдельном файле), потому что переиспользует ту же проекцию timezoneDayUTC, что
 * daysUntilExam — «сегодня» дашборда (Today's plan, BRIEF §12) обязано совпадать
 * с «сегодня» countdown-карточки, иначе день практики и день до экзамена разъедутся.
 */
export function isSameTzDay(date: Date, now: Date, timezone: string): boolean {
  try {
    return timezoneDayUTC(date, timezone) === timezoneDayUTC(now, timezone);
  } catch {
    return false; // неизвестное имя IANA-таймзоны — консервативный дефолт
  }
}

/**
 * date попадает в текущую ISO-неделю (понедельник — старт) относительно now, в
 * таймзоне юзера. Понедельник этой недели — якорь: getUTCDay() даёт 0=вс..6=сб на
 * уже спроецированной «полночи UTC» дня, mondayOffset переводит его в 0=пн..6=вс.
 */
export function isInCurrentTzWeek(date: Date, now: Date, timezone: string): boolean {
  let dateDay: number;
  let nowDay: number;
  try {
    dateDay = timezoneDayUTC(date, timezone);
    nowDay = timezoneDayUTC(now, timezone);
  } catch {
    return false;
  }
  const nowDow = new Date(nowDay).getUTCDay();
  const mondayOffset = (nowDow + 6) % 7;
  const weekStart = nowDay - mondayOffset * 86_400_000;
  const weekEnd = weekStart + 7 * 86_400_000;
  return dateDay >= weekStart && dateDay < weekEnd;
}
