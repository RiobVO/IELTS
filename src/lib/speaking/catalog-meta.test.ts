import { describe, it, expect } from "vitest";
import { coerceDifficulty, detectCategory, isOnTarget } from "./catalog-meta";

describe("detectCategory", () => {
  // Subject lives in the head clause; the bucket follows the noun after "Describe a/an".
  it.each([
    ["Describe a person who has influenced you.", "person"],
    ["Describe someone you admire.", "person"],
    ["Describe a teacher you remember well.", "person"],
    ["Describe a place you would like to visit.", "place"],
    ["Describe a city you have visited.", "place"],
    ["Describe your favourite restaurant.", "place"],
    ["Describe a book you recently read.", "media"],
    ["Describe a song you like.", "media"],
    ["Describe a website or app you use often.", "media"],
    ["Describe a piece of clothing you enjoy wearing.", "object"],
    ["Describe a possession that is important to you.", "object"],
    ["Describe a hobby you enjoy.", "activity"],
    ["Describe a skill you want to learn.", "activity"],
    ["Describe an important decision you made.", "event"],
  ] as const)("classifies %j as %s", (prompt, want) => {
    expect(detectCategory(prompt)).toBe(want);
  });

  it("matches the subject in the head, not a trailing clause (object, not person)", () => {
    // "…you gave to someone" must not hijack the bucket to Person.
    expect(detectCategory("Describe a gift you gave to someone.")).toBe("object");
  });

  it("falls back to event when the head names no concrete subject", () => {
    expect(detectCategory("Describe a time when you helped someone.")).toBe("event");
  });
});

describe("coerceDifficulty", () => {
  it.each([
    ["1", 1],
    ["2", 2],
    ["3", 3],
    [2, 2],
  ] as const)("narrows %j to %j", (input, want) => {
    expect(coerceDifficulty(input)).toBe(want);
  });

  it.each(["", "0", "4", "x", null, undefined] as const)("rejects %j to null", (input) => {
    expect(coerceDifficulty(input)).toBeNull();
  });
});

describe("isOnTarget", () => {
  it("matches a target band inside the level's implied window", () => {
    expect(isOnTarget(1, 5.5)).toBe(true); // Foundation 5.0–6.0
    expect(isOnTarget(2, 6.5)).toBe(true); // Core 6.0–7.0
    expect(isOnTarget(3, 8.0)).toBe(true); // Stretch 7.0–8.5
  });
  it("rejects a target band outside the window", () => {
    expect(isOnTarget(1, 7.0)).toBe(false);
    expect(isOnTarget(3, 6.0)).toBe(false);
  });
  it("includes the boundary band 7.0 in both Core and Stretch", () => {
    expect(isOnTarget(2, 7.0)).toBe(true);
    expect(isOnTarget(3, 7.0)).toBe(true);
  });
});
