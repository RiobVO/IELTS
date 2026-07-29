/**
 * Floor-guard для weekly/monthly leaderboard (§4.6, анти-фарм).
 *
 * Рейтинг (Elo) уже не двигается на too-fast first attempt (apply-post-submit:
 * `rated = ... && !isTooFastToRate(...)`), но weekly/monthly snapshot строится
 * отдельным recompute по first submitted attempts и раньше НЕ повторял floor.
 * Итог: мгновенный сабмит с ненулевым score не давал Elo, но попадал в период.
 *
 * Здесь применяется ТОТ ЖЕ предикат `isTooFastToRate` (одна функция, без
 * дублирования формулы в SQL) — leaderboard и rating исключают too-fast строго
 * одинаково. Чистая функция (без I/O) — решение тестируется без БД.
 */
import { isTooFastToRate } from "../anti-cheat";

/** First submitted attempt per (user, test) — поля, нужные для floor-guard + суммы. */
export interface FirstAttemptRow {
  userId: string;
  contentItemId: string;
  rawScore: number | null;
  /** Серверное время прохождения (submit − start); null — нет замера. */
  timeUsedSeconds: number | null;
}

/**
 * Сумма raw_score по юзерам, исключая too-fast first attempts. `totalByTest` —
 * число вопросов теста (count answer_key), нужно для порога too-fast.
 *
 * null `timeUsedSeconds` НЕ считаем too-fast: без серверного замера не наказываем
 * (на submit-пути время проставляется всегда). Неизвестный `total` (теста нет в
 * map) → `isTooFastToRate` с total<=0 вернёт false → строка засчитывается.
 */
export function tallyEligibleScores(
  rows: FirstAttemptRow[],
  totalByTest: Map<string, number>,
): Map<string, number> {
  const scores = new Map<string, number>();
  for (const r of rows) {
    const total = totalByTest.get(r.contentItemId) ?? 0;
    const t = r.timeUsedSeconds;
    if (t != null && isTooFastToRate(t, total)) continue;
    scores.set(r.userId, (scores.get(r.userId) ?? 0) + (r.rawScore ?? 0));
  }
  return scores;
}
