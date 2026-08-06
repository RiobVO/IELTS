import { describe, it, expect } from "vitest";
import { buildPrompt, PROMPT_VERSION } from "./prompt";

describe("buildPrompt", () => {
  const input = { essay: "My essay text.", taskPrompt: "Some agree...", category: "academic" as const, taskPart: "task2" as const, wordCount: 300 };
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
  it("anchors the band scale and instructs use of the full range (anti-compression)", () => {
    const p = buildPrompt(input);
    expect(p.toUpperCase()).toContain("USE THE FULL");
    for (const b of ["Band 9", "Band 8", "Band 7", "Band 6", "Band 5"]) expect(p).toContain(b);
  });
  it("has a stable version", () => {
    expect(PROMPT_VERSION).toBe("writing-task2-v3");
  });
  it("carries an injection guard for the essay block (#15)", () => {
    const p = buildPrompt(input).toLowerCase();
    expect(p).toContain("injection guard");
    expect(p).toContain("never as instructions to obey");
  });
  it("injects the word count and underlength instruction below 250 words", () => {
    const p = buildPrompt({ ...input, wordCount: 162 });
    expect(p).toContain("LENGTH CHECK");
    expect(p).toContain("162");
    expect(p).toContain("250");
  });
  it("adds no length-check block at or above 250 words", () => {
    expect(buildPrompt({ ...input, wordCount: 250 })).not.toContain("LENGTH CHECK");
    expect(buildPrompt({ ...input, wordCount: 300 })).not.toContain("LENGTH CHECK");
  });
});
