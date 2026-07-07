/**
 * ISO-8601 год-неделя в UTC, формат `2026-W28`. Ключ идемпотентности weekly digest:
 * ровно одно письмо на (user, ISO-week). ВАЖНО: год — это ISO week-numbering year, а
 * НЕ календарный: неделя принадлежит году своего четверга, поэтому 2005-01-01 →
 * "2004-W53", а 2007-12-31 → "2008-W01". Чистая функция (без БД/сети) — тестируется
 * изолированно и не тянет server-only/@/db.
 */
export function isoWeekKey(date: Date): string {
  // Нормализуем к UTC-полуночи, чтобы часовой пояс сервера не сдвигал день.
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  // ISO-день недели: Пн=1 … Вс=7 (getUTCDay даёт Вс=0 → приводим к 7).
  const isoDay = d.getUTCDay() || 7;
  // Сдвигаем на четверг той же ISO-недели — его календарный год и есть ISO-год недели.
  d.setUTCDate(d.getUTCDate() + 4 - isoDay);
  const isoYear = d.getUTCFullYear();
  const yearStart = Date.UTC(isoYear, 0, 1);
  // Целое число дней от 1 января ISO-года до четверга (обе точки — UTC-полночь).
  const dayOfYear = (d.getTime() - yearStart) / 86_400_000;
  const weekNo = Math.ceil((dayOfYear + 1) / 7);
  return `${isoYear}-W${String(weekNo).padStart(2, "0")}`;
}
