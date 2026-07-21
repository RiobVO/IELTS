/**
 * Вопрос считается отвеченным: непустая строка (после trim) ИЛИ непустой набор
 * букв (mcq_multi). Общий предикат для навигатора, счётчика answered и practice-
 * гейта Check (аффорданс не появляется, пока ответа нет). Вынесен из ExamRunner,
 * чтобы атомизированный список и verbatim-путь считали «отвечено» одинаково.
 */
export function isAnswered(v: string | string[] | undefined): boolean {
  return Array.isArray(v) ? v.length > 0 : !!(v && v.trim());
}
