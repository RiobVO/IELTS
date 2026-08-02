import { describe, it, expect } from "vitest";
import { canEvaluate, isStuck, isUnderlength, MIN_TRANSCRIPT_WORDS } from "./lifecycle";

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
});
