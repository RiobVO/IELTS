/**
 * Чистая логика P11 «Saved words» (закладка слова из пассажа → личный словарь).
 * Без IO/db/времени — только нормализация ввода и детерминированная вырезка
 * предложения-контекста из плоского текста пассажа. Юнит-тестируется
 * (saved-words.test.ts). Серверный экшен (saveWord) и клиентский жест (PassagePane)
 * делят ЭТИ функции, чтобы клиентский гейт и серверная валидация не разъезжались.
 */

/** Верхняя граница длины слова (после нормализации): отсекает предложения/мусор. */
export const MAX_WORD_LEN = 64;
/** Верхняя граница контекста: обрезаем предложение-окружение до этого размера. */
export const MAX_CONTEXT_LEN = 300;

// Одна лексема: буквы любого алфавита с ВНУТРЕННИМИ дефисом/апострофом (self-aware,
// don’t). Ведущий и замыкающий символы — буквы (хвостовые «word-»/«word'» — мусор);
// ни пробелов, ни цифр, ни HTML-угловых скобок.
const WORD_RE = /^\p{L}(?:[\p{L}'’-]*\p{L})?$/u;

/** Схлопывает любой пробельный ран (включая переносы) в один пробел и тримит. */
function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Нормализует выделенный текст в кандидата saved-word: trim + схлоп пробелов.
 * Возвращает слово, если это ОДИНОЧНАЯ валидная лексема длиной 1..MAX_WORD_LEN,
 * иначе null (мусор, фраза из нескольких слов, HTML, цифры, перенос строки).
 */
export function normalizeWord(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const w = collapse(raw);
  if (w.length < 1 || w.length > MAX_WORD_LEN) return null;
  if (!WORD_RE.test(w)) return null;
  return w;
}

/**
 * Вырезает предложение-контекст вокруг выделения [start,end) из плоского текста
 * пассажа (container.textContent). Детерминированно: границы предложения — терминаторы
 * . ! ? или перенос строки слева от start / справа от end; результат схлопывается и
 * обрезается до MAX_CONTEXT_LEN. Для сверхдлинного предложения (нет пунктуации) окно
 * центрируется на выделении, чтобы слово гарантированно попало в контекст. Некорректный
 * вход (не строка / end ≤ start) → "".
 */
export function extractContext(fullText: unknown, start: number, end: number): string {
  if (typeof fullText !== "string" || !Number.isFinite(start) || !Number.isFinite(end)) return "";
  if (!(end > start)) return "";
  const len = fullText.length;
  const s = Math.max(0, Math.min(Math.trunc(start), len));
  const e = Math.max(s, Math.min(Math.trunc(end), len));

  const isBoundary = (ch: string): boolean =>
    ch === "." || ch === "!" || ch === "?" || ch === "\n";

  // Левая граница: символ после последнего терминатора перед выделением.
  let from = 0;
  for (let i = s - 1; i >= 0; i--) {
    if (isBoundary(fullText[i])) {
      from = i + 1;
      break;
    }
  }
  // Правая граница: включительно по первому терминатору в/после конца выделения.
  let to = len;
  for (let i = e; i < len; i++) {
    if (isBoundary(fullText[i])) {
      to = i + 1;
      break;
    }
  }

  const raw = fullText.slice(from, to);
  const collapsed = collapse(raw);
  if (collapsed.length <= MAX_CONTEXT_LEN) return collapsed;

  // Слишком длинно — центрируем окно на выделении внутри raw (по исходным офсетам),
  // затем схлопываем: слово не выпадет из контекста.
  const selMid = Math.floor((s + e) / 2) - from;
  const half = Math.floor(MAX_CONTEXT_LEN / 2);
  let ws = Math.max(0, selMid - half);
  const we = Math.min(raw.length, ws + MAX_CONTEXT_LEN);
  ws = Math.max(0, we - MAX_CONTEXT_LEN);
  return collapse(raw.slice(ws, we));
}
