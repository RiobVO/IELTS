import { describe, it, expect } from "vitest";
import {
  canEvaluate, isStuck, isUnderlength, exceedsSpeakingRate,
  MIN_TRANSCRIPT_WORDS, SPEAKING_RATE_MAX,
} from "./lifecycle";

describe("Speaking lifecycle", () => {
  it("Ultra below daily cap is allowed; premium without preview gets one; preview-used blocked", () => {
    expect(canEvaluate({ configured: true, tier: "ultra", lifetimeCompleted: 0, todayCompleted: 0 }))
      .toEqual({ allowed: true });
    expect(canEvaluate({ configured: true, tier: "premium", lifetimeCompleted: 0, todayCompleted: 0 }))
      .toEqual({ allowed: true }); // free preview
    expect(canEvaluate({ configured: true, tier: "premium", lifetimeCompleted: 1, todayCompleted: 0 }))
      .toEqual({ allowed: false, reason: "preview_used" });
  });
  it("not configured blocks", () => {
    expect(canEvaluate({ configured: false, tier: "ultra", lifetimeCompleted: 0, todayCompleted: 0 }))
      .toEqual({ allowed: false, reason: "not_configured" });
  });
  it("isStuck true past the window", () => {
    const now = new Date("2026-06-28T00:10:00Z");
    expect(isStuck(new Date("2026-06-28T00:00:00Z"), now, 120000)).toBe(true);
    expect(isStuck(new Date("2026-06-28T00:09:59Z"), now, 120000)).toBe(false);
  });
  it("underlength on short transcript", () => {
    expect(isUnderlength("one two three")).toBe(true);
    expect(isUnderlength(Array(MIN_TRANSCRIPT_WORDS + 5).fill("w").join(" "))).toBe(false);
  });
  // N3 (cost-amp, зеркало Writing #21): провал оценки не тратит preview/cap,
  // retry-цикл жёг бы платные Gemini-AUDIO вызовы без ограничения.
  it("rate: под порогом можно, на/выше порога — нельзя", () => {
    expect(exceedsSpeakingRate(SPEAKING_RATE_MAX - 1)).toBe(false);
    expect(exceedsSpeakingRate(SPEAKING_RATE_MAX)).toBe(true);
    expect(exceedsSpeakingRate(SPEAKING_RATE_MAX + 1)).toBe(true);
  });
});
