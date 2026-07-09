/**
 * Агрегированная сводка answer_key для admin review-экрана (P3): админ подтверждает
 * ключ перед Approve, видя разбивку, а не «ключ есть» вслепую. Чистая функция над
 * уже прочитанными owner-путём строками — СЫРЫЕ ответы (accept) в неё НЕ передаются
 * (только флаг emptyAccept), поэтому результат безопасно сериализуется в клиент/бота.
 */
export interface ReviewRow {
  number: number;
  qtype: string;
  /** answer_key.mode или null, если ключа у вопроса нет. */
  mode: string | null;
  /** true, если ключ отсутствует или accept целиком пуст. */
  emptyAccept: boolean;
}

export interface ReviewSummary {
  total: number;
  /** Разбивка по mode грейдинга: exact / text_accept / mcq_set (или «—» без ключа). */
  byMode: Record<string, number>;
  /** Распределение по канон-типу вопроса. */
  byType: Record<string, number>;
  /** Сколько вопросов с пустым/отсутствующим ключом (флаг подозрительного). */
  emptyKeys: number;
  /** Дублирующиеся номера вопросов (флаг), отсортированы. */
  duplicateNumbers: number[];
  /** Нумерация с дырой/дублем или пустой набор. Offset-agnostic (14-26 — ок). */
  numberGap: boolean;
}

export function summarizeReview(rows: ReviewRow[]): ReviewSummary {
  const byMode: Record<string, number> = {};
  const byType: Record<string, number> = {};
  let emptyKeys = 0;
  const seen = new Set<number>();
  const dups = new Set<number>();

  for (const r of rows) {
    const mode = r.mode ?? "—";
    byMode[mode] = (byMode[mode] ?? 0) + 1;
    byType[r.qtype] = (byType[r.qtype] ?? 0) + 1;
    if (r.emptyAccept) emptyKeys++;
    if (seen.has(r.number)) dups.add(r.number);
    seen.add(r.number);
  }

  const nums = rows.map((r) => r.number);
  // Offset-agnostic (зеркалит publish-гейт questionNumbersOk): положительные целые, смежный
  // уникальный набор ⟺ нет дублей И (max-min+1) == размеру. Пустой/неположительный — дефект.
  const numberGap =
    nums.length === 0 ||
    !nums.every((n) => Number.isInteger(n) && n > 0) ||
    seen.size !== nums.length ||
    Math.max(...nums) - Math.min(...nums) + 1 !== seen.size;

  return {
    total: rows.length,
    byMode,
    byType,
    emptyKeys,
    duplicateNumbers: [...dups].sort((a, b) => a - b),
    numberGap,
  };
}
