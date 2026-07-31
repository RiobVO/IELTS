import { describe, it, expect } from "vitest";
import { wordCount, wordCountState, RING_CIRC } from "./word-count";

describe("wordCount", () => {
  it("counts whitespace-split tokens, 0 for empty", () => {
    expect(wordCount("")).toBe(0);
    expect(wordCount("   ")).toBe(0);
    expect(wordCount("one two   three")).toBe(3);
  });
});

describe("wordCountState", () => {
  it("empty → muted, 'Start writing', not submittable", () => {
    const s = wordCountState(0);
    expect(s.message).toBe("Start writing");
    expect(s.color).toBe("var(--text-muted)");
    expect(s.canSubmit).toBe(false);
    expect(s.pct).toBe(0);
  });
  it("too few → 'N more to reach the minimum'", () => {
    expect(wordCountState(12).message).toBe("8 more to reach the minimum");
    expect(wordCountState(12).canSubmit).toBe(false);
  });
  it("ok → success, 'Ready to submit', submittable", () => {
    const s = wordCountState(250);
    expect(s.message).toBe("Ready to submit");
    expect(s.color).toBe("var(--success-text)");
    expect(s.canSubmit).toBe(true);
    expect(s.pct).toBe(1);
  });
  it("over max → error, 'N over the maximum — trim to submit'", () => {
    const s = wordCountState(1001);
    expect(s.message).toBe("1 over the maximum — trim to submit");
    expect(s.color).toBe("var(--error-text)");
    expect(s.canSubmit).toBe(false);
  });
  it("fill = min(n/250,1), offset = circ*(1-pct)", () => {
    expect(wordCountState(125).pct).toBeCloseTo(0.5, 5);
    expect(wordCountState(125).offset).toBeCloseTo(RING_CIRC * 0.5, 3);
  });
});
