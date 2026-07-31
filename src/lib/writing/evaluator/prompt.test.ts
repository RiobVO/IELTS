import { describe, it, expect } from "vitest";
import { buildPrompt, PROMPT_VERSION } from "./prompt";

describe("buildPrompt", () => {
  const input = { essay: "My essay text.", taskPrompt: "Some agree...", category: "academic" as const };
  it("embeds the essay and task in delimited blocks", () => {
    const p = buildPrompt(input);
    expect(p).toContain("My essay text.");
    expect(p).toContain("Some agree...");
  });
  it("names all four IELTS Task 2 criteria", () => {
    const p = buildPrompt(input);
    for (const c of ["Task Response", "Coherence", "Lexical", "Grammat"]) expect(p).toContain(c);
  });
  it("instructs a band RANGE, not a single score", () => {
    expect(buildPrompt(input).toLowerCase()).toContain("range");
  });
  it("instructs annotation type and the original thesis", () => {
    const p = buildPrompt(input);
    expect(p).toMatch(/good.*style.*grammar/is);
    expect(p.toLowerCase()).toContain("original thesis");
  });
  it("has a stable version", () => {
    expect(PROMPT_VERSION).toBe("writing-task2-v1");
  });
});
