// Витрина «новое на этой неделе» (G1-2): границы окна свежести и порядок.
// Время передаётся параметром — фейк-таймеры не нужны, кейсы детерминированы.
import { describe, it, expect } from "vitest";
import {
  isFresh,
  selectNewThisWeek,
  NEW_WINDOW_MS,
  NEW_SHOWCASE_LIMIT,
} from "./new-tests";

const NOW = Date.parse("2026-08-04T12:00:00.000Z");
const at = (ms: number) => new Date(ms).toISOString();

describe("isFresh", () => {
  it("опубликован час назад — свежий", () => {
    expect(isFresh(at(NOW - 60 * 60 * 1000), NOW)).toBe(true);
  });

  it("ровно на границе окна (7 дней назад) — уже НЕ свежий", () => {
    expect(isFresh(at(NOW - NEW_WINDOW_MS), NOW)).toBe(false);
    expect(isFresh(at(NOW - NEW_WINDOW_MS + 1000), NOW)).toBe(true);
  });

  it("дата из будущего (перекос часов) — не свежий, а не «вечно новый»", () => {
    expect(isFresh(at(NOW + 60 * 60 * 1000), NOW)).toBe(false);
  });

  it("битая дата — не свежий", () => {
    expect(isFresh("not-a-date", NOW)).toBe(false);
    expect(isFresh("", NOW)).toBe(false);
  });
});

describe("selectNewThisWeek", () => {
  it("пустой каталог → пустой результат (блок не рендерится)", () => {
    expect(selectNewThisWeek([], NOW)).toEqual([]);
  });

  it("ни одного свежего → пустой результат", () => {
    const old = [{ publishedAt: at(NOW - 30 * 24 * 60 * 60 * 1000) }];
    expect(selectNewThisWeek(old, NOW)).toEqual([]);
  });

  it("новейшие первыми, старьё отфильтровано", () => {
    const tests = [
      { id: "old", publishedAt: at(NOW - 20 * 24 * 60 * 60 * 1000) },
      { id: "yesterday", publishedAt: at(NOW - 24 * 60 * 60 * 1000) },
      { id: "today", publishedAt: at(NOW - 60 * 1000) },
    ];
    expect(selectNewThisWeek(tests, NOW).map((t) => t.id)).toEqual(["today", "yesterday"]);
  });

  it("режется по лимиту витрины", () => {
    const tests = Array.from({ length: NEW_SHOWCASE_LIMIT + 3 }, (_, i) => ({
      id: String(i),
      publishedAt: at(NOW - (i + 1) * 60 * 1000),
    }));
    expect(selectNewThisWeek(tests, NOW)).toHaveLength(NEW_SHOWCASE_LIMIT);
    expect(selectNewThisWeek(tests, NOW, 2)).toHaveLength(2);
  });
});
