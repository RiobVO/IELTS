/**
 * Quiz-режим «type the answer»: нормализация ввода и сравнение с эталонным словом.
 * ЧИСТАЯ логика (без IO) — целиком юнит-тестируема (answer.test.ts). Сервер —
 * единственный судья (word читается owner-path в гейте, клиент балл не присылает).
 */
import type { Grade } from "@/lib/vocab/srs";

/**
 * Канонизация ответа для сравнения без учёта регистра/лишних пробелов/формы Unicode:
 *   NFC (composed акценты) → trim краёв → нижний регистр → внутренние пробелы в один.
 * Порядок фиксирован (спека): нормализация формы до lower/collapse, чтобы é (U+00E9)
 * и e+◌́ (U+0065 U+0301) считались одним словом.
 */
export function normalizeAnswer(s: string): string {
  return s
    .normalize("NFC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** true, если введённый ответ совпадает с эталонным словом после нормализации обоих. */
export function isAnswerCorrect(typed: string, word: string): boolean {
  return normalizeAnswer(typed) === normalizeAnswer(word);
}

/** true, если непустой введённый ответ совпадает с одним из допустимых эталонов после нормализации. */
export function isAnswerAccepted(typed: string, acceptedAnswers: readonly string[]): boolean {
  const normalizedTyped = normalizeAnswer(typed);
  if (normalizedTyped === "") return false;
  return acceptedAnswers.some((answer) => normalizeAnswer(answer) === normalizedTyped);
}

/**
 * Маппинг исхода quiz-ответа на SM-2-оценку: верно → "good", неверно → "again".
 * Общий контур повтора (гейт + SM-2 upsert) для quiz и two-button идентичен —
 * различие только в способе получить Grade.
 */
export function gradeForAnswer(correct: boolean): Grade {
  return correct ? "good" : "again";
}
