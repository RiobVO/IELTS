// Юнит-тесты floor-guard для weekly/monthly leaderboard.
// Контракт: too-fast first attempt (зеркало rated, §4.6) НЕ попадает в период;
// нормальный считается; null-время не трактуем как too-fast; суммы — по юзеру.
// MIN_RATED_SECONDS_PER_QUESTION = 3 → порог too-fast = total*3.
import { describe, it, expect } from "vitest";
import { tallyEligibleScores, type FirstAttemptRow } from "./leaderboard-score";

const totals = new Map<string, number>([
  ["t10", 10], // порог too-fast: < 30s
  ["t40", 40], // порог too-fast: < 120s
]);

const row = (o: Partial<FirstAttemptRow>): FirstAttemptRow => ({
  userId: "u1",
  contentItemId: "t10",
  rawScore: 5,
  timeUsedSeconds: 600,
  ...o,
});

describe("tallyEligibleScores", () => {
  it("считает нормальный first attempt (время >= total*3)", () => {
    const m = tallyEligibleScores([row({ timeUsedSeconds: 600 })], totals);
    expect(m.get("u1")).toBe(5);
  });

  it("исключает too-fast first attempt (время < total*3)", () => {
    const m = tallyEligibleScores([row({ timeUsedSeconds: 5 })], totals);
    expect(m.has("u1")).toBe(false);
  });

  it("граница: время ровно total*3 — НЕ too-fast, считается", () => {
    const m = tallyEligibleScores([row({ contentItemId: "t40", timeUsedSeconds: 120 })], totals);
    expect(m.get("u1")).toBe(5);
  });

  it("null-время не трактуем как too-fast — считается", () => {
    const m = tallyEligibleScores([row({ timeUsedSeconds: null })], totals);
    expect(m.get("u1")).toBe(5);
  });

  it("неизвестный total (нет в map) → не too-fast, считается", () => {
    const m = tallyEligibleScores([row({ contentItemId: "ghost", timeUsedSeconds: 1 })], totals);
    expect(m.get("u1")).toBe(5);
  });

  it("суммирует несколько тестов одного юзера, исключая too-fast", () => {
    const m = tallyEligibleScores(
      [
        row({ contentItemId: "t10", rawScore: 7, timeUsedSeconds: 600 }),
        row({ contentItemId: "t40", rawScore: 9, timeUsedSeconds: 600 }),
        row({ contentItemId: "t10", rawScore: 8, timeUsedSeconds: 2 }), // too-fast → drop
      ],
      totals,
    );
    expect(m.get("u1")).toBe(16);
  });

  it("разные юзеры считаются раздельно; rawScore=null → 0", () => {
    const m = tallyEligibleScores(
      [
        row({ userId: "u1", rawScore: 4 }),
        row({ userId: "u2", rawScore: null }),
      ],
      totals,
    );
    expect(m.get("u1")).toBe(4);
    expect(m.get("u2")).toBe(0);
  });
});
