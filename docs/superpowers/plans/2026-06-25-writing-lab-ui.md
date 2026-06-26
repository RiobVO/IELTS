# AI Writing Lab — UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recreate all 11 AI Writing Lab screens/states (Task 2) from the design handoff as bando React components, wired to the Plan 1–3 backend already on `main`.

**Architecture:** Server components do owner-path Drizzle reads (new `read.ts`/`admin.ts`, evaluator/route/`store.ts` untouched) and hand off to `"use client"` presentational components built on bando tokens. The async flow uses the existing `createWritingSubmission` + `getSubmissionStatus` poll. Feedback is a stable snapshot; the blocker/sort are derived deterministically from the criteria (no extra LLM fields).

**Tech Stack:** Next.js App Router, React, Drizzle (owner path), zod (`FeedbackSchema`), vitest (pure logic only). bando design system: `src/components/core/*`, `app/tokens/*`, `reveal.tsx`.

---

## Hard invariants (do not violate)

- **Do NOT rewrite** evaluator (`src/lib/writing/evaluator/*` logic), `app/api/writing/evaluate`, `src/lib/writing/store.ts`, `src/lib/writing/lifecycle.ts`, or the two existing actions. Only the contract extension touches `evaluator/types.ts` + `evaluator/prompt.ts` (+ their tests).
- R/L core (grading/import/answer_key) — zero contact.
- `writing_feedback_debug.raw_output` is server-only — never read into any UI path.
- Feedback read is **owner-scoped** (join `submission.user_id = auth.uid()` via Drizzle owner path, mirroring the reading result page).
- No DB schema/migration change: `type`/`thesisOld` live inside existing `jsonb` columns. Therefore `npm run verify` is **not** triggered by this work (no new table/column/RLS/grant). Gate = `npx tsc --noEmit` + `npm run build` + `npm test`.
- UI text English. Colors/radii/shadows via CSS variables — never hardcode hex.
- Feature `disabled`-safe: when `writingEvalConfig() === null`, `/app/writing/*` redirects to `/app/practice` and the Practice "Writing" card stays the existing "Soon"/locked-panel (coming-soon = handoff §10, already in prod).

## Token / icon fallbacks (confirmed by inventory)

- MISSING tokens `--success-border` / `--warn-border` / `--error-border` → use `--success-text` / `--warn-text` / `--error-text` for the 2px annotation accent and legend dots; subtle tints use the existing `--success-subtle` / `--warn-subtle` / `--error-subtle`.
- MISSING icon `alert-triangle` → add one Lucide path to `icons.tsx` (Task 3.1). `x-circle` → use existing `circle-x`. `sparkle` → use existing `sparkles`. `edit/pencil` → use `pen-line`.
- Annotation-type → token map (single source, used by legend, `<mark>`, comment cards):
  - `good` → accent `--success-text`, tint `--success-subtle`, label "GOOD MOVE"
  - `style` → accent `--warn-text`, tint `--warn-subtle`, label "STYLE"
  - `grammar` → accent `--error-text`, tint `--error-subtle`, label "GRAMMAR"

## Backend surface this UI consumes (already on `main`)

- `createWritingSubmission({ taskId, essay })` → `{ ok:true, submissionId }` | `{ ok:false, reason }` where reason ∈ `auth|too_short|too_long|not_configured|preview_used|daily_cap|in_progress`.
- `getSubmissionStatus(submissionId)` → `{ status: pending|evaluating|completed|failed } | null`.
- `writingEvalConfig()` (`@/env`) → `{apiKey, model} | null` — the feature-enabled flag (server only).
- Tables (`@/db/schema`): `writingTask` (category, prompt, tierRequired, status, createdBy, createdAt), `writingSubmission` (userId, taskId, essayText, wordCount, status, createdAt), `writingFeedback` (bandLow/bandHigh numeric strings, confidence, criteria/topFixes/annotations/rewrite/checklist jsonb, provider/model/promptVersion, createdAt). `writingFeedbackDebug` — never read.
- `Feedback` type (`evaluator/types.ts`) after Increment 0: criteria `{name, bandLow, bandHigh, strength, mainIssue, nextStep}` ×4; `annotations[] {quote, comment, type}`; `rewrite {thesisOld, thesis, paragraph, replacements[{from,to}]}`; `topFixes[1..3]`; `checklist[]`; `bandLow/bandHigh`; `confidence`.

## File structure

```
src/lib/writing/
  evaluator/types.ts          (MODIFY) annotation.type + rewrite.thesisOld
  evaluator/prompt.ts         (MODIFY) instruct type + thesisOld
  evaluator/types.test.ts     (MODIFY) accept/reject new fields
  evaluator/prompt.test.ts    (MODIFY) prompt mentions type + thesisOld
  labels.ts                   (CREATE) criterion/confidence/category display names
  word-count.ts               (CREATE) wordCount + wordCountState (ring)
  word-count.test.ts          (CREATE)
  feedback-view.ts            (CREATE) sort/blocker/axis/gap/pills (pure)
  feedback-view.test.ts       (CREATE)
  read.ts                     (CREATE) owner-path UI reads
  admin.ts                    (CREATE) admin create/publish writing_task

app/app/writing/
  page.tsx                    (CREATE) catalog (server)
  _Catalog.tsx                (CREATE) catalog body (client)
  attempt/[taskId]/page.tsx   (CREATE) attempt (server: load task)
  attempt/[taskId]/_Attempt.tsx (CREATE) write → async flow state machine (client)
  result/[id]/page.tsx        (CREATE) feedback (server: owner read)
  result/[id]/_FeedbackView.tsx (CREATE) feedback orchestrator (client)
  result/[id]/_feedback/BandHero.tsx       (CREATE)
  result/[id]/_feedback/TopFixes.tsx       (CREATE)
  result/[id]/_feedback/CriteriaPlot.tsx   (CREATE)
  result/[id]/_feedback/Annotations.tsx    (CREATE)
  result/[id]/_feedback/Rewrite.tsx        (CREATE)
  result/[id]/_feedback/Checklist.tsx      (CREATE)
  history/page.tsx            (CREATE) history (server-rendered rows)

app/admin/writing/
  page.tsx                    (CREATE) create-topic (server, requireAdmin)
  actions.ts                  (CREATE) createWritingTask / publishWritingTask
  _CreateTopicForm.tsx        (CREATE) form (client, two formAction buttons)

app/app/practice/
  page.tsx                    (MODIFY) pass writingEnabled
  _PracticeCatalog.tsx        (MODIFY) Writing card → Live + link when enabled

src/components/core/icons.tsx (MODIFY) add alert-triangle
```

---

## Increment 0 — Contract extension (evaluator schema + prompt)

### Task 0.1: Extend FeedbackSchema (annotation.type + rewrite.thesisOld)

**Files:**
- Modify: `src/lib/writing/evaluator/types.ts`
- Test: `src/lib/writing/evaluator/types.test.ts`

- [ ] **Step 1: Read the existing test** to match style, then add failing cases.

Add to `types.test.ts`:

```ts
it("requires annotation type in good|style|grammar", () => {
  const base = validFeedback();
  base.annotations = [{ quote: "x", comment: "y", type: "good" }];
  expect(FeedbackSchema.safeParse(base).success).toBe(true);
  base.annotations = [{ quote: "x", comment: "y" } as never];
  expect(FeedbackSchema.safeParse(base).success).toBe(false);
  base.annotations = [{ quote: "x", comment: "y", type: "bogus" } as never];
  expect(FeedbackSchema.safeParse(base).success).toBe(false);
});

it("requires rewrite.thesisOld and rewrite.thesis", () => {
  const base = validFeedback();
  delete (base.rewrite as Record<string, unknown>).thesisOld;
  expect(FeedbackSchema.safeParse(base).success).toBe(false);
});
```

If `validFeedback()` helper does not exist in the file, add one that returns a complete valid object (4 criteria, annotations with `type`, rewrite with `thesisOld` + `thesis`).

- [ ] **Step 2: Run test, verify it fails.** Run: `npm test -- src/lib/writing/evaluator/types.test.ts` → FAIL (type/thesisOld not yet in schema).

- [ ] **Step 3: Extend the schema.** In `types.ts`:

```ts
const AnnotationType = z.enum(["good", "style", "grammar"]);

// ...inside FeedbackSchema:
  annotations: z.array(
    z.object({ quote: z.string(), comment: z.string(), type: AnnotationType }),
  ),
  rewrite: z.object({
    thesisOld: z.string(), // the candidate's original thesis (shown struck as "YOURS")
    thesis: z.string(),    // the improved thesis (shown as "STRONGER")
    paragraph: z.string(),
    replacements: z.array(z.object({ from: z.string(), to: z.string() })),
  }),
```

- [ ] **Step 4: Run test, verify pass.** Run: `npm test -- src/lib/writing/evaluator/types.test.ts` → PASS.

- [ ] **Step 5: Commit.** (Defer all commits — user commits manually. Stage nothing yet; checkbox = "logical unit done".)

### Task 0.2: Teach the prompt to emit type + thesisOld

**Files:**
- Modify: `src/lib/writing/evaluator/prompt.ts`
- Test: `src/lib/writing/evaluator/prompt.test.ts`

- [ ] **Step 1: Add failing assertions** to `prompt.test.ts`:

```ts
it("instructs annotation type and original thesis", () => {
  const p = buildPrompt({ essay: "e", taskPrompt: "t", category: "academic" });
  expect(p).toMatch(/good.*style.*grammar/is); // annotation type vocabulary
  expect(p.toLowerCase()).toContain("original thesis"); // thesisOld guidance
});
```

- [ ] **Step 2: Run, verify fail.** Run: `npm test -- src/lib/writing/evaluator/prompt.test.ts` → FAIL.

- [ ] **Step 3: Edit `prompt.ts`.** In the annotations sentence add: each annotation carries a `type` of `good` (a good move to reinforce), `style` (style/clarity), or `grammar` (a grammar/accuracy issue). In the rewrite sentence add: include the candidate's **original thesis** (`thesisOld`) verbatim alongside the improved `thesis`. Keep wording terse, English.

- [ ] **Step 4: Run, verify pass.** Run: `npm test -- src/lib/writing/evaluator/prompt.test.ts` → PASS.

### Task 0.3: Repair existing fixtures broken by the stricter schema

**Files:** any test building a `Feedback`/feedback-shaped object.

- [ ] **Step 1:** Grep for fixtures: `rg -l "annotations" src/lib/writing app/app/writing` and inspect `evaluator/gemini.test.ts`, `evaluator/index.test.ts`, `app/app/writing/actions.test.ts`, `src/lib/writing/store.test.ts`.

- [ ] **Step 2:** In each fixture, give every annotation a `type` (default `"style"`) and give `rewrite` both `thesisOld` and `thesis`.

- [ ] **Step 3: Run full writing suite.** Run: `npm test -- src/lib/writing app/app/writing` → all PASS. Expected: previously-green tests pass again under the extended schema.

---

## Increment 1 — Pure UI logic (helpers + unit tests)

### Task 1.1: Word-count helper + ring state

**Files:**
- Create: `src/lib/writing/word-count.ts`
- Test: `src/lib/writing/word-count.test.ts`

Constants (from prototype): ring `r=44`, `stroke=9`, `circumference=2π·44`; fill reference `250`; `MIN_WORDS`/`MAX_WORDS` imported from `./lifecycle` (20 / 1000). State messages/colors verbatim:

- [ ] **Step 1: Write `word-count.test.ts`:**

```ts
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
```

- [ ] **Step 2: Run, verify fail.** Run: `npm test -- src/lib/writing/word-count.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `word-count.ts`:**

```ts
import { MIN_WORDS, MAX_WORDS } from "./lifecycle";

export const RING_R = 44;
export const RING_STROKE = 9;
export const RING_CIRC = 2 * Math.PI * RING_R;
const REF = 250; // words at which the ring reads full

/** Whitespace-split token count, mirroring validateEssay (server). 0 for blank. */
export function wordCount(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

export interface WordCountState {
  message: string;
  color: string;
  canSubmit: boolean;
  pct: number;
  offset: number;
}

export function wordCountState(n: number): WordCountState {
  const pct = Math.max(0, Math.min(1, n / REF));
  const offset = RING_CIRC * (1 - pct);
  if (n === 0) return { message: "Start writing", color: "var(--text-muted)", canSubmit: false, pct, offset };
  if (n < MIN_WORDS)
    return { message: `${MIN_WORDS - n} more to reach the minimum`, color: "var(--text-muted)", canSubmit: false, pct, offset };
  if (n > MAX_WORDS)
    return { message: `${n - MAX_WORDS} over the maximum — trim to submit`, color: "var(--error-text)", canSubmit: false, pct, offset };
  return { message: "Ready to submit", color: "var(--success-text)", canSubmit: true, pct, offset };
}
```

- [ ] **Step 4: Run, verify pass.** Run: `npm test -- src/lib/writing/word-count.test.ts` → PASS.

### Task 1.2: Feedback-view pure helpers (sort, blocker, axis, gap, pills)

**Files:**
- Create: `src/lib/writing/feedback-view.ts`
- Test: `src/lib/writing/feedback-view.test.ts`

- [ ] **Step 1: Write `feedback-view.test.ts`:**

```ts
import { describe, it, expect } from "vitest";
import { axisPct, gapToTarget, confidencePills, midpoint, sortWeakestFirst, blockerIndex } from "./feedback-view";

const crit = (name: string, lo: number, hi: number) => ({ name, bandLow: lo, bandHigh: hi, strength: "s", mainIssue: "m", nextStep: "n" });

describe("axisPct", () => {
  it("maps 4..9 → 0..100, clamps outside", () => {
    expect(axisPct(4)).toBe(0);
    expect(axisPct(9)).toBe(100);
    expect(axisPct(7)).toBe(60);
    expect(axisPct(3)).toBe(0);
    expect(axisPct(10)).toBe(100);
  });
});

describe("gapToTarget", () => {
  it("'+X to T' when below, 'at target' when reached", () => {
    expect(gapToTarget(6, 7)).toBe("+1 to 7.0");
    expect(gapToTarget(6.5, 7)).toBe("+0.5 to 7.0");
    expect(gapToTarget(7, 7)).toBe("at target");
    expect(gapToTarget(8, 7)).toBe("at target");
  });
});

describe("confidencePills", () => {
  it("low=1 medium=2 high=3", () => {
    expect(confidencePills("low")).toBe(1);
    expect(confidencePills("medium")).toBe(2);
    expect(confidencePills("high")).toBe(3);
  });
});

describe("sortWeakestFirst / blockerIndex", () => {
  const cs = [crit("a", 6, 6.5), crit("b", 5.5, 6), crit("c", 6, 6.5), crit("d", 6, 6.5)];
  it("midpoint", () => expect(midpoint(crit("x", 5.5, 6))).toBe(5.75));
  it("sorts ascending by midpoint, stable on ties", () => {
    const out = sortWeakestFirst(cs).map((c) => c.name);
    expect(out).toEqual(["b", "a", "c", "d"]);
  });
  it("blockerIndex = lowest midpoint, first on tie (original array index)", () => {
    expect(blockerIndex(cs)).toBe(1); // 'b'
    expect(blockerIndex([crit("a", 6, 6.5), crit("b", 6, 6.5)])).toBe(0);
  });
});
```

- [ ] **Step 2: Run, verify fail.** Run: `npm test -- src/lib/writing/feedback-view.test.ts` → FAIL.

- [ ] **Step 3: Implement `feedback-view.ts`:**

```ts
export interface CriterionLike {
  name: string;
  bandLow: number;
  bandHigh: number;
  strength: string;
  mainIssue: string;
  nextStep: string;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export const midpoint = (c: { bandLow: number; bandHigh: number }) => (c.bandLow + c.bandHigh) / 2;

/** 4.0–9.0 axis → 0–100%, clamped. */
export function axisPct(band: number): number {
  return Math.max(0, Math.min(100, ((band - 4) / 5) * 100));
}

export function gapToTarget(high: number, target: number): string {
  const to = round1(target - high);
  return to > 0 ? `+${to} to ${target.toFixed(1)}` : "at target";
}

export function confidencePills(level: "low" | "medium" | "high"): number {
  return level === "low" ? 1 : level === "medium" ? 2 : 3;
}

/** New array, ascending by midpoint; JS sort is stable so ties keep input order. */
export function sortWeakestFirst<T extends { bandLow: number; bandHigh: number }>(criteria: T[]): T[] {
  return [...criteria].sort((a, b) => midpoint(a) - midpoint(b));
}

/** Index (in the ORIGINAL array) of the blocker = lowest midpoint, first on tie. */
export function blockerIndex(criteria: { bandLow: number; bandHigh: number }[]): number {
  let best = 0;
  for (let i = 1; i < criteria.length; i++) {
    if (midpoint(criteria[i]) < midpoint(criteria[best])) best = i;
  }
  return best;
}
```

- [ ] **Step 4: Run, verify pass.** Run: `npm test -- src/lib/writing/feedback-view.test.ts` → PASS.

### Task 1.3: Display labels

**Files:** Create `src/lib/writing/labels.ts` (no test — pure map, trivial).

- [ ] **Step 1: Implement:**

```ts
import type { Feedback } from "./evaluator/types";

type CriterionName = Feedback["criteria"][number]["name"];

const CRITERION_LABEL: Record<CriterionName, string> = {
  task_response: "Task Response",
  coherence_cohesion: "Coherence and Cohesion",
  lexical_resource: "Lexical Resource",
  grammar_accuracy: "Grammatical Range and Accuracy",
};
export const criterionLabel = (n: CriterionName) => CRITERION_LABEL[n];

export const writingCategoryLabel = (c: "academic" | "general") =>
  c === "academic" ? "Academic" : "General Training";

export const confidenceLabel = (c: "low" | "medium" | "high") =>
  c.charAt(0).toUpperCase() + c.slice(1);
```

- [ ] **Step 2: Typecheck.** Run: `npx tsc --noEmit` → no errors from these files.

---

## Increment 2 — Data access (owner-path reads + admin writes)

### Task 2.1: UI reads (`read.ts`)

**Files:** Create `src/lib/writing/read.ts`. Owner path (Drizzle `db`), mirroring the reading result page. NEVER selects `writingFeedbackDebug`.

- [ ] **Step 1: Implement:**

```ts
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { writingFeedback, writingSubmission, writingTask } from "@/db/schema";
import type { Feedback } from "./evaluator/types";

export interface CatalogTask { id: string; category: "academic" | "general"; prompt: string }

export async function listPublishedTasks(): Promise<CatalogTask[]> {
  return db
    .select({ id: writingTask.id, category: writingTask.category, prompt: writingTask.prompt })
    .from(writingTask)
    .where(eq(writingTask.status, "published"))
    .orderBy(desc(writingTask.createdAt));
}

export async function loadPublishedTask(taskId: string): Promise<CatalogTask | null> {
  const [row] = await db
    .select({ id: writingTask.id, category: writingTask.category, prompt: writingTask.prompt })
    .from(writingTask)
    .where(and(eq(writingTask.id, taskId), eq(writingTask.status, "published")))
    .limit(1);
  return row ?? null;
}

export interface FeedbackResult {
  essay: string;
  wordCount: number;
  taskPrompt: string;
  category: "academic" | "general";
  createdAt: Date;
  bandLow: number;
  bandHigh: number;
  confidence: "low" | "medium" | "high";
  feedback: Pick<Feedback, "criteria" | "topFixes" | "annotations" | "rewrite" | "checklist">;
}

/** Owner-scoped: only the submission's owner, only when feedback exists (completed). */
export async function readFeedbackResult(userId: string, submissionId: string): Promise<FeedbackResult | null> {
  const [row] = await db
    .select({
      userId: writingSubmission.userId,
      essay: writingSubmission.essayText,
      wordCount: writingSubmission.wordCount,
      taskPrompt: writingTask.prompt,
      category: writingTask.category,
      createdAt: writingFeedback.createdAt,
      bandLow: writingFeedback.bandLow,
      bandHigh: writingFeedback.bandHigh,
      confidence: writingFeedback.confidence,
      criteria: writingFeedback.criteria,
      topFixes: writingFeedback.topFixes,
      annotations: writingFeedback.annotations,
      rewrite: writingFeedback.rewrite,
      checklist: writingFeedback.checklist,
    })
    .from(writingFeedback)
    .innerJoin(writingSubmission, eq(writingSubmission.id, writingFeedback.submissionId))
    .innerJoin(writingTask, eq(writingTask.id, writingSubmission.taskId))
    .where(and(eq(writingFeedback.submissionId, submissionId), eq(writingSubmission.userId, userId)))
    .limit(1);
  if (!row) return null;
  return {
    essay: row.essay,
    wordCount: row.wordCount,
    taskPrompt: row.taskPrompt,
    category: row.category,
    createdAt: row.createdAt,
    bandLow: Number(row.bandLow),
    bandHigh: Number(row.bandHigh),
    confidence: row.confidence,
    feedback: {
      criteria: row.criteria as Feedback["criteria"],
      topFixes: row.topFixes as Feedback["topFixes"],
      annotations: row.annotations as Feedback["annotations"],
      rewrite: row.rewrite as Feedback["rewrite"],
      checklist: row.checklist as Feedback["checklist"],
    },
  };
}

export interface HistoryRow {
  submissionId: string;
  category: "academic" | "general";
  prompt: string;
  createdAt: Date;
  bandLow: number;
  bandHigh: number;
  confidence: "low" | "medium" | "high";
}

export async function listUserHistory(userId: string): Promise<HistoryRow[]> {
  const rows = await db
    .select({
      submissionId: writingFeedback.submissionId,
      category: writingTask.category,
      prompt: writingTask.prompt,
      createdAt: writingFeedback.createdAt,
      bandLow: writingFeedback.bandLow,
      bandHigh: writingFeedback.bandHigh,
      confidence: writingFeedback.confidence,
    })
    .from(writingFeedback)
    .innerJoin(writingSubmission, eq(writingSubmission.id, writingFeedback.submissionId))
    .innerJoin(writingTask, eq(writingTask.id, writingSubmission.taskId))
    .where(eq(writingSubmission.userId, userId))
    .orderBy(desc(writingFeedback.createdAt));
  return rows.map((r) => ({ ...r, bandLow: Number(r.bandLow), bandHigh: Number(r.bandHigh) }));
}
```

- [ ] **Step 2: Typecheck.** Run: `npx tsc --noEmit` → clean.

### Task 2.2: Admin writes (`admin.ts`)

**Files:** Create `src/lib/writing/admin.ts`. Owner path; the route gates with `requireAdmin`.

- [ ] **Step 1: Implement:**

```ts
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { writingTask } from "@/db/schema";
import type { Tier } from "@/lib/tiers";

export async function insertWritingTask(input: {
  category: "academic" | "general";
  prompt: string;
  tierRequired: Tier;
  createdBy: string;
  publish: boolean;
}): Promise<string> {
  const [row] = await db
    .insert(writingTask)
    .values({
      category: input.category,
      prompt: input.prompt,
      tierRequired: input.tierRequired,
      status: input.publish ? "published" : "draft",
      createdBy: input.createdBy,
    })
    .returning({ id: writingTask.id });
  return row.id;
}

export async function publishWritingTask(taskId: string): Promise<void> {
  await db.update(writingTask).set({ status: "published" }).where(eq(writingTask.id, taskId));
}
```

- [ ] **Step 2: Typecheck.** Run: `npx tsc --noEmit` → clean.

---

## Increment 3 — Catalog screen + navigation enable + icon

### Task 3.1: Add `alert-triangle` icon

**Files:** Modify `src/components/core/icons.tsx`.

- [ ] **Step 1:** Add to `PATHS` (Lucide alert-triangle):

```tsx
"alert-triangle": <><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /><path d="M12 9v4" /><path d="M12 17h.01" /></>,
```

- [ ] **Step 2: Typecheck.** Run: `npx tsc --noEmit` → `IconName` now includes `"alert-triangle"`.

### Task 3.2: Catalog server page + body

**Files:** Create `app/app/writing/page.tsx`, `app/app/writing/_Catalog.tsx`.

`page.tsx` (server): `requireUser()`; if `writingEvalConfig() === null` → `redirect("/app/practice")`; read `listPublishedTasks()` + `getProfile()` (for target band); wrap `<AppShell active="practice">`; pass tasks + targetBand to `_Catalog`.

`_Catalog.tsx` (client) recreates handoff §1:
- overline "WRITING LAB"; H1 "Pick a prompt." (period `--brand`); subtitle.
- Target widget (reuse the GoalBar pattern visuals; static here — target + rail). Omit the "Drill weakest" chip (no writing weak-type data yet) and the "Continue your draft" card (no backend draft persistence) — **deliberate omissions, noted; not failures.**
- Filter row: segmented Academic/General (client state) + search input (`Input` icon="search") filtering prompt text. Type-filter chips are N/A for writing (no question types) — omit.
- Prompt list: full-width interactive `Card` rows → `Link href={/app/writing/attempt/${id}}`; 46px `--brand-subtle` tile with `pen-line` icon; mono overline "TASK 2 · {Academic|General}"; prompt clamped 2 lines; right "~250 words" + "Write →" (`--text-link`).
- Empty state when no published tasks: "No prompts yet — check back soon."

- [ ] **Step 1:** Implement `page.tsx` (server, owner read + config guard).
- [ ] **Step 2:** Implement `_Catalog.tsx` (client: category segment + search filter over `tasks`).
- [ ] **Step 3: Typecheck + build-free check.** Run: `npx tsc --noEmit` → clean. Visual verified on Vercel after push (per project rule; no local dev).

### Task 3.3: Enable the Writing card in Practice when configured

**Files:** Modify `app/app/practice/page.tsx`, `app/app/practice/_PracticeCatalog.tsx`.

- [ ] **Step 1:** In `practice/page.tsx`: `import { writingEvalConfig } from "@/env"`; compute `const writingEnabled = writingEvalConfig() !== null;` and pass `writingEnabled` to `<PracticeCatalog ... />`.

- [ ] **Step 2:** In `_PracticeCatalog.tsx`:
  - Add `writingEnabled?: boolean` to props.
  - For the Writing `SkillCard`: when `writingEnabled`, render badge `{ tone: "success", text: "Live" }`, `meta="Live · Task 2"`, not muted, and `onClick={() => router.push("/app/writing")}` (`useRouter` from `next/navigation`) instead of `selectSkill("writing")`; do not set `expanded`/`controls`. When disabled, keep the current Soon/locked-panel behavior unchanged.
  - Speaking card untouched.
  - This is the minimal diff — do not restructure the component.

- [ ] **Step 3: Typecheck.** Run: `npx tsc --noEmit` → clean.

---

## Increment 4 — Attempt screen + async flow

### Task 4.1: Attempt server page

**Files:** Create `app/app/writing/attempt/[taskId]/page.tsx`.

Server: `requireUser()`; config guard → `redirect("/app/practice")`; `loadPublishedTask(taskId)`; if null → `notFound()`; `getProfile()` for target band; `<AppShell active="practice">` → `<Attempt task=... targetBand=... />`.

- [ ] **Step 1:** Implement. **Step 2:** `npx tsc --noEmit` clean.

### Task 4.2: Attempt client state machine

**Files:** Create `app/app/writing/attempt/[taskId]/_Attempt.tsx` (client).

State: `phase: "edit" | "queued" | "analyzing" | "failed" | "preview_used" | "daily_cap" | "in_progress"`, `essay`, `timerOn`, derived `wc = wordCount(essay)`, `state = wordCountState(wc)`.

Layout (handoff §2): 2-col grid `320px 1fr`:
- Left rail: Prompt card (`--brand-subtle`/`--brand-border`), Target card, Structure guide (4 numbered steps Introduction/Body 1/Body 2/Conclusion with one-line hints, 26px `--brand-subtle` number badges, connector line).
- Right: "Your essay" + timer control. Timer OFF = pill button "Start 40-min timer" (`clock`); ON = `ExamTimer` (compact) driven by a local countdown (40·60s) — `remainingSeconds`/`totalSeconds` props; the timer is advisory (no auto-submit). Textarea `--reading-surface`/`--reading-text`/`--font-reading` 17px/1.7, min-height 470.
- Bottom action bar: word-count ring (62px SVG, `r=44` stroke `9`, track `--surface-inset`, progress stroke `state.color`, `strokeDashoffset=state.offset`, mono count centered) + status message (`state.color`) + "words · min 20 · max 1000"; right `Button` primary lg "Get my feedback" trailingIcon `arrow-right`, `disabled={!state.canSubmit || pending}`; disclaimer line (`--text-muted`): "Estimated band range — not an official IELTS score."

Submit handler:

```ts
const onSubmit = () => startTransition(async () => {
  const res = await createWritingSubmission({ taskId: task.id, essay });
  if (!res.ok) {
    if (res.reason === "preview_used") return setPhase("preview_used");
    if (res.reason === "daily_cap") return setPhase("daily_cap");
    if (res.reason === "in_progress") return setPhase("in_progress");
    if (res.reason === "not_configured") return router.push("/app/practice");
    // too_short/too_long shouldn't reach here (button gated) — surface inline.
    return setError("Please write between 20 and 1000 words.");
  }
  setSubmissionId(res.submissionId);
  setPhase("queued");
});
```

Poll (after submissionId set, while phase ∈ queued|analyzing): `setInterval` ~2500ms calling `getSubmissionStatus(submissionId)`:
- `pending` → phase "queued"; `evaluating` → phase "analyzing";
- `completed` → `router.push(/app/writing/result/${submissionId})`;
- `failed`/null → phase "failed"; clear interval on completed/failed and on unmount.

Render per phase:
- `edit` → the editor above.
- `queued` (handoff §3): centered, 3 pulsing `--brand` dots, H1 "You're in the queue", est-wait line (mono — show generic "est. wait a few seconds" since we have no queue depth), 3-step status list (Queued active). Footer note: "You can leave this page — we'll keep your spot. Only one analysis runs at a time."
- `analyzing` (handoff §4): centered, levitating 3-bar living-logo + sheen, H1 "Analyzing your essay…", "Usually 10–40 seconds" (mono), indeterminate rail, status list (Queued done `--success` check, Analyzing active). Respect `prefers-reduced-motion` (CSS `@media` no-ops, same pattern as `_PracticeCatalog` keyframes).
- `failed` (handoff §7): `--error-subtle` circle + `circle-x` icon (spring pop), H1 "We couldn't finish your analysis", body incl. "this attempt was **not** counted against your limit.", buttons primary "Try analysis again" (re-run `onSubmit`) + secondary "Back to my essay" (→ phase "edit").
- `preview_used` (handoff §8): `--brand-subtle` circle + `sparkles`, H1 "That was your free analysis — nice start", "With Ultra you get" card (3 `check` perks), primary "Upgrade to Ultra" (`href="/app/upgrade"`) + ghost "Reread my feedback" (→ `/app/writing/history`).
- `daily_cap` (handoff §9): `--warn-subtle` circle + `clock`, H1 "You've hit today's analysis limit", body, primary "Review last feedback" (→ history) + secondary "Open history".
- `in_progress`: short note "An analysis is already running — only one at a time." + button "Go to history".

- [ ] **Step 1:** Implement `_Attempt.tsx` editor + ring + timer + submit.
- [ ] **Step 2:** Implement the poll + all phase screens.
- [ ] **Step 3: Typecheck.** Run: `npx tsc --noEmit` → clean.

---

## Increment 5 — Feedback result screen

### Task 5.1: Result server page (owner read)

**Files:** Create `app/app/writing/result/[id]/page.tsx`.

Server: `getUser()` → `redirect("/auth")` if none; config guard → `redirect("/app/practice")`; `isUuid(id)` else `notFound()`; `readFeedbackResult(user.id, id)` → null → `notFound()`; `getProfile()` for `targetBand` (Number(profile.target_band) || 7); `<AppShell active="practice">` → `<FeedbackView data=... targetBand=... />`.

- [ ] **Step 1:** Implement. **Step 2:** `npx tsc --noEmit` clean.

### Task 5.2: Feedback orchestrator + sub-components

**Files:** Create `_FeedbackView.tsx` and `_feedback/{BandHero,TopFixes,CriteriaPlot,Annotations,Rewrite,Checklist}.tsx`.

`_FeedbackView.tsx` (client): receives `data: FeedbackResult` + `targetBand`. Computes once:
- `bi = blockerIndex(data.feedback.criteria)`; `blocker = criteria[bi]`; `biggestBlocker = { criterion: criterionLabel(blocker.name), note: blocker.mainIssue }`.
- `ordered = sortWeakestFirst(criteria)` for the plot, each tagged `isBlocker = (c === blocker)`.
- Header (overline "Feedback · Task 2"; H1 "Nice work finishing — here's where to focus next"; "View in history" pill → `/app/writing/history`).
- Compose: `BandHero`, `TopFixes`, `CriteriaPlot`, `Annotations`, `Rewrite`, `Checklist`, footer bar (primary "Try again" → `/app/writing/attempt/?` — link back to catalog since taskId not threaded; use "Pick a new topic" → `/app/writing` + note "saved as a snapshot…"). Max-width 980.

> "Try again" target: we don't carry taskId into the result read. Simplest faithful behavior: primary "Try again" → `/app/writing` (catalog) and secondary "Pick a new topic" → `/app/writing`. (Threading taskId would need an extra column in the read — out of scope; document the simplification.)

**`BandHero.tsx`** (handoff §5 hero, 2-col `330px 1fr`, `--brand-border` panel `--shadow-solid-lg`):
- Left (`--brand-subtle`): overline "ESTIMATED BAND"; big low band `Number` 60px/800 mono via `CountUp value={bandLow} decimals={1}` + "–{bandHigh}" 30px/700 `--text-secondary`; confidence meter = 3 pills filled `confidencePills(confidence)` (filled `--brand`, empty `--brand-border`) + `confidenceLabel`; disclaimer "A coaching estimate to guide practice — **not an official IELTS score.**"
- Right (`--surface`, 4px `--error` left border): "BIGGEST BLOCKER" badge (`--error-subtle`/`--error-text`) + `biggestBlocker.criterion` (serif) + `biggestBlocker.note` + "Fix this one first — it moves your band the most." (`--text-link`).

**`TopFixes.tsx`:** 3-col grid of `--surface` cards; 28px `--brand` numbered circle (`--text-on-brand`) + fix text. Render `topFixes` in order (1–3; render only what exists).

**`CriteriaPlot.tsx`** (handoff §5 estimate plot): one `--surface` panel radius 20 `--shadow-solid`.
- Header strip (`--surface-inset`, grid `1fr 240px`): left "CRITERION · ESTIMATED RANGE"; right axis region — faint mono ticks 5/6/8 (positions `axisPct(5|6|8)` = 20/40/80) and a "TARGET {target}" marker `--text-link` at `left: ${axisPct(targetBand)}%`.
- One row per `ordered` criterion (grid `1fr 240px`, divided `--border-subtle`; blocker row `--surface-inset` highlight). Left: rank badge (24px `--surface-inset` mono = index+1) + `criterionLabel(name)` (serif 17/600) + optional "FIX FIRST" badge (`alert-triangle`, `--error-subtle`) when `isBlocker` + band range mono `{lo}–{hi}` right-aligned; below (indent 35) three lines STRENGTH/WATCH/NEXT (`strength`/`mainIssue`/`nextStep`).
- Right cell = interval marker on shared 4–9 axis: `--surface-inset` rail 10px; segment `--slate-700` from `left:${axisPct(lo)}%` to `${axisPct(hi)}%` (width = diff) with `--shadow-solid` + two 13px ring endpoints (`--surface` fill, 3px `--slate-700` border); dashed vertical target line `--brand-border` at `${axisPct(targetBand)}%`; caption `gapToTarget(hi, targetBand)` top-right. **Not interactive** (visual marker, not a slider).

**`Annotations.tsx`** (handoff §5 inline annotations) — client interactivity:
- "Notes on your text" + helper + legend (Good move `--success-text`, Style & clarity `--warn-text`, Grammar `--error-text`).
- 2-col grid `1.45fr 1fr`. Left (`--reading-surface`, serif 16/1.95): the essay text with annotated quotes wrapped in `<mark>`. Build segments by locating each `annotation.quote` as a substring of `data.essay` (first match; if not found, the annotation still appears as a comment card but no highlight). Each `<mark>`: tint bg by type-subtle + 2px bottom border type-accent; on click set `activeNote = index`, add ring `0 0 0 2px {accent}`.
- Right: comment cards (one per annotation): 1px border + 3px type-accent left border, type label (GOOD MOVE/STYLE/GRAMMAR in accent color), quoted phrase (serif italic ellipsized), comment. Active card → type-subtle bg + `wl-ring`-style pulse. Bidirectional: clicking card sets `activeNote` and clicking mark highlights its card (link by index).

Substring → segments helper (pure, can be inline): produce an ordered list of `{text, annIndex|null}` by scanning `essay` for the quotes in document order (greedy, non-overlapping). Keep it simple and defensive (missing quote → skipped highlight).

**`Rewrite.tsx`** (handoff §5 partial rewrite): three cards — (1) Stronger thesis: "YOURS" `rewrite.thesisOld` struck (`--error` strike) vs "STRONGER" `rewrite.thesis` in `--brand-subtle` serif block; (2) one rewritten paragraph `rewrite.paragraph` (`--reading-surface`, serif); (3) Swap weak phrases: `rewrite.replacements` as inline chips `from → to` (`--surface-inset`, `from` struck `--text-muted`, `to` `--success-text`/600).

**`Checklist.tsx`** (handoff §5): `--surface` card; each `checklist` item a toggle button — 24px checkbox (unchecked `--border-strong`; checked `--brand` + white `check`) + text. **Local UI state only** (`useState<Set<number>>`).

- [ ] **Step 1:** Implement `BandHero`, `TopFixes`, `Checklist` (simpler).
- [ ] **Step 2:** Implement `CriteriaPlot` (axis geometry via `axisPct`/`gapToTarget`).
- [ ] **Step 3:** Implement `Annotations` (segments + bidirectional active) and `Rewrite`.
- [ ] **Step 4:** Implement `_FeedbackView.tsx` composing all + header + footer; reuse `CountUp`/`FadeUp` from `../../reading/[id]/result/reveal` (or relative path) — confirm import path resolves.
- [ ] **Step 5: Typecheck.** Run: `npx tsc --noEmit` → clean.

---

## Increment 6 — History + admin create-topic

### Task 6.1: History screen

**Files:** Create `app/app/writing/history/page.tsx` (server-rendered; rows are links, no client interactivity needed).

Server: `getUser()` → redirect; config guard; `listUserHistory(user.id)`; `<AppShell active="practice">`. Max-width 880. H1 "Attempt history" + "Every analysis is saved as a snapshot… it never re-scores." Stack of `Link` rows (`--surface`/`--shadow-solid`, grid `1fr auto`) → `/app/writing/result/${submissionId}`: left = category chip (`writingCategoryLabel`) + mono date + "LATEST" badge (`--success-subtle`) on the first row + clamped prompt; right = mono `{lo}–{hi}` + "{confidence} confidence" + "→". Empty state: "No analyses yet — write your first essay."

- [ ] **Step 1:** Implement. **Step 2:** `npx tsc --noEmit` clean.

### Task 6.2: Admin create-topic

**Files:** Create `app/admin/writing/page.tsx`, `app/admin/writing/actions.ts`, `app/admin/writing/_CreateTopicForm.tsx`.

`actions.ts` (`"use server"`): mirror `app/admin/actions.ts` style.

```ts
"use server";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { insertWritingTask } from "@/lib/writing/admin";
import type { Tier } from "@/lib/tiers";

function parse(formData: FormData) {
  const prompt = String(formData.get("prompt") ?? "").trim();
  const category = String(formData.get("category") ?? "") as "academic" | "general";
  const tierRequired = String(formData.get("tier") ?? "ultra") as Tier;
  return { prompt, category, tierRequired };
}

export async function createWritingTask(formData: FormData) {
  const admin = await requireAdmin();
  const { prompt, category, tierRequired } = parse(formData);
  if (!prompt || (category !== "academic" && category !== "general")) {
    redirect("/admin/writing?error=invalid");
  }
  const publish = formData.get("intent") === "publish";
  await insertWritingTask({ prompt, category, tierRequired, createdBy: admin.id, publish });
  redirect(`/admin/writing?created=${publish ? "published" : "draft"}`);
}
```

`page.tsx` (server): `requireAdmin()`; render handoff §11 — H1 "New Task 2 topic" + "DRAFT" badge; helper "Students see this topic in the catalog only after you publish it."; `<CreateTopicForm action={createWritingTask} />`; show `searchParams.created`/`error` banners.

`_CreateTopicForm.tsx` (client or server form): a `<form>` with Prompt textarea (`name="prompt"`); 2-col grid Category select (`name="category"`: Academic/General) + Required plan select (`name="tier"`: Basic/Premium/Ultra → `basic`/`premium`/`ultra`); actions: primary submit `name="intent" value="publish"` "Publish topic" (`check`) + secondary submit `value="draft"` "Save draft" + caption "Draft → Published". Publish = a deliberate confirm (form submit), not a blind flip (matches admin pattern; the form shows the typed prompt before submit).

- [ ] **Step 1:** Implement `admin.ts` action + `page.tsx`.
- [ ] **Step 2:** Implement `_CreateTopicForm.tsx`.
- [ ] **Step 3: Typecheck.** Run: `npx tsc --noEmit` → clean.

---

## Increment 7 — Full verification

- [ ] **Step 1: Unit tests.** Run: `npm test` → all green (writing logic + existing suites under the extended schema). If concurrent/integration tests exist in the writing area, run `npm test -- src/lib/writing app/app/writing` twice to rule out flake.
- [ ] **Step 2: Typecheck.** Run: `npx tsc --noEmit` → 0 errors.
- [ ] **Step 3: Build.** Run: `npm run build` (only when no `npm run dev` is live — it would corrupt `.next`). Expected: compiles, no type/lint errors in the new routes.
- [ ] **Step 4: Disabled-safe check.** With `WRITING_EVAL_MODEL` unset (`writingEvalConfig()===null`): Practice "Writing" card stays Soon/locked-panel; `/app/writing`, `/app/writing/attempt/x`, `/app/writing/result/x`, `/app/writing/history` all `redirect("/app/practice")`. Confirm by reading the guard in each `page.tsx`.
- [ ] **Step 5: Invariant audit (read, don't assume).** Grep the new code: no `writingFeedbackDebug` import in any `app/app/writing/**`; no R/L grading/import/answer_key import; no hardcoded hex in new components (`rg -n "#[0-9a-fA-F]{3,6}" app/app/writing app/admin/writing`); feedback read is owner-scoped (`eq(writingSubmission.userId, userId)` present).
- [ ] **Step 6:** `git diff --stat` shown to user. **Do NOT commit** — await user's go. Scope when they approve: `feat(writing)`.

---

## Self-review (spec coverage)

- Handoff §1 catalog → 3.2 · §2 attempt → 4.2 · §3 queue / §4 analyzing → 4.2 phases · §5 feedback (hero/blocker/top3/plot/annotations/rewrite/checklist) → 5.2 · §6 history → 6.1 · §7 failed / §8 preview-used / §9 daily-limit → 4.2 phases · §10 coming-soon → existing locked panel (3.3 keeps it when disabled) · §11 admin → 6.2.
- Contract extension: `annotations[].type` (0.1/0.2), `partialRewrite.thesisOld` (0.1/0.2), `isBlocker` computed via `blockerIndex` (1.2, not added to schema). ✔
- Deliberate omissions (documented, not gaps): "Continue your draft" card (no backend draft store), "Drill weakest" chip on the writing catalog (no writing weak-type data), "Try again"→exact-task (taskId not threaded into the result read). Left rail demo switcher: never built.
