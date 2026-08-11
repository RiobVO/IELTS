// Format-loss detector (P13, practice-only) — по уже посчитанному результату
// находит вопросы, где НЕВЕРНЫЙ ответ нарушил ФОРМАТ инструкции из промпта
// (лимит слов / число выборов multi-select), а не смысл ответа. Детерминированно,
// поверх format-guard.ts (BRIEF §4.2 — никакого answer_key, никакого "угадывания",
// был бы ли ответ верным без нарушения формата). Формат не распознан -> вопрос
// не флагуется (best-effort, как и сам format-guard).

import { countWords, parseChoiceCount, parseWordLimit } from "@/lib/exam/format-guard";

export type FormatLossReason = "word-limit" | "choice-count";

export interface FormatLossItem {
  number: number;
  reason: FormatLossReason;
}

export interface FormatLossInput {
  number: number;
  promptHtml: string;
  /** Ответ пользователя как есть (массив — для multi-select), не joined-строка для отображения. */
  givenRaw: string | string[] | null;
  isCorrect: boolean;
}

/** Число реально выбранных вариантов: массив — длина; строка — токены по запятой/пробелу (как в grade.ts mcq_set). */
function countGiven(givenRaw: string | string[] | null): number {
  if (Array.isArray(givenRaw)) return givenRaw.length;
  const s = (givenRaw ?? "").trim();
  return s === "" ? 0 : s.split(/[\s,]+/).filter(Boolean).length;
}

/**
 * Среди НЕВЕРНЫХ ответов — какие потеряны именно на формате: (a) ответ длиннее
 * разрешённого лимита слов (parseWordLimit + countWords), (b) multi-select с
 * неверным числом выборов (parseChoiceCount vs фактически выбрано, недобор
 * ИЛИ перебор). Пустой/пропущенный ответ не флагуется — это не формат, а
 * отсутствие ответа. Промпт без распознанного формата -> не флагуется.
 */
export function detectFormatLosses(items: FormatLossInput[]): FormatLossItem[] {
  const losses: FormatLossItem[] = [];

  for (const item of items) {
    if (item.isCorrect) continue;

    const wordLimit = parseWordLimit(item.promptHtml);
    if (wordLimit) {
      const given = Array.isArray(item.givenRaw) ? item.givenRaw.join(" ") : (item.givenRaw ?? "");
      if (given.trim() !== "" && countWords(given, wordLimit.allowNumber) > wordLimit.maxWords) {
        losses.push({ number: item.number, reason: "word-limit" });
      }
      continue; // формат этого вопроса — лимит слов, choice-count здесь не применим
    }

    const choiceCount = parseChoiceCount(item.promptHtml);
    if (choiceCount != null) {
      const picked = countGiven(item.givenRaw);
      if (picked > 0 && picked !== choiceCount) {
        losses.push({ number: item.number, reason: "choice-count" });
      }
    }
  }

  return losses;
}
