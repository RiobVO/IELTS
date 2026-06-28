import { describe, it, expect } from "vitest";
import { SPEAKING_MIN_TIER, SPEAKING_PREVIEW_LIMIT, meetsTier } from "./tiers";

describe("Speaking tier gate", () => {
  it("Speaking is Ultra-only", () => {
    expect(SPEAKING_MIN_TIER).toBe("ultra");
    expect(meetsTier("ultra", SPEAKING_MIN_TIER)).toBe(true);
    expect(meetsTier("premium", SPEAKING_MIN_TIER)).toBe(false);
    expect(meetsTier("basic", SPEAKING_MIN_TIER)).toBe(false);
  });

  it("grants exactly one lifetime free preview", () => {
    expect(SPEAKING_PREVIEW_LIMIT).toBe(1);
  });
});
