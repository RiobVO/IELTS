// Чистые вычисления для страницы /result «дебриф» (без I/O, без React). Данные
// уже загружены и посчитаны в page.tsx (grade(), band_scale, история попыток) —
// здесь только бизнес-правила поверх них: near-miss к следующему band, слепая
// зона (Not Given и симметричные типы), рост по слабому типу между попытками.

import * as cheerio from "cheerio";
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
 * пуст (не с чем сравнивать), ИЛИ бакеты равны по проценту (perfect/all-miss/
 * ровный профиль — реальной слепой зоны нет, диагноз был бы произвольным) —
 * тогда S2 на вызывающей стороне генерализуется до слабейшего типа (там уже
 * есть perType/weakest, второй источник не нужен).
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
  if (ngPct === valPct) return null;
  const [weak, strong, label]: [BlindSpotBucket, BlindSpotBucket, string] =
    ngPct < valPct ? [ngBucket, valBucket, "Not Given"] : [valBucket, ngBucket, valueLabel];

  return { label, weakBucket: weak, strongBucket: strong, costMarks: weak.total - weak.correct };
}

/**
 * Генерализованный фоллбэк blindSpot — для попыток без ternary-вопросов вовсе,
 * или где computeBlindSpot не нашёл настоящей NG/value слепой зоны. Раньше
 * page.tsx подставлял сюда просто "слабейший тип" (perType[0]) без гейта — на
 * all-miss или ровной ничьей это давало произвольный "диагноз" (hero
 * утверждал "the rest of your answers average much higher", хотя остальные
 * типы были ровно так же плохи). Гейт: генерализация валидна ТОЛЬКО когда
 * слабейший тип строго хуже среднего по всем остальным типам — иначе null
 * (hero уходит в свой собственный null-фоллбэк).
 */
export function computeGeneralizedBlindSpot(
  perType: [string, { correct: number; total: number }][],
): BlindSpot | null {
  if (perType.length < 2) return null;
  const sorted = [...perType].sort((a, b) => a[1].correct / a[1].total - b[1].correct / b[1].total);
  const [weakType, weakStats] = sorted[0];
  const rest = sorted.slice(1);
  const restAvgPct = rest.reduce((sum, [, s]) => sum + s.correct / s.total, 0) / rest.length;
  const weakPct = weakStats.correct / weakStats.total;
  const costMarks = weakStats.total - weakStats.correct;
  if (costMarks === 0 || weakPct >= restAvgPct) return null;
  return {
    label: qtypeLabel(weakType),
    weakBucket: { correct: weakStats.correct, total: weakStats.total },
    strongBucket: null,
    costMarks,
  };
}

/**
 * Тег вопроса для guided-replay чипа (Review Room, derive-добавка §e-1):
 * помечает, принадлежит ли ИМЕННО ЭТОТ вопрос диагностированному blindSpot —
 * "your blind spot" для настоящей Not-Given слепой зоны, "common trap" для
 * симметричного случая (True/False или Yes/No — слабый бакет) либо для
 * генерализованного fallback (blindSpot без strongBucket, весь тип слабый).
 * null, если blindSpot не задан или вопрос вне его бакета/типа.
 */
export function blindSpotTag(
  q: { qtype: string; accept: string[] },
  blindSpot: BlindSpot | null,
): string | null {
  if (!blindSpot) return null;
  const isNg = q.accept.some((a) => a.trim().toUpperCase() === NG_ACCEPT);
  const belongs = blindSpot.strongBucket
    ? TERNARY_TYPES.has(q.qtype) && (blindSpot.label === "Not Given" ? isNg : !isNg)
    : qtypeLabel(q.qtype) === blindSpot.label;
  if (!belongs) return null;
  return blindSpot.label === "Not Given" ? "your blind spot" : "common trap";
}

/**
 * Единая цель коучинга (P1 fix — унификация hero/dock/By-type): какой ИМЕННО
 * qtype считать "тем самым типом" для drill-CTA (plan.weakLabel/drillHref) и
 * для focus-подсветки строки в By-type. Раньше hero (blindSpot) и dock/
 * таблица (weakest = perType[0]) могли расходиться — hero говорил "Not
 * Given", а дрилл предлагал совсем другой тип. Источник — реальный blindSpot,
 * если он есть: берём qtype вопросов, которые blindSpotTag реально относит к
 * нему (при разночтении tfng/ynng внутри одного ternary-бакета побеждает
 * большинство). Без blindSpot — просто fallback (обычно perType[0]).
 */
export function resolveFocusQType(
  perQuestion: { number: number; qtype: string }[],
  meta: Map<number, { accept: string[] }>,
  blindSpot: BlindSpot | null,
  fallback: string | null,
): string | null {
  if (!blindSpot) return fallback;
  const counts = new Map<string, number>();
  for (const q of perQuestion) {
    const accept = meta.get(q.number)?.accept ?? [];
    if (blindSpotTag({ qtype: q.qtype, accept }, blindSpot) == null) continue;
    counts.set(q.qtype, (counts.get(q.qtype) ?? 0) + 1);
  }
  if (counts.size === 0) return fallback;
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * Shareable one-liner (Telegram viral loop, W1-5) — first-person, без
 * завершающего двоеточия (coach-редизайн: старый вариант звучал как заголовок
 * поста, не как реплика от лица игрока). Вынесено из page.tsx в чистую
 * функцию, чтобы формулировку можно было проверить юнит-тестом. `section` —
 * роут /result общий для reading и listening (P1 fix), раньше оба сценария
 * хардкодили "IELTS Reading".
 */
export function buildShareHeadline(
  banded: boolean,
  band: number | null,
  pct: number,
  section: "reading" | "listening",
): string {
  const sectionLabel = section === "listening" ? "IELTS Listening" : "IELTS Reading";
  return banded
    ? `I just hit Band ${band} on ${sectionLabel} with bando — and finally found the one habit costing me marks.`
    : `I scored ${pct}% on ${sectionLabel} with bando and pinned down exactly which question type is costing me marks.`;
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
  // "2nd" — это реально вторая попытка (points[1]), а не предпоследняя: при
  // 4+ попытках points[length-2] указывал бы на какую-то среднюю попытку под
  // неверным лейблом "2nd".
  const series: GrowthBar[] =
    points.length === 2
      ? [{ tag: "1st", ...first }, { tag: "now", ...now }]
      : [{ tag: "1st", ...first }, { tag: "2nd", ...points[1] }, { tag: "now", ...now }];

  return { label: qtypeLabel(weakType), series, deltaType: now.correct - first.correct };
}

/**
 * question.prompt_html → чистый текст (S3 replay stem). cheerio уже зависимость
 * проекта (src/lib/import/parse-test.ts) — режем тегами через него, а не regex,
 * чтобы вложенная разметка и HTML-entities (&amp; и т.п.) декодировались верно.
 */
export function stripHtml(html: string): string {
  return cheerio.load(html).root().text().replace(/\s+/g, " ").trim();
}

/**
 * Сериализуемый пропс клиентского ResultCoach (/result). Собирается целиком на
 * сервере (page.tsx) — answer/explanation/evidence в `replay` присутствуют
 * ТОЛЬКО когда `replayLocked === false` (fullReview); `missed` безопасен всегда
 * (только number/qtype, без ключа) — используется и как gated-фоллбэк Review
 * Room, и как список для степпера, когда `replay` ещё не заполнен.
 */
export interface DebriefData {
  title: string;
  category: string | null;
  totalQuestions: number;
  catalogBase: string;
  retryHref: string;
  /** attempt.mode === 'practice' (P12) — Hero/Dock скрывают band-вердикт и
   *  переходят на learning-тон; mock (false) рендерится как раньше, байт-в-байт. */
  isPractice: boolean;
  /** Id этой попытки — клиентский остров калибровки (P10) читает по нему
   *  per-attempt localStorage `bando-confidence-<attemptId>`. */
  attemptId: string;
  /** Practice-only (P10) — вердикты по вопросам (number/correct, БЕЗ ключа) для
   *  калибровки уверенности на клиенте; пусто для mock (инвариант 1). Владелец
   *  сданной попытки и так видит эти вердикты в разборе (инвариант 2). */
  perQuestionCorrect: { number: number; correct: boolean }[];

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
  /**
   * Полные данные для guided-replay степпера — ТОЛЬКО пропущенные вопросы, и
   * ТОЛЬКО когда replayLocked === false (answer/why/evidence никогда не
   * сериализуются иначе — тот же гейт, что у answer_key). `options` задан
   * только для tfng/ynng (re-pick интерактивен); у прочих типов null —
   * reveal-only (decision §3).
   */
  replay: {
    number: number;
    type: string;
    stem: string;
    options: string[] | null;
    given: string;
    answer: string;
    why: string | null;
    evidence: string | null;
    /** Ungated generic per-type reference — тот же qtypeDescription, что и у akItems.strategy (деградация как в Answer key). */
    strategy: string;
    /** derive-добавка §e-1 — см. blindSpotTag(). */
    tag: string | null;
  }[];

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

  share: { refCode: string; headline: string } | null;

  /** Practice-only (P13) — вопросы, неверные из-за нарушения ФОРМАТА промпта
   *  (лимит слов / число выборов), не из-за смысла ответа. Пусто для mock. */
  formatLoss: { number: number; reason: "word-limit" | "choice-count" }[];
}
