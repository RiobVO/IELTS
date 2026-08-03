import { describe, it, expect } from "vitest";
import { detectCategory } from "./catalog-meta";

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
