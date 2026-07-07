// Чистая калибровка уверенности (P10) — джойн клиентских confidence-меток
// (localStorage, per-attempt) с вердиктами уже сданной practice-попытки. Без I/O и
// без DOM: сырой localStorage-JSON и вердикты приходят снаружи (ExamRunner пишет,
// ResultCoach читает), здесь — только парсинг + бизнес-джойн, чтобы покрыть тестом.
//
// Инвариант 2: вердикты (number/correct) — НЕ ключ; владелец сданной попытки и так
// видит их в разборе. Метки опциональны; нет ни одной валидной → null (блок не
// рендерится).

export type ConfidenceLevel = "low" | "med" | "high";

const LEVELS: readonly ConfidenceLevel[] = ["low", "med", "high"];
function isLevel(v: unknown): v is ConfidenceLevel {
  return typeof v === "string" && (LEVELS as readonly string[]).includes(v);
}

/**
 * Сырой localStorage-JSON → карта {строковый номер вопроса → уровень}, мусор
 * отбрасывается. Пустой/битый/недоступный вход → пустая карта (best-effort, как у
 * остальных practice-хранилищ).
 */
// Санитарный потолок сырой строки: localStorage same-origin подделываем сами себе,
// но гигантский JSON синхронно парсить не будем (self-DoS вкладки). Честная карта
// «40 вопросов × метка» — сотни байт; 16КБ — с запасом на порядки.
const MAX_RAW_LEN = 16_384;

export function parseConfidenceMap(raw: string | null): Record<string, ConfidenceLevel> {
  if (!raw || raw.length > MAX_RAW_LEN) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, ConfidenceLevel> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (isLevel(v)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export interface CalibrationResult {
  /** Сколько отвеченных вопросов получили метку (пересечение с вердиктами). */
  marked: number;
  /** Уверен, но неверно (high ∧ wrong) — номера по возрастанию. */
  overconfident: number[];
  /** Не уверен, но верно (low ∧ correct) — счёт. */
  underconfident: number;
  /** Всего high- и low-меток — для честной формулировки коуча. */
  highTotal: number;
  lowTotal: number;
}

/**
 * Джойн вердиктов (perQuestionCorrect) с метками уверенности. Ключ карты — строковый
 * номер вопроса (как в localStorage). Метка без соответствующего оценённого вопроса
 * игнорируется. Нет ни одной валидной метки → null (блок калибровки не рендерится).
 */
export function computeConfidenceCalibration(
  perQuestionCorrect: { number: number; correct: boolean }[],
  confidence: Record<string, ConfidenceLevel>,
): CalibrationResult | null {
  const correctByNumber = new Map(perQuestionCorrect.map((q) => [q.number, q.correct]));
  const overconfident: number[] = [];
  let underconfident = 0;
  let highTotal = 0;
  let lowTotal = 0;
  let marked = 0;

  for (const [key, level] of Object.entries(confidence)) {
    const number = Number(key);
    if (!Number.isInteger(number) || !correctByNumber.has(number)) continue;
    const correct = correctByNumber.get(number)!;
    marked++;
    if (level === "high") {
      highTotal++;
      if (!correct) overconfident.push(number);
    } else if (level === "low") {
      lowTotal++;
      if (correct) underconfident++;
    }
  }
  if (marked === 0) return null;
  overconfident.sort((a, b) => a - b);
  return { marked, overconfident, underconfident, highTotal, lowTotal };
}
