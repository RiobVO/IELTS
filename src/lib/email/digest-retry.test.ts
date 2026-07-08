import { describe, expect, it } from "vitest";
import { digestNeedsRetry, parseDigestClaimStats } from "./digest-retry";

const WEEK = "2026-W28";

describe("digestNeedsRetry", () => {
  it("текущая неделя, sent:false (pending) → нужен ретрай", () => {
    expect(digestNeedsRetry({ week: WEEK, sent: false, rating: 1200 }, WEEK)).toBe(true);
  });

  it("sent:true → уже доставлено, ретрай не нужен", () => {
    expect(digestNeedsRetry({ week: WEEK, sent: true }, WEEK)).toBe(false);
  });

  it("legacy-строка без ключа sent → НЕ ретраим (иначе дубли в неделю деплоя)", () => {
    expect(digestNeedsRetry({ week: WEEK, rating: 1200 }, WEEK)).toBe(false);
  });

  it("другая неделя → не наш прогон, ретрай не нужен", () => {
    expect(digestNeedsRetry({ week: "2026-W27", sent: false }, WEEK)).toBe(false);
  });

  it("кривой/пустой data (null/строка/массив/без week) → false", () => {
    expect(digestNeedsRetry(null, WEEK)).toBe(false);
    expect(digestNeedsRetry("oops", WEEK)).toBe(false);
    expect(digestNeedsRetry([WEEK], WEEK)).toBe(false);
    expect(digestNeedsRetry({ sent: false, rating: 1 }, WEEK)).toBe(false);
  });
});

describe("parseDigestClaimStats", () => {
  it("полный data → все числа", () => {
    expect(
      parseDigestClaimStats({
        week: WEEK,
        rating: 1200,
        ratingDelta: 35,
        testsCount: 4,
        avgBand: 6.5,
        avgPercent: 72,
      }),
    ).toEqual({ rating: 1200, ratingDelta: 35, testsCount: 4, avgBand: 6.5, avgPercent: 72 });
  });

  it("null-поля (первая неделя, нет band) сохраняются как null", () => {
    expect(parseDigestClaimStats({ rating: 900, testsCount: 1, ratingDelta: null, avgBand: null, avgPercent: null })).toEqual({
      rating: 900,
      ratingDelta: null,
      testsCount: 1,
      avgBand: null,
      avgPercent: null,
    });
  });

  it("нет rating или testsCount → null (письмо не собрать)", () => {
    expect(parseDigestClaimStats({ week: WEEK, testsCount: 3 })).toBeNull();
    expect(parseDigestClaimStats({ week: WEEK, rating: 1000 })).toBeNull();
    expect(parseDigestClaimStats(null)).toBeNull();
  });
});
