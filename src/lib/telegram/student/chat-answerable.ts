/**
 * Что бот вправе спросить в чате — ЧИСТЫЙ предикат, без БД.
 *
 * Живой прогон рассылки прислал «Paragraph A» и восемь заголовков на выбор. Такое
 * задание нерешаемо в переписке в принципе: формулировка адресует кусок пассажа,
 * которого в сообщении нет и быть не может (пассаж — страница текста, не реплика).
 * Человек в ответ либо гадает, либо уходит на /stop.
 *
 * ПОЧЕМУ НЕ ПРОСТО СПИСОК ТИПОВ. Первая версия отбирала по qtype, но данные прода
 * показали, что тип решает не всё:
 *   - у `table_completion` из Cambridge 21 ОДНА формулировка на два вопроса и в ней
 *     ДВА пропуска («basic theory e.g. understanding the ____ and tides basic
 *     sailing skills including ____ information») — что именно вписывать, из чата
 *     не понять;
 *   - у `summary_completion` одного импорта все четыре вопроса несут целиком
 *     инструкцию блока с четырьмя пропусками;
 *   - при этом `note_completion` там же — нормальные самодостаточные строки
 *     («Bring suitable clothing, a ____ and toiletries»), и выбрасывать весь тип
 *     значило бы выбросить 29 живых вопросов из 138.
 * Поэтому решают два признака: тип-указатель в пассаж отсекается сразу, остальное
 * проверяется по ФОРМЕ формулировки.
 */

/**
 * Типы, чья формулировка — указатель внутрь пассажа («Paragraph A», «The findings
 * at Kalambo Falls revealed that»), а варианты — голые буквы A/B/C или римские
 * цифры. Без текста перед глазами не решаются никогда, сколько бы слов ни было в
 * самой формулировке.
 */
export const PASSAGE_BOUND_QTYPES: readonly string[] = [
  "matching_headings",
  "matching_info",
  "matching_features",
  "matching_sentence_endings",
  "diagram_label",
  "map_labelling",
];

/** Пропуск в формулировке: импорт печатает его подчёркиваниями. */
const BLANK = /_{2,}/g;

/**
 * Минимум осмысленного текста (без самих пропусков), при котором вопрос ещё несёт
 * своё условие. Порог выбран по данным прода: «extreme ____ events.» (16) и
 * «keep ____ 1 out» (11) вне контекста таблицы не значат ничего, а «There is a
 * ____ at the club.» (23) — уже полноценный вопрос.
 */
const MIN_CONTEXT_CHARS = 20;

/**
 * Можно ли задать этот вопрос в чате: формулировка должна нести своё условие
 * целиком и спрашивать ровно одну вещь.
 */
export function isChatAnswerable(qtype: string, prompt: string): boolean {
  if (PASSAGE_BOUND_QTYPES.includes(qtype)) return false;

  const blanks = prompt.match(BLANK)?.length ?? 0;
  // Два и больше пропусков — формулировка общая для нескольких вопросов; ответ
  // одним сообщением к ней не привязать.
  if (blanks > 1) return false;

  const context = prompt.replace(BLANK, " ").replace(/\s+/g, " ").trim();
  return context.length >= MIN_CONTEXT_CHARS;
}
