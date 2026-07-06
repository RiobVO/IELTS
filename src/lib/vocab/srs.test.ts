// Юнит-тесты SM-2-ядра (чистая логика, без IO). now фиксирован → dueAt детерминирован.
import { describe, it, expect } from "vitest";
import { reviewCard, type SrsState } from "./srs";

const NOW = new Date("2026-07-06T00:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

/** Округлённая разница dueAt−NOW в днях (устойчиво к float на умножении интервала). */
function daysAfterNow(due: Date): number {
  return Math.round((due.getTime() - NOW.getTime()) / DAY);
}

describe("reviewCard — лестница good", () => {
  it("первый good: interval 1 день, repetitions 1, due = now + 1д, ease 2.55", () => {
    const { state, dueAt } = reviewCard(null, "good", NOW);
    expect(state.intervalDays).toBe(1);
    expect(state.repetitions).toBe(1);
    expect(state.lapses).toBe(0);
    expect(daysAfterNow(dueAt)).toBe(1);
    expect(state.ease).toBeCloseTo(2.55, 5);
  });

  it("второй good: interval 3 дня, repetitions 2, ease 2.60", () => {
    const first = reviewCard(null, "good", NOW).state;
    const { state, dueAt } = reviewCard(first, "good", NOW);
    expect(state.intervalDays).toBe(3);
    expect(state.repetitions).toBe(2);
    expect(daysAfterNow(dueAt)).toBe(3);
    expect(state.ease).toBeCloseTo(2.6, 5);
  });

  it("третий+ good: interval = round(prev.interval × prev.ease) и растёт", () => {
    let s: SrsState | null = null;
    s = reviewCard(s, "good", NOW).state; // interval 1
    s = reviewCard(s, "good", NOW).state; // interval 3, ease 2.60
    const third = reviewCard(s, "good", NOW); // round(3 × 2.60) = 8
    expect(third.state.intervalDays).toBe(8);
    const fourth = reviewCard(third.state, "good", NOW); // round(8 × 2.65) = 21
    expect(fourth.state.intervalDays).toBe(21);
    expect(fourth.state.intervalDays).toBeGreaterThan(third.state.intervalDays);
  });
});

describe("reviewCard — коридор ease", () => {
  it("ease растёт по +0.05 за good", () => {
    const s1 = reviewCard(null, "good", NOW).state;
    const s2 = reviewCard(s1, "good", NOW).state;
    expect(s2.ease).toBeCloseTo(s1.ease + 0.05, 5);
  });

  it("потолок ease 2.8 после серии good (не превышает)", () => {
    let s: SrsState | null = null;
    for (let i = 0; i < 12; i++) s = reviewCard(s, "good", NOW).state;
    expect(s!.ease).toBeCloseTo(2.8, 5);
    expect(s!.ease).toBeLessThanOrEqual(2.8);
  });

  it("пол ease 1.3 после серии again (не опускается ниже)", () => {
    let s: SrsState | null = null;
    for (let i = 0; i < 12; i++) s = reviewCard(s, "again", NOW).state;
    expect(s!.ease).toBeCloseTo(1.3, 5);
    expect(s!.ease).toBeGreaterThanOrEqual(1.3);
  });
});

describe("reviewCard — again (провал)", () => {
  it("again по новой карте: lapse 1, interval 0, repetitions 0, due = now, ease 2.3", () => {
    const { state, dueAt } = reviewCard(null, "again", NOW);
    expect(state.lapses).toBe(1);
    expect(state.intervalDays).toBe(0);
    expect(state.repetitions).toBe(0);
    expect(dueAt.getTime()).toBe(NOW.getTime());
    expect(state.ease).toBeCloseTo(2.3, 5); // 2.5 − 0.2
  });

  it("again после серии good: repetitions→0, interval→0, lapse++, ease−0.2", () => {
    let s: SrsState | null = null;
    s = reviewCard(s, "good", NOW).state;
    s = reviewCard(s, "good", NOW).state;
    s = reviewCard(s, "good", NOW).state; // repetitions 3
    const easeBefore = s.ease;
    const again = reviewCard(s, "again", NOW);
    expect(again.state.repetitions).toBe(0);
    expect(again.state.intervalDays).toBe(0);
    expect(again.state.lapses).toBe(1);
    expect(again.dueAt.getTime()).toBe(NOW.getTime());
    expect(again.state.ease).toBeCloseTo(easeBefore - 0.2, 5);
  });

  it("good после again перезапускает лестницу с 1 дня", () => {
    const afterAgain = reviewCard(null, "again", NOW).state; // repetitions 0, interval 0
    const good = reviewCard(afterAgain, "good", NOW);
    expect(good.state.repetitions).toBe(1);
    expect(good.state.intervalDays).toBe(1);
  });
});

describe("reviewCard — детерминизм", () => {
  it("одинаковый (state, grade, now) → идентичный результат", () => {
    const input: SrsState = { ease: 2.6, intervalDays: 3, repetitions: 2, lapses: 0 };
    const a = reviewCard(input, "good", NOW);
    const b = reviewCard(input, "good", NOW);
    expect(a.state).toEqual(b.state);
    expect(a.dueAt.getTime()).toBe(b.dueAt.getTime());
  });
});
