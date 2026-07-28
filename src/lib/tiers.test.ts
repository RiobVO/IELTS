// Юнит-тесты гейтинга тарифов (BRIEF §4.8). effectiveTier зависит от времени →
// фейк-таймеры (без реальных часов, иначе кейсы «будущее/прошлое» недетерминированы).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { effectiveTier, meetsTier, hasFullReview, REVIEW_OPEN } from "./tiers";

describe("effectiveTier", () => {
  // Фиксированные даты строятся из ISO-строк (не зависят от реальных часов),
  // а «сейчас» внутри функции (Date.now) подменяется фейк-таймером.
  const NOW = new Date("2026-06-17T12:00:00.000Z");
  const future = new Date("2026-06-18T12:00:00.000Z"); // NOW + 1 день
  const past = new Date("2026-06-16T12:00:00.000Z"); // NOW − 1 день

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("basic всегда basic — даже с будущим premium_until", () => {
    expect(effectiveTier({ tier: "basic", premium_until: future })).toBe("basic");
  });

  it("не-basic без срока (premium_until=null) сохраняется", () => {
    expect(effectiveTier({ tier: "premium", premium_until: null })).toBe("premium");
    expect(effectiveTier({ tier: "ultra", premium_until: null })).toBe("ultra");
  });

  it("не-basic с будущим сроком сохраняется (Date и ISO-строка)", () => {
    expect(effectiveTier({ tier: "premium", premium_until: future })).toBe("premium");
    expect(effectiveTier({ tier: "premium", premium_until: future.toISOString() })).toBe(
      "premium",
    );
  });

  it("не-basic с истёкшим сроком деградирует в basic", () => {
    expect(effectiveTier({ tier: "premium", premium_until: past })).toBe("basic");
    expect(effectiveTier({ tier: "ultra", premium_until: past.toISOString() })).toBe("basic");
  });

  it("срок ровно в текущий момент считается истёкшим (строгое >)", () => {
    expect(effectiveTier({ tier: "premium", premium_until: new Date(NOW) })).toBe("basic");
  });
});

describe("meetsTier", () => {
  it("тариф удовлетворяет сам себе", () => {
    expect(meetsTier("basic", "basic")).toBe(true);
    expect(meetsTier("premium", "premium")).toBe(true);
    expect(meetsTier("ultra", "ultra")).toBe(true);
  });

  it("старший тариф удовлетворяет младшему требованию", () => {
    expect(meetsTier("premium", "basic")).toBe(true);
    expect(meetsTier("ultra", "basic")).toBe(true);
    expect(meetsTier("ultra", "premium")).toBe(true);
  });

  it("младший тариф НЕ удовлетворяет старшему требованию", () => {
    expect(meetsTier("basic", "premium")).toBe(false);
    expect(meetsTier("basic", "ultra")).toBe(false);
    expect(meetsTier("premium", "ultra")).toBe(false);
  });
});

describe("hasFullReview", () => {
  // Гейт ЗАКРЫТ (open=false): прежнее поведение — разбор только premium/ultra.
  it("closed: premium и ultra да, basic нет", () => {
    expect(hasFullReview("premium", false)).toBe(true);
    expect(hasFullReview("ultra", false)).toBe(true);
    expect(hasFullReview("basic", false)).toBe(false);
  });

  // Гейт ОТКРЫТ (open=true): разбор бесплатен всем, включая basic.
  it("open: разбор бесплатен всем, включая basic", () => {
    expect(hasFullReview("basic", true)).toBe(true);
    expect(hasFullReview("premium", true)).toBe(true);
    expect(hasFullReview("ultra", true)).toBe(true);
  });

  // По умолчанию следует launch-флагу REVIEW_OPEN, каким бы он ни был — инвариант,
  // а не хардкод значения флага. Защищает обе стороны переключателя: при open=false
  // дефолт повторяет premium-гейт (basic — нет), при open=true стал бы free для всех.
  it("по умолчанию следует REVIEW_OPEN (без хардкода значения флага)", () => {
    expect(hasFullReview("basic")).toBe(REVIEW_OPEN);
    // Явные кейсы premium-гейта (open=false): basic закрыт, premium открыт —
    // фиксируют сам гейт независимо от текущего значения REVIEW_OPEN.
    expect(hasFullReview("basic", false)).toBe(false);
    expect(hasFullReview("premium", false)).toBe(true);
  });
});
