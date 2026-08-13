/**
 * Чистые предикаты критериев бейджей — БЕЗ IO-импортов (не тянет `@/db`), чтобы
 * юнит-тесты грузились без БД/env. Вычисление `UserStats` и выдача бейджей живут
 * в `./badges` (owner DB-путь); здесь — только типы критериев и чистая логика
 * `isMet`/`badgeProgress` над уже посчитанным `UserStats`.
 */

/** The `badge.criteria` jsonb shapes (discriminated union on `type`). */
export type Criteria =
  | { type: "volume"; tests: number }
  | { type: "streak"; days: number }
  | { type: "rating"; min: number }
  | { type: "perfect" }
  | {
      type: "accuracy";
      qtype: string;
      minQuestions: number;
      minPct: number;
    }
  | { type: "first_place"; scope: string; period: string }
  | { type: "mistakes_closed"; count: number }
  | { type: "weak_type_cleared"; perType: number };

/** Per-qtype aggregate (summed correct/total across submitted attempts). */
export interface QtypeAgg {
  correct: number;
  total: number;
}

/** Everything a criteria can be evaluated against, computed once per call. */
export interface UserStats {
  rating: number;
  currentStreak: number;
  volume: number;
  hasPerfect: boolean;
  perQtype: Map<string, QtypeAgg>;
  isFirstPlaceGlobalAllTime: boolean;
  /** Total `mistake_resolution` rows across all qtypes (W2-5 study-loop badges). */
  closedMistakesTotal: number;
  /** `mistake_resolution` rows per qtype — feeds the "cleared one weak type" badge. */
  closedByQtype: Map<string, number>;
}

/** Best (highest) per-qtype closed count, or 0 when nothing is closed yet. */
function bestClosedByQtype(closedByQtype: Map<string, number>): number {
  let best = 0;
  for (const n of closedByQtype.values()) best = Math.max(best, n);
  return best;
}

/** Does `stats` satisfy `criteria`? Unknown type => not met. */
export function isMet(criteria: Criteria, stats: UserStats): boolean {
  switch (criteria.type) {
    case "volume":
      return stats.volume >= criteria.tests;
    case "streak":
      return stats.currentStreak >= criteria.days;
    case "rating":
      return stats.rating >= criteria.min;
    case "perfect":
      return stats.hasPerfect;
    case "accuracy": {
      const agg = stats.perQtype.get(criteria.qtype);
      if (!agg || agg.total <= 0) return false;
      if (agg.total < criteria.minQuestions) return false;
      return (agg.correct / agg.total) * 100 >= criteria.minPct;
    }
    case "first_place":
      // The only first_place scope/period we precompute an award for is the
      // global / all_time #1 (the "champion" badge). Any other scope/period is
      // treated as not-met (no source of truth computed here).
      return (
        criteria.scope === "global" &&
        criteria.period === "all_time" &&
        stats.isFirstPlaceGlobalAllTime
      );
    case "mistakes_closed":
      return stats.closedMistakesTotal >= criteria.count;
    case "weak_type_cleared":
      return bestClosedByQtype(stats.closedByQtype) >= criteria.perType;
    default:
      // Unknown discriminant — never award.
      return false;
  }
}

/** Read-side progress of a not-yet-earned badge (for the badges page). */
export interface BadgeProgress {
  /** 0..1 ratio toward the unlock threshold (clamped). */
  pct: number;
  /** Human hint, e.g. "3 / 10 tests". */
  hint: string;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/**
 * How close `stats` is to satisfying `criteria` — same thresholds as `isMet`,
 * surfaced as a ratio + hint for the locked-badge rings. Two-condition criteria
 * (accuracy: enough answered AND high enough %) track the visible "answered"
 * gate; the % is enforced by `isMet` at award time.
 */
export function badgeProgress(criteria: Criteria, stats: UserStats): BadgeProgress {
  switch (criteria.type) {
    case "volume":
      return { pct: clamp01(stats.volume / criteria.tests), hint: `${stats.volume} / ${criteria.tests} tests` };
    case "streak":
      return { pct: clamp01(stats.currentStreak / criteria.days), hint: `${stats.currentStreak} / ${criteria.days} days` };
    case "rating":
      return { pct: clamp01(stats.rating / criteria.min), hint: `${stats.rating} / ${criteria.min} rating` };
    case "perfect":
      return { pct: stats.hasPerfect ? 1 : 0, hint: stats.hasPerfect ? "Earned" : "Score 100% on a test" };
    case "accuracy": {
      const agg = stats.perQtype.get(criteria.qtype);
      const answered = agg?.total ?? 0;
      return { pct: clamp01(answered / criteria.minQuestions), hint: `${answered} / ${criteria.minQuestions} answered` };
    }
    case "first_place":
      return {
        pct: stats.isFirstPlaceGlobalAllTime ? 1 : 0,
        hint: stats.isFirstPlaceGlobalAllTime ? "Earned" : "Reach #1 globally",
      };
    case "mistakes_closed":
      return {
        pct: clamp01(stats.closedMistakesTotal / criteria.count),
        hint: `${stats.closedMistakesTotal} / ${criteria.count} mistakes closed`,
      };
    case "weak_type_cleared": {
      const best = bestClosedByQtype(stats.closedByQtype);
      return {
        pct: clamp01(best / criteria.perType),
        hint: `${best} / ${criteria.perType} closed in one weak type`,
      };
    }
    default:
      return { pct: 0, hint: "" };
  }
}
