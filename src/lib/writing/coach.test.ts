import { describe, it, expect } from "vitest";
import { nextNudge } from "./coach";
import { TASK2_MIN_WORDS } from "./lifecycle";

// Unique alphabetic tokens: digits are stripped by the metric, so generated words
// must stay distinct AFTER /[^a-z]/g — two-letter combos give 676 unique tokens.
const ALPHA = "abcdefghijklmnopqrstuvwxyz";
const uniq = (i: number) => ALPHA[Math.floor(i / 26) % 26] + ALPHA[i % 26];
const oneLine = (n: number) => Array.from({ length: n }, (_, i) => uniq(i)).join(" ");
const twoPara = (n: number) => {
  const arr = Array.from({ length: n }, (_, i) => uniq(i));
  const mid = Math.floor(n / 2);
  return arr.slice(0, mid).join(" ") + "\n\n" + arr.slice(mid).join(" ");
};

describe("nextNudge — state machine (first match wins)", () => {
  it("empty: 0 words → ✍️ Open strong, Task Response, purple", () => {
    const n = nextNudge("");
    expect(n.id).toBe("empty");
    expect(n.icon).toBe("✍️");
    expect(n.title).toBe("Open strong");
    expect(n.criterion).toBe("Task Response");
    expect(n.tone).toBe("purple");
  });

  it("empty: whitespace-only text does not throw and reads empty", () => {
    expect(nextNudge("   \n\t  ").id).toBe("empty");
  });

  it("build: words < 80 → 🧱 Build the body (79 words)", () => {
    const n = nextNudge(oneLine(79));
    expect(n.id).toBe("build");
    expect(n.icon).toBe("🧱");
    expect(n.criterion).toBe("Task Response");
    expect(n.tone).toBe("purple");
  });

  it("breakup: 80 words but paragraphs < 2 → ↵ Break it up, Coherence", () => {
    const n = nextNudge(oneLine(80));
    expect(n.id).toBe("breakup");
    expect(n.icon).toBe("↵");
    expect(n.criterion).toBe("Coherence");
    expect(n.tone).toBe("purple");
  });

  it("lexis: ≥80 words, ≥2 paragraphs, repeated vocab → 📚 Vary your words, Lexical", () => {
    const rep = Array.from({ length: 50 }, () => "aa").join(" ");
    const n = nextNudge(`${rep}\n\n${rep}`); // 100 words, uniqueRatio = 1/100
    expect(n.id).toBe("lexis");
    expect(n.criterion).toBe("Lexical");
    expect(n.tone).toBe("purple");
    expect(n.body).toBe("You’re repeating vocabulary. Swap common words for precise synonyms.");
  });

  it("almost: 249 words, varied vocab, ≥2 paragraphs → ⏳ Almost there, amber", () => {
    const n = nextNudge(twoPara(TASK2_MIN_WORDS - 1));
    expect(n.id).toBe("almost");
    expect(n.icon).toBe("⏳");
    expect(n.criterion).toBe("Task Response");
    expect(n.tone).toBe("amber");
    expect(n.body).toBe("Keep developing your examples — you’re closing in on the 250-word minimum.");
  });

  it("ready: 250 words, varied vocab, ≥2 paragraphs → 🎯 Strong draft, Grammar, green", () => {
    const n = nextNudge(twoPara(TASK2_MIN_WORDS));
    expect(n.id).toBe("ready");
    expect(n.icon).toBe("🎯");
    expect(n.criterion).toBe("Grammar");
    expect(n.tone).toBe("green");
  });

  it("ordering: 250 words in a single paragraph still resolves to breakup", () => {
    expect(nextNudge(oneLine(TASK2_MIN_WORDS)).id).toBe("breakup");
  });

  it("250-threshold is wired to TASK2_MIN_WORDS: 249 → almost, 250 → ready", () => {
    expect(nextNudge(twoPara(TASK2_MIN_WORDS - 1)).id).toBe("almost");
    expect(nextNudge(twoPara(TASK2_MIN_WORDS)).id).toBe("ready");
  });

  it("is deterministic: identical input yields a deep-equal nudge", () => {
    const t = twoPara(120);
    expect(nextNudge(t)).toEqual(nextNudge(t));
  });
});
