/**
 * Грейдинг публичного Band Predictor (G1-6). Чистые функции — без I/O, без
 * `server-only`: их гоняют юнит-тесты. Ключи живут отдельно (bank.ts, server-only)
 * и приезжают сюда параметром, поэтому этот модуль не может утечь ответы в бандл.
 *
 * ЧЕСТНОСТЬ ОЦЕНКИ — часть контракта. Десять вопросов не дают band: они дают
 * ДИАПАЗОН и обязаны так и называться. Никакого «твой band 7.0» по трёхминутной
 * пробе — иначе первый же настоящий мок опровергнет обещание, и это дороже, чем
 * скромная формулировка на входе.
 */

/** Совпадение ответа: без учёта регистра, лишних пробелов и финальной точки. */
function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ").replace(/\.$/, "");
}

export interface GradableQuestion {
  number: number;
  qtype: string;
  accept: string[];
}

export interface PredictorResult {
  correct: number;
  total: number;
  /** Слабейший тип вопросов; null — если ошибок нет вовсе. */
  weakType: string | null;
  perType: Record<string, { correct: number; total: number }>;
  /** Нижняя/верхняя граница диапазона band, обе включительно. */
  bandLow: number;
  bandHigh: number;
}

/**
 * Индикативный диапазон band по числу верных из десяти. Ступени сознательно
 * широкие (0.5 band) и перекрываются с реальностью снизу: занизить оценку на входе
 * безопасно, завысить — нет.
 */
export function bandRange(correct: number, total: number): { low: number; high: number } {
  if (total <= 0) return { low: 4, high: 4.5 };
  const pct = correct / total;
  if (pct >= 1) return { low: 7.5, high: 8.5 };
  if (pct >= 0.9) return { low: 7, high: 7.5 };
  if (pct >= 0.8) return { low: 6.5, high: 7 };
  if (pct >= 0.7) return { low: 6, high: 6.5 };
  if (pct >= 0.5) return { low: 5.5, high: 6 };
  if (pct >= 0.3) return { low: 5, high: 5.5 };
  return { low: 4, high: 5 };
}

/** Человекочитаемый диапазон: «6.0–6.5». Всегда с одним знаком после точки. */
export function formatBandRange(low: number, high: number): string {
  return `${low.toFixed(1)}–${high.toFixed(1)}`;
}

/**
 * Считает ответы гостя. `answers` — сырой объект из формы (номер вопроса → строка);
 * любой мусор в нём трактуется как «не отвечено», а не как ошибка выполнения.
 */
export function gradePredictor(
  questions: readonly GradableQuestion[],
  answers: Record<string, unknown>,
): PredictorResult {
  const perType: Record<string, { correct: number; total: number }> = {};
  let correct = 0;

  for (const q of questions) {
    const raw = answers[String(q.number)];
    const given = typeof raw === "string" ? normalize(raw) : "";
    const ok = given !== "" && q.accept.some((a) => normalize(a) === given);
    const bucket = perType[q.qtype] ?? { correct: 0, total: 0 };
    bucket.total += 1;
    if (ok) {
      bucket.correct += 1;
      correct += 1;
    }
    perType[q.qtype] = bucket;
  }

  const total = questions.length;
  // Слабейший — минимальная доля верных; ничьи достаются первому типу по порядку
  // вопросов (детерминированно). Идеальная проба слабого типа НЕ имеет.
  let weakType: string | null = null;
  let worst = Infinity;
  for (const [type, s] of Object.entries(perType)) {
    const ratio = s.total > 0 ? s.correct / s.total : 1;
    if (ratio < worst) {
      worst = ratio;
      weakType = type;
    }
  }
  if (correct === total) weakType = null;

  const { low, high } = bandRange(correct, total);
  return { correct, total, weakType, perType, bandLow: low, bandHigh: high };
}
