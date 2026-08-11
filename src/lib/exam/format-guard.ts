/**
 * Format guard (P1) — детерминированный разбор ФОРМАТНЫХ ограничений вопроса из его
 * промпта. Чисто клиентская подсказка practice-режима: НЕ трогает answer_key, ничего
 * не грейдит, только парсит инструкцию («NO MORE THAN TWO WORDS», «Choose TWO») и даёт
 * мягкий hint при превышении. Best-effort: не распознали формат → null (hint не
 * показывается). Никаких ложных блокировок ввода.
 */

/** Числительные словами → число (IELTS-инструкции используют one..ten). */
const WORD_NUM: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

/** Токен («TWO» / «2») → число 1..10, иначе null. */
function tokenToNum(token: string): number | null {
  const low = token.toLowerCase();
  if (low in WORD_NUM) return WORD_NUM[low];
  const n = Number(token);
  return Number.isInteger(n) && n >= 1 && n <= 10 ? n : null;
}

/** Снять теги, схлопнуть пробелы, привести к верхнему регистру (регистронезависимо). */
function normalizePrompt(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

export interface WordLimit {
  maxWords: number;
  /** «AND/OR A NUMBER»: числовые токены («15», «9.30», «1,500») словами не считаются. */
  allowNumber: boolean;
}

/**
 * Лимит слов для completion-вопроса из промпта, или null если формат не распознан.
 * Покрывает «NO MORE THAN TWO WORDS [AND/OR A NUMBER]», «ONE WORD ONLY», «WRITE TWO
 * WORDS», «ONE WORD AND/OR A NUMBER». По правилам IELTS «AND/OR A NUMBER» разрешает
 * число СВЕРХ лимита слов («15 dollars» валиден при ONE WORD AND/OR A NUMBER), поэтому
 * возвращаем флаг — countWords с ним не считает числовые токены.
 */
export function parseWordLimit(promptHtml: string): WordLimit | null {
  const t = normalizePrompt(promptHtml);
  const allowNumber = /AND\/?\s*OR A NUMBER|AND A NUMBER/.test(t);
  // Порядок важен: «NO MORE THAN N WORDS…» проверяем раньше generic-паттернов.
  const patterns: RegExp[] = [
    /NO MORE THAN (\w+) WORD/,
    /WRITE (\w+) WORD/,
    /(\w+) WORDS? ONLY/,
    /(\w+) WORDS? AND\/OR A NUMBER/,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m) {
      const n = tokenToNum(m[1]);
      if (n != null) return { maxWords: n, allowNumber };
    }
  }
  return null;
}

/**
 * Ожидаемое число выборов для multi-select («Choose TWO», «Select THREE letters»),
 * или null. Best-effort: неоднозначный/нераспознанный промпт → null (hint не покажем).
 */
export function parseChoiceCount(promptHtml: string): number | null {
  const t = normalizePrompt(promptHtml);
  const m1 = t.match(/(?:CHOOSE|SELECT|PICK) (\w+)/);
  if (m1) {
    const n = tokenToNum(m1[1]);
    if (n != null) return n;
  }
  // «TWO letters/answers/options» без глагола-триггера рядом.
  const m2 = t.match(/(\w+) (?:LETTERS|ANSWERS|OPTIONS)\b/);
  if (m2) {
    const n = tokenToNum(m2[1]);
    if (n != null) return n;
  }
  return null;
}

/** Числовой токен: 15 / 9.30 / 1,500 / 50% / 2015-2020 — при allowNumber не слово. */
const NUMERIC_TOKEN = /^[0-9][0-9.,:%\-]*$/;

/**
 * Число слов в ответе (токены по пробелам; пустой/пробельный → 0). При
 * ignoreNumbers=true числовые токены не считаются («AND/OR A NUMBER»-инструкции).
 */
export function countWords(value: string, ignoreNumbers = false): number {
  const tokens = value.trim().split(/\s+/).filter(Boolean);
  if (!ignoreNumbers) return tokens.length;
  return tokens.filter((t) => !NUMERIC_TOKEN.test(t)).length;
}
