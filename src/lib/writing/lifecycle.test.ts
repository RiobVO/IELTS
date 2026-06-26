import { describe, it, expect } from "vitest";
import {
  canEvaluate,
  validateEssay,
  isStuck,
  WRITING_DAILY_CAP_PREMIUM,
  WRITING_DAILY_CAP_ULTRA,
  WRITING_STALE_MS,
  MIN_WORDS,
  MAX_WORDS,
} from "./lifecycle";

describe("validateEssay", () => {
  it("rejects too short", () => {
    expect(validateEssay("one two three")).toEqual({ ok: false, reason: "too_short" });
  });
  it("rejects too long (cost guard)", () => {
    expect(validateEssay(Array(MAX_WORDS + 1).fill("w").join(" "))).toEqual({ ok: false, reason: "too_long" });
  });
  it("accepts a normal essay and counts words", () => {
    const text = Array(MIN_WORDS + 5).fill("word").join(" ");
    expect(validateEssay(text)).toEqual({ ok: true, wordCount: MIN_WORDS + 5 });
  });
});

describe("canEvaluate", () => {
  const base = { configured: true, tier: "premium" as const, lifetimeCompleted: 0, todayCompleted: 0 };
  it("blocks when not configured", () => {
    expect(canEvaluate({ ...base, configured: false })).toEqual({ allowed: false, reason: "not_configured" });
  });
  it("gives Basic one lifetime teaser, then blocks for upgrade", () => {
    expect(canEvaluate({ ...base, tier: "basic", lifetimeCompleted: 0 })).toEqual({ allowed: true });
    expect(canEvaluate({ ...base, tier: "basic", lifetimeCompleted: 1 })).toEqual({ allowed: false, reason: "preview_used" });
  });
  it("lets Premium in regardless of lifetime, capped per day", () => {
    expect(canEvaluate({ ...base, tier: "premium", lifetimeCompleted: 99 })).toEqual({ allowed: true });
    expect(canEvaluate({ ...base, tier: "premium", todayCompleted: WRITING_DAILY_CAP_PREMIUM })).toEqual({ allowed: false, reason: "daily_cap" });
  });
  it("gives Ultra a higher daily cap than Premium", () => {
    // at Premium's cap Ultra is still allowed — proves the cap is tier-differentiated
    expect(canEvaluate({ ...base, tier: "ultra", todayCompleted: WRITING_DAILY_CAP_PREMIUM })).toEqual({ allowed: true });
    expect(canEvaluate({ ...base, tier: "ultra", todayCompleted: WRITING_DAILY_CAP_ULTRA })).toEqual({ allowed: false, reason: "daily_cap" });
  });
});

describe("isStuck", () => {
  it("true past, false within the window", () => {
    const at = new Date("2026-06-25T12:00:00Z");
    expect(isStuck(at, new Date("2026-06-25T12:10:00Z"), WRITING_STALE_MS)).toBe(true);
    expect(isStuck(at, new Date("2026-06-25T12:01:00Z"), WRITING_STALE_MS)).toBe(false);
  });
});
