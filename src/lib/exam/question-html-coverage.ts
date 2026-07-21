/**
 * Coverage-гейт verbatim-панели (practice-путь, page.tsx): presence одного `questions_html`
 * НЕ гарантирует, что внутри есть слот на КАЖДЫЙ вопрос пассажа (source HTML мог потерять
 * инпут при захвате / ручной правке). Слот — маркер `.q-slot[data-q]`, тот же, которым
 * `capture-questions.ts` (`slot()`) размечает каждый интерактивный инпут. Извлекаем номера
 * regex'ом (дёшево, сервер, без DOM) и сверяем с полным списком номеров вопросов пассажа.
 */
const Q_SLOT_TAG_RE = /<[^>]*\bclass="q-slot"[^>]*>/g;
const DATA_Q_RE = /\bdata-q="(\d+)"/;

/** Номера вопросов, размеченных `.q-slot[data-q]` внутри HTML пассажа. */
export function extractSlotQuestionNumbers(html: string): number[] {
  const nums: number[] = [];
  for (const tag of html.match(Q_SLOT_TAG_RE) ?? []) {
    const m = DATA_Q_RE.exec(tag);
    if (m) nums.push(Number(m[1]));
  }
  return nums;
}

/**
 * true, только если КАЖДЫЙ номер из `questionNumbers` покрыт слотом в `html`. Пустой
 * список номеров (пассаж без своих вопросов) → true (нечего покрывать — не гейт).
 * Непустой список номеров при пустом/отсутствующем HTML → false (нечем покрыть).
 */
export function questionsHtmlCoversAll(html: string, questionNumbers: number[]): boolean {
  if (questionNumbers.length === 0) return true;
  if (!html) return false;
  const covered = new Set(extractSlotQuestionNumbers(html));
  return questionNumbers.every((n) => covered.has(n));
}
