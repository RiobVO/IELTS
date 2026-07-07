/**
 * Чистое ядро «плана до target band» (BRIEF §12.3 шаг 2, W2-5) + owner-путь чтения
 * для его потребителей — дашборда (app/app/page.tsx) и weekly digest
 * (src/lib/email/weekly-digest.ts). computeBandPlan вынесено из инлайн-блока
 * дашборда (weak-типы/band-gain/drill), чтобы обе поверхности считали ОДНО И ТО ЖЕ
 * поверх ОДНОГО контракта входа — иначе «дрилл недели» тихо разъедется между ними.
 *
 * Контракт входа attempts (обязателен для ОБЕИХ поверхностей): most-recent-first
 * (submittedAt DESC), cap 20. getBandPlan применяет тот же cap в SQL; дашборд
 * держит тот же .limit(20) в своём Supabase-запросе.
 */
import "server-only";
import { and, desc, eq, lte } from "drizzle-orm";
import { db } from "@/db";
import { attempt, contentItem, profile } from "@/db/schema";
import { aggregateWeakness, type PerTypeBreakdown } from "@/lib/practice/weakness";
import { bandForScore } from "@/lib/grading/band";
import { qtypeLabel, LISTENING_CATEGORIES } from "@/lib/labels";

export interface BandPlanAttempt {
  bandScore: number | null;
  rawScore: number | null;
  perTypeBreakdown: PerTypeBreakdown;
  /** Секция теста (маппится из content_item.category вызывающей стороной). */
  section: "reading" | "listening";
  bandScale: Record<string, number> | null;
  submittedAt: Date | string | null;
}

export interface BandPlanWeakType {
  qtype: string;
  label: string;
  /** Секция, где этот тип реально теряет очки (больше missed; ничья → reading). */
  section: "reading" | "listening";
  correct: number;
  total: number;
  /** Округлённый процент верных, 0–100. */
  pct: number;
}

export interface BandPlanDrill {
  qtype: string;
  label: string;
  section: "reading" | "listening";
  estMinutes: number;
  /** null — нет band-шкалы (или прирост < 0.5) для честной оценки. */
  bandGain: number | null;
}

export interface BandPlan {
  /** Band свежайшей banded-попытки (band есть только у Full-40Q тестов) или null. */
  currentBand: number | null;
  targetBand: number | null;
  /** max(0, target − current); null, если currentBand или targetBand неизвестны. */
  distance: number | null;
  reached: boolean;
  weakTypes: BandPlanWeakType[];
  /** Рекомендованный дрилл недели по слабейшему типу; null, если тренировать нечего. */
  drill: BandPlanDrill | null;
}

// Минуты на 1 промах и шаг округления дрилла — как в прежнем инлайне дашборда.
const MINUTES_PER_MISS = 1.2;
const DRILL_ROUND_STEP = 5;
const MIN_DRILL_MINUTES = 5;
const BAND_STEP = 0.5; // округление band-gain вниз до ближайшего шага шкалы

/** Сколько очков потеряно в одной breakdown-записи (0, если поле битое/нулевое). */
function missed(v: { correct?: unknown; total?: unknown } | undefined): number {
  if (!v) return 0;
  const correct = Number(v.correct);
  const total = Number(v.total);
  if (!Number.isFinite(correct) || !Number.isFinite(total) || total <= 0) return 0;
  return total - correct;
}

/** total одной breakdown-записи (0, если поле битое/нулевое). */
function totalOf(v: { total?: unknown } | undefined): number {
  const total = Number(v?.total);
  return Number.isFinite(total) ? total : 0;
}

/**
 * Секция, где qtype реально теряет очки (больше missed) — как в прежней инлайн-
 * логике дашборда: ничья → reading (больший каталог для "Fix this weakness").
 */
function sectionFor(attempts: BandPlanAttempt[], qtype: string): "reading" | "listening" {
  let rLost = 0;
  let lLost = 0;
  for (const a of attempts) {
    const lost = missed(a.perTypeBreakdown?.[qtype]);
    if (a.section === "listening") lLost += lost;
    else rLost += lost;
  }
  return lLost > rLost ? "listening" : "reading";
}

/**
 * ЧИСТАЯ сборка плана из уже загруженных попыток — без IO/env/db, детерминирована:
 * одинаковый вход всегда даёт идентичный выход.
 */
export function computeBandPlan(
  attempts: BandPlanAttempt[],
  targetBand: number | null,
): BandPlan {
  const currentBand = attempts.find((a) => a.bandScore != null)?.bandScore ?? null;
  const distance =
    targetBand != null && currentBand != null ? Math.max(0, targetBand - currentBand) : null;
  const reached = targetBand != null && currentBand != null && currentBand >= targetBand;

  const rows = aggregateWeakness(attempts.map((a) => a.perTypeBreakdown));
  const weakTypes: BandPlanWeakType[] = rows.map((r) => ({
    qtype: r.qtype,
    label: qtypeLabel(r.qtype),
    section: sectionFor(attempts, r.qtype),
    correct: r.correct,
    total: r.total,
    pct: r.pct,
  }));

  const weakest = weakTypes[0] ?? null;
  let drill: BandPlanDrill | null = null;
  if (weakest) {
    // Свежайшая (most-recent-first) banded-попытка со шкалой, где встречался этот
    // тип — честная оценка band-gain из РЕАЛЬНОЙ шкалы теста, а не кросс-попыточная
    // сумма (как в прежнем инлайне дашборда).
    const ref = attempts.find(
      (a) => a.bandScore != null && a.bandScale != null && totalOf(a.perTypeBreakdown?.[weakest.qtype]) > 0,
    );
    const refMissed = ref ? missed(ref.perTypeBreakdown?.[weakest.qtype]) : 0;

    let bandGain: number | null = null;
    if (ref && refMissed > 0 && ref.rawScore != null && ref.bandScore != null) {
      const better = bandForScore(ref.bandScale, ref.rawScore + refMissed);
      if (better != null) {
        const gain = Math.floor((better - ref.bandScore) / BAND_STEP) * BAND_STEP; // округление ВНИЗ до 0.5
        if (gain >= BAND_STEP) bandGain = gain;
      }
    }

    const drillMissed = refMissed > 0 ? refMissed : weakest.total - weakest.correct;
    if (drillMissed > 0) {
      const estMinutes = Math.max(
        MIN_DRILL_MINUTES,
        Math.round((drillMissed * MINUTES_PER_MISS) / DRILL_ROUND_STEP) * DRILL_ROUND_STEP,
      );
      drill = { qtype: weakest.qtype, label: weakest.label, section: weakest.section, estMinutes, bandGain };
    }
  }

  return { currentBand, targetBand, distance, reached, weakTypes, drill };
}

// Кап и порядок один-в-один с дашбордом (app/app/page.tsx `.limit(20)`) — см.
// контракт входа в доке модуля.
const ATTEMPT_CAP = 20;

/**
 * Owner-путь (Drizzle, обходит RLS): только несекретные поля попытки/контента
 * (никогда answer_key/attempt_review_snapshot), как getVocabDueSummary. `now`
 * ограничивает выборку сверху — для детерминированных ре-ранов (мирроит
 * runWeeklyDigest(now)).
 */
export async function getBandPlan(userId: string, now: Date = new Date()): Promise<BandPlan> {
  const listeningCats = new Set<string>(LISTENING_CATEGORIES);

  const [[prof], rows] = await Promise.all([
    db.select({ targetBand: profile.targetBand }).from(profile).where(eq(profile.id, userId)),
    db
      .select({
        bandScore: attempt.bandScore,
        rawScore: attempt.rawScore,
        perTypeBreakdown: attempt.perTypeBreakdown,
        submittedAt: attempt.submittedAt,
        category: contentItem.category,
        bandScale: contentItem.bandScale,
      })
      .from(attempt)
      .innerJoin(contentItem, eq(contentItem.id, attempt.contentItemId))
      .where(
        and(eq(attempt.userId, userId), eq(attempt.status, "submitted"), lte(attempt.submittedAt, now)),
      )
      .orderBy(desc(attempt.submittedAt))
      .limit(ATTEMPT_CAP),
  ]);

  const attempts: BandPlanAttempt[] = rows.map((r) => ({
    bandScore: r.bandScore != null ? Number(r.bandScore) : null,
    rawScore: r.rawScore,
    perTypeBreakdown: r.perTypeBreakdown as PerTypeBreakdown,
    section: listeningCats.has(r.category) ? "listening" : "reading",
    bandScale: r.bandScale as Record<string, number> | null,
    submittedAt: r.submittedAt,
  }));

  const targetBand = prof?.targetBand != null ? Number(prof.targetBand) : null;
  return computeBandPlan(attempts, targetBand);
}
