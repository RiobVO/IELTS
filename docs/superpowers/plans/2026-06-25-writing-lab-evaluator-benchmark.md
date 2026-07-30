# Writing Lab — Evaluator + Benchmark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the provider-agnostic essay evaluator (Gemini Flash adapter behind a thin `Evaluator` interface), the strict Zod feedback contract, the rubric prompt, and the offline benchmark script — the engine that turns a Task 2 essay into a structured band-range feedback snapshot. Per spec `docs/superpowers/specs/2026-06-25-writing-lab-design.md`.

**Architecture:** One thin `Evaluator.evaluate()` interface, single Gemini implementation for MVP (no fallback). Zod is the single source of truth for the feedback shape — used both to derive Gemini's `responseSchema` AND to validate `response.text`. The benchmark is an offline script that runs the evaluator over a human-labeled calibration set (supplied separately, NOT committed — copyright) and reports band-accuracy / cost / latency / schema-validity. Tests use a mocked `@google/genai`, never a live API call.

**Tech Stack:** `@google/genai` (Gemini SDK, `ai.models.generateContent` with `config.responseMimeType` + `responseSchema`, output `response.text`), `zod` (v4, feedback schema + `z.toJSONSchema`), vitest, tsx (benchmark script).

**Scope:** Engine + benchmark mechanics only — no DB writes, no route, no UI (Plan 3). Writing Lab stays **disabled** in product until the benchmark passes on a real human-labeled set (ops-gate, below). Tests run fully mocked, so this plan is unblocked by the missing calibration set.

**Invariant:** all new code lives under `src/lib/writing/` + `scripts/`. Reading/Listening grading/import untouched and LLM-free. `@google/genai`/`zod` imported only in the writing layer.

**⚠️ Verify-at-implementation (external SDK, outside training cutoff — confirm live, do not assume):**
- Exact shape `z.toJSONSchema()` (zod v4) emits vs what Gemini `responseSchema` accepts (Gemini schema is an OpenAPI-subset; nested/union constructs may need a hand-written JSON Schema). If incompatible, hand-author the JSON Schema in `types.ts` and keep Zod for validation only.
- Token-usage field names on the `generateContent` response (for cost metrics) — read the actual response object.
- Default model id is resolved by the benchmark, not assumed.

---

## Ops-gate (NOT a code task — blocks product enable, not this plan)

Before Writing Lab is enabled for users, run the benchmark on a **real human-labeled calibration set** (expert-graded own essays; Cambridge samples only as an external sanity reference with legal access — never committed as a fixture). Outcome fills `WRITING_EVAL_MODEL` after a candidate passes the ±0.5 internal accuracy gate. This plan builds the mechanism; the run happens when the set + `GEMINI_API_KEY` exist.

---

## File Structure

- Create: `src/lib/writing/evaluator/types.ts` — Zod `FeedbackSchema`, derived `feedbackResponseSchema` (for Gemini), `EvaluateInput`/`EvaluateResult`/`Evaluator` types.
- Create: `src/lib/writing/evaluator/prompt.ts` — `PROMPT_VERSION` + `buildPrompt(input)` (4-criteria Task 2 rubric).
- Create: `src/lib/writing/evaluator/gemini.ts` — Gemini adapter (`generateContent` → parse → Zod-validate).
- Create: `src/lib/writing/evaluator/index.ts` — `getEvaluator()` factory (single Gemini, MVP).
- Create: `scripts/benchmark-writing.ts` — offline runner over a calibration-set JSON.
- Create tests: `types.test.ts`, `prompt.test.ts`, `gemini.test.ts`, `benchmark.test.ts` (same dir / mocked SDK).
- Modify: `src/env.ts` — add optional `GEMINI_API_KEY`, `WRITING_EVAL_MODEL`.
- Modify: `package.json` — add `@google/genai`, `zod`.

**Naming (locked — used across tasks):** `FeedbackSchema`, `feedbackResponseSchema`, `EvaluateInput { essay: string; taskPrompt: string; category: "academic" | "general" }`, `EvaluateResult { feedback: Feedback; raw: string; provider: string; model: string; promptVersion: string }`, `Evaluator { evaluate(input): Promise<EvaluateResult> }`, `PROMPT_VERSION = "writing-task2-v1"`.

---

## Task 1: Dependencies + env seam

**Files:**
- Modify: `package.json`
- Modify: `src/env.ts`

- [ ] **Step 1: Install deps**

Run: `npm i @google/genai zod`
Expected: both added to `dependencies`; lockfile updated.

- [ ] **Step 2: Add optional env vars**

In `src/env.ts`, add to the server-side schema (follow the existing validation style — these are OPTIONAL so the app boots without them; Writing Lab is simply disabled until set, mirroring the anti-bot fail-open seam):

```ts
// Writing Lab (Phase 3) — optional until the evaluator benchmark is passed and
// a model is chosen. Absent → Writing Lab evaluation is disabled (no crash).
GEMINI_API_KEY: z.string().optional(),
WRITING_EVAL_MODEL: z.string().optional(),
```

Add both to `.env.example` with empty placeholders and a one-line comment.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/env.ts .env.example
git commit -m "feat(writing): add Gemini SDK + zod deps and optional eval env seam"
```

---

## Task 2: Zod feedback contract + derived response schema

**Files:**
- Create: `src/lib/writing/evaluator/types.ts`
- Test: `src/lib/writing/evaluator/types.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { FeedbackSchema } from "./types";

const valid = {
  bandLow: 6.0,
  bandHigh: 6.5,
  confidence: "medium",
  criteria: [
    { name: "task_response", bandLow: 6.0, bandHigh: 6.5, strength: "clear position", mainIssue: "thin examples", nextStep: "develop one example fully" },
    { name: "coherence_cohesion", bandLow: 6.0, bandHigh: 6.5, strength: "logical paragraphs", mainIssue: "weak linking", nextStep: "vary cohesive devices" },
    { name: "lexical_resource", bandLow: 5.5, bandHigh: 6.0, strength: "topic vocab", mainIssue: "repetition", nextStep: "replace repeated words" },
    { name: "grammar_accuracy", bandLow: 6.0, bandHigh: 6.5, strength: "mixed structures", mainIssue: "article slips", nextStep: "proofread articles" },
  ],
  topFixes: ["clarify thesis", "add specific example", "reduce repeated vocabulary"],
  annotations: [{ quote: "Many people think...", comment: "too general — be specific" }],
  rewrite: { thesis: "Improved thesis sentence.", paragraph: "One rewritten body paragraph.", replacements: [{ from: "good", to: "beneficial" }] },
  checklist: ["clear position", "two developed ideas", "paragraph links", "fewer grammar slips"],
};

describe("FeedbackSchema", () => {
  it("accepts a well-formed feedback object", () => {
    expect(FeedbackSchema.parse(valid)).toMatchObject({ bandLow: 6.0, confidence: "medium" });
  });
  it("rejects an out-of-range band", () => {
    expect(() => FeedbackSchema.parse({ ...valid, bandHigh: 12 })).toThrow();
  });
  it("rejects an unknown confidence", () => {
    expect(() => FeedbackSchema.parse({ ...valid, confidence: "certain" })).toThrow();
  });
  it("requires exactly 4 criteria", () => {
    expect(() => FeedbackSchema.parse({ ...valid, criteria: valid.criteria.slice(0, 3) })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/writing/evaluator/types.test.ts`
Expected: FAIL — `./types` not found.

- [ ] **Step 3: Write `types.ts`**

```ts
import { z } from "zod";

// Band 0–9 in 0.5 steps; we store a range, not a point (spec: estimate, not authoritative).
const band = z.number().min(0).max(9);

const CriterionSchema = z.object({
  name: z.enum(["task_response", "coherence_cohesion", "lexical_resource", "grammar_accuracy"]),
  bandLow: band,
  bandHigh: band,
  strength: z.string().min(1),
  mainIssue: z.string().min(1),
  nextStep: z.string().min(1),
});

export const FeedbackSchema = z.object({
  bandLow: band,
  bandHigh: band,
  confidence: z.enum(["low", "medium", "high"]),
  criteria: z.array(CriterionSchema).length(4),
  topFixes: z.array(z.string().min(1)).min(1).max(3),
  annotations: z.array(z.object({ quote: z.string(), comment: z.string() })),
  rewrite: z.object({
    thesis: z.string(),
    paragraph: z.string(),
    replacements: z.array(z.object({ from: z.string(), to: z.string() })),
  }),
  checklist: z.array(z.string().min(1)),
});

export type Feedback = z.infer<typeof FeedbackSchema>;

// Gemini responseSchema (OpenAPI-subset). VERIFY at implementation: confirm
// z.toJSONSchema output is accepted by @google/genai responseSchema; if a nested
// construct is rejected, hand-author the equivalent JSON Schema here and keep
// FeedbackSchema for validation only.
export const feedbackResponseSchema = z.toJSONSchema(FeedbackSchema);

export interface EvaluateInput {
  essay: string;
  taskPrompt: string;
  category: "academic" | "general";
}
export interface EvaluateResult {
  feedback: Feedback;
  raw: string;
  provider: string;
  model: string;
  promptVersion: string;
}
export interface Evaluator {
  evaluate(input: EvaluateInput): Promise<EvaluateResult>;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/writing/evaluator/types.test.ts`
Expected: PASS (4 tests). If `z.toJSONSchema` is unavailable in the installed zod version, that surfaces here — resolve per the verify-note before continuing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/writing/evaluator/types.ts src/lib/writing/evaluator/types.test.ts
git commit -m "feat(writing): zod feedback contract + derived response schema"
```

---

## Task 3: Rubric prompt + version

**Files:**
- Create: `src/lib/writing/evaluator/prompt.ts`
- Test: `src/lib/writing/evaluator/prompt.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
  it("has a stable version", () => {
    expect(PROMPT_VERSION).toBe("writing-task2-v1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/writing/evaluator/prompt.test.ts`
Expected: FAIL — `./prompt` not found.

- [ ] **Step 3: Write `prompt.ts`**

```ts
import type { EvaluateInput } from "./types";

export const PROMPT_VERSION = "writing-task2-v1";

// Rubric-anchored prompt for IELTS Writing Task 2. Returns a band RANGE + confidence
// + per-criterion verdicts tied to the essay, top-3 fixes, inline annotations, a
// PARTIAL rewrite (not the whole essay), and a next-attempt checklist. The model is
// an estimating coach, NOT an authoritative examiner (spec non-goals).
export function buildPrompt({ essay, taskPrompt, category }: EvaluateInput): string {
  return [
    "You are an IELTS Writing coach. Assess the candidate's Task 2 essay against the",
    "four official band descriptors. You are NOT issuing an official score — give an",
    "ESTIMATED band RANGE (e.g. 6.0–6.5) with a confidence level, then actionable coaching.",
    "",
    `Test type: ${category === "academic" ? "Academic" : "General Training"} Task 2.`,
    "",
    "Score each criterion as a band range with one strength, one main issue, and one",
    "concrete next step:",
    "- task_response (Task Response): position, development, relevance.",
    "- coherence_cohesion (Coherence and Cohesion): organisation, paragraphing, linking.",
    "- lexical_resource (Lexical Resource): range, precision, repetition.",
    "- grammar_accuracy (Grammatical Range and Accuracy): structures, error density.",
    "",
    "Then: overall band range + confidence (low|medium|high), top 3 fixes (most",
    "impactful first), short inline annotations quoting the essay, a PARTIAL rewrite",
    "(improved thesis + one rewritten paragraph + weak-phrase replacements — do NOT",
    "rewrite the whole essay), and a next-attempt checklist.",
    "",
    "If the essay is too short or off-topic to judge, set confidence='low' and say so",
    "in the criteria notes rather than inventing a score.",
    "",
    "<task_prompt>",
    taskPrompt,
    "</task_prompt>",
    "",
    "<essay>",
    essay,
    "</essay>",
  ].join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/writing/evaluator/prompt.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/writing/evaluator/prompt.ts src/lib/writing/evaluator/prompt.test.ts
git commit -m "feat(writing): rubric prompt for Task 2 evaluation (v1)"
```

---

## Task 4: Gemini adapter (mocked SDK in tests)

**Files:**
- Create: `src/lib/writing/evaluator/gemini.ts`
- Test: `src/lib/writing/evaluator/gemini.test.ts`

- [ ] **Step 1: Write the failing test (mock `@google/genai`)**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const generateContent = vi.fn();
vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn(() => ({ models: { generateContent } })),
}));
vi.mock("@/env", () => ({ env: { GEMINI_API_KEY: "test-key", WRITING_EVAL_MODEL: "gemini-2.5-flash-lite" } }));

import { evaluateWithGemini } from "./gemini";

const validFeedback = {
  bandLow: 6.0, bandHigh: 6.5, confidence: "medium",
  criteria: [
    { name: "task_response", bandLow: 6, bandHigh: 6.5, strength: "a", mainIssue: "b", nextStep: "c" },
    { name: "coherence_cohesion", bandLow: 6, bandHigh: 6.5, strength: "a", mainIssue: "b", nextStep: "c" },
    { name: "lexical_resource", bandLow: 5.5, bandHigh: 6, strength: "a", mainIssue: "b", nextStep: "c" },
    { name: "grammar_accuracy", bandLow: 6, bandHigh: 6.5, strength: "a", mainIssue: "b", nextStep: "c" },
  ],
  topFixes: ["x"], annotations: [], rewrite: { thesis: "t", paragraph: "p", replacements: [] }, checklist: ["x"],
};
const input = { essay: "e", taskPrompt: "t", category: "academic" as const };

beforeEach(() => generateContent.mockReset());

describe("evaluateWithGemini", () => {
  it("returns validated feedback + metadata on a valid response", async () => {
    generateContent.mockResolvedValue({ text: JSON.stringify(validFeedback) });
    const r = await evaluateWithGemini(input);
    expect(r.feedback.bandLow).toBe(6.0);
    expect(r.provider).toBe("gemini");
    expect(r.model).toBe("gemini-2.5-flash-lite");
    expect(r.raw).toContain("bandLow");
  });
  it("throws on a schema-invalid response (caller retries/fails)", async () => {
    generateContent.mockResolvedValue({ text: JSON.stringify({ ...validFeedback, confidence: "certain" }) });
    await expect(evaluateWithGemini(input)).rejects.toThrow();
  });
  it("throws when the model returns non-JSON", async () => {
    generateContent.mockResolvedValue({ text: "I cannot help with that." });
    await expect(evaluateWithGemini(input)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/writing/evaluator/gemini.test.ts`
Expected: FAIL — `./gemini` not found.

- [ ] **Step 3: Write `gemini.ts`**

```ts
import { GoogleGenAI } from "@google/genai";
import { env } from "@/env";
import { buildPrompt, PROMPT_VERSION } from "./prompt";
import { FeedbackSchema, feedbackResponseSchema, type EvaluateInput, type EvaluateResult } from "./types";

// Single Gemini call → JSON → Zod-validate. Throws on transport error, non-JSON,
// or schema mismatch; the caller (route, Plan 3) maps that to a failed submission.
// VERIFY at implementation: token-usage field on the response for cost metrics.
export async function evaluateWithGemini(input: EvaluateInput): Promise<EvaluateResult> {
  const apiKey = env.GEMINI_API_KEY;
  const model = env.WRITING_EVAL_MODEL;
  if (!apiKey || !model) throw new Error("Writing evaluator not configured (GEMINI_API_KEY / WRITING_EVAL_MODEL)");

  const ai = new GoogleGenAI({ apiKey });
  const res = await ai.models.generateContent({
    model,
    contents: buildPrompt(input),
    config: { responseMimeType: "application/json", responseSchema: feedbackResponseSchema },
  });

  const raw = res.text ?? "";
  const feedback = FeedbackSchema.parse(JSON.parse(raw)); // throws → caller handles
  return { feedback, raw, provider: "gemini", model, promptVersion: PROMPT_VERSION };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/writing/evaluator/gemini.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/writing/evaluator/gemini.ts src/lib/writing/evaluator/gemini.test.ts
git commit -m "feat(writing): Gemini adapter — generateContent + zod validation"
```

---

## Task 5: Evaluator factory (thin interface)

**Files:**
- Create: `src/lib/writing/evaluator/index.ts`
- Test: `src/lib/writing/evaluator/index.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from "vitest";
vi.mock("./gemini", () => ({ evaluateWithGemini: vi.fn(async () => ({ provider: "gemini", model: "m", raw: "{}", promptVersion: "writing-task2-v1", feedback: {} })) }));
import { getEvaluator } from "./index";

describe("getEvaluator", () => {
  it("returns an evaluator whose evaluate() delegates to the Gemini adapter", async () => {
    const r = await getEvaluator().evaluate({ essay: "e", taskPrompt: "t", category: "general" });
    expect(r.provider).toBe("gemini");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/writing/evaluator/index.test.ts`
Expected: FAIL — `./index` (getEvaluator) not found.

- [ ] **Step 3: Write `index.ts`**

```ts
import { evaluateWithGemini } from "./gemini";
import type { Evaluator } from "./types";

export type { Evaluator, EvaluateInput, EvaluateResult, Feedback } from "./types";

// MVP: a single provider (Gemini). The factory is the only thing Plan 3 imports —
// adding a second provider or a fallback later changes ONLY this file, never callers.
const geminiEvaluator: Evaluator = { evaluate: evaluateWithGemini };

export function getEvaluator(): Evaluator {
  return geminiEvaluator;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/writing/evaluator/index.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/writing/evaluator/index.ts src/lib/writing/evaluator/index.test.ts
git commit -m "feat(writing): evaluator factory (thin single-provider interface)"
```

---

## Task 6: Benchmark script + metrics

**Files:**
- Create: `scripts/benchmark-writing.ts`
- Test: `scripts/benchmark-writing.test.ts`

The script reads a calibration-set JSON (path via argv; NOT committed — expert-graded essays live outside the repo, e.g. a gitignored `data/` path), runs the evaluator on each, and reports per-candidate band-accuracy / cost / latency / schema-validity. Metrics are pure functions so they're testable without a live API.

- [ ] **Step 1: Write the failing test (pure metrics on mock data)**

```ts
import { describe, it, expect } from "vitest";
import { withinHalfBand, bandMid, accuracy } from "./benchmark-writing";

describe("benchmark metrics", () => {
  it("bandMid averages the range", () => {
    expect(bandMid({ bandLow: 6.0, bandHigh: 6.5 })).toBe(6.25);
  });
  it("withinHalfBand true when |mid - truth| <= 0.5", () => {
    expect(withinHalfBand(6.25, 6.5)).toBe(true);
    expect(withinHalfBand(6.25, 7.0)).toBe(false);
  });
  it("accuracy is the share within ±0.5", () => {
    expect(accuracy([{ predMid: 6.0, truth: 6.0 }, { predMid: 6.0, truth: 7.0 }])).toBe(0.5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/benchmark-writing.test.ts`
Expected: FAIL — exports not found.

- [ ] **Step 3: Write `benchmark-writing.ts`**

```ts
import { readFile } from "node:fs/promises";
import { getEvaluator } from "@/lib/writing/evaluator";

// Calibration entry: a prompt + essay + human-assigned overall band (ground truth).
interface CalibrationEntry {
  taskPrompt: string;
  essay: string;
  category: "academic" | "general";
  trueBand: number;
}

export function bandMid(r: { bandLow: number; bandHigh: number }): number {
  return (r.bandLow + r.bandHigh) / 2;
}
export function withinHalfBand(predMid: number, truth: number): boolean {
  return Math.abs(predMid - truth) <= 0.5;
}
export function accuracy(rows: { predMid: number; truth: number }[]): number {
  if (rows.length === 0) return 0;
  return rows.filter((r) => withinHalfBand(r.predMid, r.truth)).length / rows.length;
}

// Runner: only executed manually with a real set + key (ops-gate). Tests cover the
// pure metrics above; this main() is not part of the test path.
async function main() {
  const path = process.argv[2];
  if (!path) throw new Error("usage: tsx scripts/benchmark-writing.ts <calibration.json>");
  const set: CalibrationEntry[] = JSON.parse(await readFile(path, "utf8"));
  const evaluator = getEvaluator();

  const rows: { predMid: number; truth: number }[] = [];
  let schemaOk = 0;
  for (const e of set) {
    try {
      const r = await evaluator.evaluate({ essay: e.essay, taskPrompt: e.taskPrompt, category: e.category });
      schemaOk++;
      rows.push({ predMid: bandMid(r.feedback), truth: e.trueBand });
    } catch (err) {
      console.error("eval failed for one entry:", err);
    }
  }
  console.log(`schema-valid: ${schemaOk}/${set.length}`);
  console.log(`band-accuracy (±0.5): ${(accuracy(rows) * 100).toFixed(1)}%`);
  console.log("ACCEPTANCE: candidate passes only if band-accuracy ≥ target on this set (spec gate).");
}

// Run only when invoked directly (tsx), never on import (keeps tests clean).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/benchmark-writing.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/benchmark-writing.ts scripts/benchmark-writing.test.ts
git commit -m "feat(writing): offline benchmark script + band-accuracy metrics"
```

---

## Task 7: Full gate + docs note

**Files:**
- Modify: `SCHEMA_NOTES.md` (or `docs/` — wherever Phase 3 notes belong)

- [ ] **Step 1: Document the calibration-set contract + ops-gate**

Add a short "Phase 3 Writing — evaluator" note: the calibration-set JSON shape (`{ taskPrompt, essay, category, trueBand }[]`), that it is NOT committed (copyright — expert-graded own essays, Cambridge only as external reference), that `WRITING_EVAL_MODEL` is filled only after a candidate passes the ±0.5 band-accuracy gate, and that Writing Lab stays disabled in product until then.

- [ ] **Step 2: Run the full suite + typecheck**

Run: `npx vitest run`
Expected: PASS — all evaluator + benchmark tests green, existing suite unaffected.

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add SCHEMA_NOTES.md
git commit -m "docs(writing): calibration-set contract + evaluator ops-gate"
```

---

## Self-Review (done by plan author)

- **Spec coverage:** provider strategy (single Gemini, thin interface, no fallback) → Tasks 4-5; structured JSON via responseSchema + Zod validation → Tasks 2,4; rubric/range/confidence → Tasks 2-3; benchmark + ±0.5 internal gate → Task 6; deps/env → Task 1; calibration-set ground-truth (human-labeled, not committed) → ops-gate + Task 7. ✅
- **Out of scope (Plan 3):** DB writes (`writing_submission`/`feedback`/`debug`), idempotent route, server actions, reaper, gates, UX. The evaluator returns `raw` + `feedback` + metadata; Plan 3 persists them. ✅
- **Type consistency:** `Evaluator`/`EvaluateInput`/`EvaluateResult`/`Feedback` defined in `types.ts` (Task 2) and imported unchanged in `gemini.ts` (4), `index.ts` (5); `PROMPT_VERSION` defined in `prompt.ts` (3), used in `gemini.ts` (4). ✅
- **Honesty (external SDK):** every place the live `@google/genai`/`zod` API is not cutoff-certain is flagged "VERIFY at implementation" (z.toJSONSchema↔responseSchema shape, token-usage field) — not silently assumed. ✅
- **No placeholders:** real code/tests in every step; the only file NOT shown is the calibration set itself (intentionally — it's external data, not code). ✅
