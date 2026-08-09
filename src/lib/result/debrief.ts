// Чистые вычисления для страницы /result «дебриф» (без I/O, без React). Данные
// уже загружены и посчитаны в page.tsx (grade(), band_scale, история попыток) —
// здесь только бизнес-правила поверх них: near-miss к следующему band, слепая
// зона (Not Given и симметричные типы), рост по слабому типу между попытками.

import { bandForScore } from "@/lib/grading/band";
import type { PerQuestionResult } from "@/lib/grading/grade";
import { qtypeLabel } from "@/lib/labels";

/** Типы с "третьим" исходом Not Given/No — единственные, где есть осмысленный
 *  срез "указано значение" vs "ничего не сказано" (BRIEF §4.2 канон типов). */
const TERNARY_TYPES = new Set(["tfng", "ynng"]);
const NG_ACCEPT = "NOT GIVEN";

export interface NearMiss {
  band: number | null;
  nextBand: number | null;
  marksToNext: number | null;
}

/**
 * Ближайший более высокий band и сколько баллов до него не хватило. Точное
 * совпадение по шкале (без интерполяции — как bandForScore). Нет шкалы или
 * текущий raw вне шкалы -> все null (одиночный passage/part — только проценты).
 */
export function computeNearMiss(
  scale: Record<string, number> | null,
  rawScore: number,
): NearMiss {
  const band = bandForScore(scale, rawScore);
  if (!scale || band == null) return { band, nextBand: null, marksToNext: null };

  let best: { raw: number; band: number } | null = null;
  for (const [rawStr, b] of Object.entries(scale)) {
    const r = Number(rawStr);
    if (r <= rawScore || b <= band) continue;
    if (!best || r < best.raw) best = { raw: r, band: b };
  }
  return best
    ? { band, nextBand: best.band, marksToNext: best.raw - rawScore }
    : { band, nextBand: null, marksToNext: null };
}

export interface BlindSpotBucket {
  correct: number;
  total: number;
}

export interface BlindSpot {
  /** Подлежащее заголовка — "Not Given" либо "True / False" / "Yes / No":
   *  какой бакет реально слабее, без допущения, что виноват именно NG. */
  label: string;
  weakBucket: BlindSpotBucket;
  /** null у генерализованного (не-ternary) фоллбэка — сравнивать не с чем. */
  strongBucket: BlindSpotBucket | null;
  /** Баллы, потерянные именно в слабом бакете (total − correct). */
  costMarks: number;
}

/**
 * Бакетизация True/False/Yes-No вопросов на "Not Given" против "есть значение"
 * (True/False или Yes/No) — классическая слепая зона IELTS Reading/Listening.
 * Возвращает null, если в попытке нет tfng/ynng вопросов, ИЛИ один из бакетов
 * пуст (не с чем сравнивать) — тогда S2 на вызывающей стороне генерализуется
 * до слабейшего типа (там уже есть perType/weakest, второй источник не нужен).
 */
export function computeBlindSpot(
  perQuestion: PerQuestionResult[],
  meta: Map<number, { accept: string[] }>,
): BlindSpot | null {
  const valueTypes = new Set<string>();
  let ngCorrect = 0;
  let ngTotal = 0;
  let valCorrect = 0;
  let valTotal = 0;

  for (const q of perQuestion) {
    if (!TERNARY_TYPES.has(q.qtype)) continue;
    const isNg = meta.get(q.number)?.accept.some((a) => a.trim().toUpperCase() === NG_ACCEPT) ?? false;
    if (isNg) {
      ngTotal++;
      if (q.correct) ngCorrect++;
    } else {
      valTotal++;
      if (q.correct) valCorrect++;
      valueTypes.add(q.qtype);
    }
  }
  if (ngTotal === 0 || valTotal === 0) return null;

  const ngBucket: BlindSpotBucket = { correct: ngCorrect, total: ngTotal };
  const valBucket: BlindSpotBucket = { correct: valCorrect, total: valTotal };
  const valueLabel =
    valueTypes.size === 1 ? (valueTypes.has("tfng") ? "True / False" : "Yes / No") : "True / False / Yes / No";

  const ngPct = ngCorrect / ngTotal;
  const valPct = valCorrect / valTotal;
  const [weak, strong, label]: [BlindSpotBucket, BlindSpotBucket, string] =
    ngPct <= valPct ? [ngBucket, valBucket, "Not Given"] : [valBucket, ngBucket, valueLabel];

  return { label, weakBucket: weak, strongBucket: strong, costMarks: weak.total - weak.correct };
}

export interface GrowthBar {
  tag: "1st" | "2nd" | "now";
  correct: number;
  total: number;
}

export interface Growth {
  label: string;
  series: GrowthBar[];
  deltaType: number;
}

/** Форма уже сохранённого attempt.per_type_breakdown (см. src/lib/progress/badges.ts). */
type TypeBreakdown = Record<string, { correct: number; total: number }>;

/**
 * Рост по слабейшему типу за попытки. `history` — хронологический ряд (самая
 * старая попытка первой), ПОСЛЕДНИЙ элемент — текущая попытка (её breakdown
 * ещё не в БД на момент чтения /result, поэтому вызывающая сторона добавляет
 * его сама из уже посчитанного grade()). null, если точек меньше двух (нет ни
 * одной прошлой попытки — "since your first try" сравнивать не с чем, глава
 * прячется) или weakType не задан (в попытке нет вопросов этого типа вовсе).
 */
export function computeGrowth(
  history: { perTypeBreakdown: TypeBreakdown | null }[],
  weakType: string | null,
): Growth | null {
  if (!weakType) return null;
  const points = history
    .map((h) => h.perTypeBreakdown?.[weakType])
    .filter((b): b is { correct: number; total: number } => b != null);
  if (points.length < 2) return null;

  const first = points[0];
  const now = points[points.length - 1];
  const series: GrowthBar[] =
    points.length === 2
      ? [{ tag: "1st", ...first }, { tag: "now", ...now }]
      : [{ tag: "1st", ...first }, { tag: "2nd", ...points[points.length - 2] }, { tag: "now", ...now }];

  return { label: qtypeLabel(weakType), series, deltaType: now.correct - first.correct };
}

/**
 * Сериализуемый пропс клиентского Debrief (/result). Собирается целиком на
 * сервере (page.tsx) — answer/explanation/evidence в `replay` присутствуют
 * ТОЛЬКО когда `replayLocked === false` (fullReview); `missed` безопасен всегда
 * (только number/qtype, без ключа) — используется и как gated-фоллбэк S3, и
 * как список для степпера, когда `replay` ещё не заполнен.
 */
export interface DebriefData {
  title: string;
  category: string | null;
  totalQuestions: number;
  catalogBase: string;
  retryHref: string;

  score: {
    raw: number;
    total: number;
    correctPct: number;
    banded: boolean;
    band: number | null;
    nextBand: number | null;
    marksToNext: number | null;
  };
  metrics: { value: string; label: string; color: string }[];

  blindSpot: BlindSpot | null;

  /** Q-номера/типы пропущенных вопросов — безопасно при любом гейте (без ключа). */
  missed: { number: number; qtype: string; label: string }[];
  /** true когда review закрыт Premium-гейтом — S3 показывает upsell, не степпер. */
  replayLocked: boolean;

  level: {
    rows: { type: string; label: string; correct: number; total: number; weak: boolean; practiseHref: string }[];
    avgPct: number;
    growth: Growth | null;
  };

  plan: {
    weakLabel: string | null;
    drillHref: string | null;
    retryHref: string;
  };

  share: { refCode: string; headline: string; value: string } | null;
}
