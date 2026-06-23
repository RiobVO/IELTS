// Перевод raw score → band по сохранённой band-шкале теста (BRIEF §11).
// Чистая функция (без I/O) — выделена из app/app/reading/[id]/actions.ts, чтобы
// итоговый балл был покрыт юнит-тестами наравне с grade() и не регрессировал тихо.

/**
 * Возвращает band для набранного raw score по шкале `scale`.
 *
 * Шкала приходит из content_item.band_scale (jsonb) как объект
 * { "<rawScore>": <band> }. Только Full-тесты (40Q) имеют шкалу; одиночный
 * passage/part — `scale === null` → band нет (только проценты).
 *
 * Поведение совпадает с прежним инлайном: нет шкалы → null; нет записи под
 * данный rawScore → null (без интерполяции — берётся только точное совпадение).
 */
export function bandForScore(
  scale: Record<string, number> | null,
  rawScore: number,
): number | null {
  return scale ? (scale[String(rawScore)] ?? null) : null;
}
