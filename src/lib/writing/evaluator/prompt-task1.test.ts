import { describe, it, expect } from "vitest";
import { buildTask1Prompt, TASK1_PROMPT_VERSION } from "./prompt-task1";

const base = {
  essay: "The chart shows a clear upward trend.",
  taskPrompt: "The line graph below shows coffee consumption.",
  category: "academic" as const,
  taskPart: "task1" as const,
  wordCount: 180,
};

describe("buildTask1Prompt", () => {
  it("embeds the task prompt and essay in delimited blocks", () => {
    const p = buildTask1Prompt(base);
    expect(p).toContain("The line graph below shows coffee consumption.");
    expect(p).toContain("The chart shows a clear upward trend.");
    expect(p).toContain("<task_prompt>");
    expect(p).toContain("<essay>");
  });

  it("frames the first criterion as TASK ACHIEVEMENT keyed to task_response", () => {
    const p = buildTask1Prompt(base);
    expect(p).toContain("TASK ACHIEVEMENT");
    expect(p).toContain('"task_response"');
  });

  it("names all four criteria and instructs comparing the essay to the visual", () => {
    const p = buildTask1Prompt(base);
    for (const c of ["Task Achievement", "Coherence", "Lexical", "Grammat"]) expect(p).toContain(c);
    expect(p.toLowerCase()).toContain("visual");
  });

  it("anchors the band scale and instructs use of the full range (anti-compression)", () => {
    const p = buildTask1Prompt(base);
    expect(p.toUpperCase()).toContain("USE THE FULL SCALE");
    for (const b of ["Band 9", "Band 8", "Band 7", "Band 6", "Band 5"]) expect(p).toContain(b);
  });

  it("instructs a band RANGE, annotation types and a PARTIAL rewrite", () => {
    const p = buildTask1Prompt(base);
    expect(p.toLowerCase()).toContain("range");
    expect(p).toMatch(/good.*style.*grammar/is);
    expect(p).toContain("PARTIAL rewrite");
  });

  it("carries the injection guard and the worked example", () => {
    const p = buildTask1Prompt(base);
    expect(p.toLowerCase()).toContain("injection guard");
    expect(p).toContain("Expected output");
  });

  it("appends the underlength note below 150 words, naming the count and the 150 floor", () => {
    const p = buildTask1Prompt({ ...base, wordCount: 120 });
    expect(p).toContain("120 words");
    expect(p).toContain("150-word minimum");
    expect(p).toContain("UNDER");
  });

  it("adds no underlength note at or above 150 words", () => {
    expect(buildTask1Prompt({ ...base, wordCount: 150 })).not.toContain("UNDER the 150-word minimum");
    expect(buildTask1Prompt({ ...base, wordCount: 220 })).not.toContain("UNDER the 150-word minimum");
  });

  it("forbids the model from counting words itself (length is a server fact)", () => {
    const p = buildTask1Prompt({ ...base, wordCount: 220 }).toLowerCase();
    expect(p).toContain("do not count or estimate the word count yourself");
  });

  it("inserts $-bearing essay text literally (function replacement, not a $-pattern)", () => {
    const tricky = "Costs rose by $5 and then $& doubled — see $1.";
    const p = buildTask1Prompt({ ...base, essay: tricky });
    expect(p).toContain(tricky);
  });

  it("has a stable version", () => {
    expect(TASK1_PROMPT_VERSION).toBe("writing-task1-v3");
  });
});
