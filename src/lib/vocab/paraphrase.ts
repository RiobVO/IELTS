/**
 * Paraphrase Sprint (V8): детерминированное построение вопроса
 * «Which word matches "{synonym}"?» для одной карты. ЧИСТАЯ логика (без IO, без
 * Math.random) — целиком юнит-тестируема (paraphrase.test.ts). Всё «случайное»
 * (выбор синонима-промпта, набор дистракторов из соседних карт, порядок опций)
 * выводится из стабильного string-hash(card.id), поэтому вопрос восстанавливается
 * одинаковым на каждом рендере и не «прыгает» между перерисовками.
 */

export interface ParaphraseCard {
  id: string;
  word: string;
  synonyms: string[] | null;
}

export interface ParaphraseQuestion {
  /** Синоним-промпт (детерминированно выбран из card.synonyms). */
  synonym: string;
  /** Опции: правильное слово + дистракторы, детерминированно перемешаны (2..4). */
  options: string[];
}

/** Сколько дистракторов максимум добираем: правильное слово + 3 = 4 опции. */
const MAX_DISTRACTORS = 3;

/**
 * FNV-1a 32-bit. Детерминированный, без зависимостей; Math.imul держит умножение в
 * 32 битах. Возвращает беззнаковое целое (>>> 0) — годится и для `%`, и как ключ
 * сортировки.
 */
export function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Обрезка и отсев пустых значений массива (enrichment-колонки nullable/грязные). */
function cleaned(values: string[] | null | undefined): string[] {
  if (!values) return [];
  return values.map((v) => v.trim()).filter((v) => v.length > 0);
}

/**
 * Строит Paraphrase-вопрос для карты или возвращает null (тогда вызывающий рендерит
 * обычную флип-карту — graceful mixed queue):
 *   - null, если у карты нет непустых synonyms или пустое слово;
 *   - null, если в пуле нет ни одного пригодного дистрактора (нельзя собрать даже
 *     2 опции).
 * Дистракторы — слова ДРУГИХ карт пула (по нормализованному ключу без дублей и без
 * самого слова). Порядок кандидатов и итоговая раскладка опций — детерминированные
 * от hash(card.id + слово) с разными солями, чтобы позиция правильного ответа не
 * коррелировала с выбором дистракторов. Тай-брейк по слову — на случай коллизий хэша.
 */
export function buildParaphraseQuestion(
  card: ParaphraseCard,
  pool: ParaphraseCard[],
): ParaphraseQuestion | null {
  const synonyms = cleaned(card.synonyms);
  if (synonyms.length === 0) return null;

  const word = card.word.trim();
  if (word.length === 0) return null;

  // Синоним-промпт: индекс = hash(card.id) % len (стабильно для карты).
  const synonym = synonyms[hashString(card.id) % synonyms.length];

  // Кандидаты в дистракторы: слова других карт, дедуп по нижнему регистру + без слова.
  // Слова, совпадающие с ЛЮБЫМ синонимом карты, тоже исключаются: такая опция была бы
  // семантически верной, но сервер эталоном держит только card.word — юзер получил бы
  // несправедливое «неверно» (контент-коллизия из ревью B2).
  const selfKey = word.toLowerCase();
  const seen = new Set<string>([selfKey]);
  for (const s of synonyms) seen.add(s.toLowerCase());
  const candidates: string[] = [];
  for (const other of pool) {
    if (other.id === card.id) continue;
    const w = other.word.trim();
    if (w.length === 0) continue;
    const key = w.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(w);
  }
  if (candidates.length === 0) return null; // нельзя собрать даже 2 опции → флип-фолбэк

  // Псевдослучайный, но стабильный порядок кандидатов от hash(card.id + слово):
  // разные карты берут разные дистракторы, для одной карты набор фиксирован.
  const distractors = candidates
    .map((w) => ({ w, k: hashString(card.id + "|" + w) }))
    .sort((a, b) => a.k - b.k || (a.w < b.w ? -1 : 1))
    .slice(0, MAX_DISTRACTORS)
    .map((x) => x.w);

  // Перемешивание опций — другая соль ("#"), чтобы позиция правильного слова не
  // коррелировала с выбором дистракторов.
  const options = [word, ...distractors]
    .map((w) => ({ w, k: hashString(card.id + "#" + w) }))
    .sort((a, b) => a.k - b.k || (a.w < b.w ? -1 : 1))
    .map((x) => x.w);

  return { synonym, options };
}
