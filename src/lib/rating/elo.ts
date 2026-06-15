/**
 * Elo rating math (BRIEF §4.6). Pure functions, NO imports — safe to use on the
 * server or in tests. The user and the test each carry an Elo rating; a graded
 * attempt moves them toward / away from each other by `performance` (the share
 * of questions the user got right, in [0,1]).
 *
 * Only the FIRST submitted attempt of a test is rated (anti-cheat, §4.6); the
 * caller (apply-post-submit) decides that. This module only does the math.
 */

/** Step size — how many points a single rated attempt can move a rating. */
export const ELO_K = 24;

/** Ratings never fall below this floor (keeps newcomers/easy tests bounded). */
export const ELO_FLOOR = 100;

/**
 * Logistic expected score of player A vs player B (standard Elo):
 *   E_A = 1 / (1 + 10^((rB - rA) / 400))
 * Returns a probability in (0,1): A's expected share of the "match".
 */
export function expectedScore(rA: number, rB: number): number {
  return 1 / (1 + Math.pow(10, (rB - rA) / 400));
}

/**
 * Symmetric rating deltas for one rated attempt.
 *
 * - `userRating`  — the user's current Elo.
 * - `testRating`  — the content item's difficulty rating (its Elo).
 * - `performance` — the user's result in [0,1] (rawScore / total).
 * - `k`           — step size (defaults to ELO_K).
 *
 * The user gains what the test loses (zero-sum): userDelta = -testDelta. A
 * stronger-than-expected performance (performance > expected) pushes the user
 * up and the test down; a weaker one does the reverse. Deltas are rounded to
 * whole points (ratings are integers). The caller applies the ELO_FLOOR.
 */
export function ratingDeltas(
  userRating: number,
  testRating: number,
  performance: number,
  k: number = ELO_K,
): { userDelta: number; testDelta: number; expected: number } {
  const expected = expectedScore(userRating, testRating);
  const userDelta = Math.round(k * (performance - expected));
  const testDelta = -userDelta;
  return { userDelta, testDelta, expected };
}
