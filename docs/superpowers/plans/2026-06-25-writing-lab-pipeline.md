# Writing Lab — Pipeline Implementation Plan (rev 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the async evaluation pipeline — submit → gate → persist `pending` → internal idempotent evaluate route (Gemini, Plan 2) → snapshot → poll — with cost-abuse closed at the DB level, not just soft gates. Per spec `docs/superpowers/specs/2026-06-25-writing-lab-design.md`.

**Architecture:** `createWritingSubmission` gates (Ultra OR one lifetime free preview; soft daily cap; essay size bounds) and inserts `pending` **guarded by a unique partial index** — at most ONE active (`pending|evaluating`) submission per user, so a second submit while the first is in-flight can't farm free evaluations. It then fires the evaluate route in the background (`after()`+authenticated fetch). `/api/writing/evaluate` is internal (Bearer secret) and idempotent (atomic `pending→evaluating` claim). It evaluates, writes `writing_feedback` (snapshot) + `writing_feedback_debug` (raw, server-only) and flips to `completed` **only if still `evaluating`** (a reaped row is never resurrected). `getSubmissionStatus` polls (owner-read), re-kicks a stuck `pending` (lost trigger), and reaps a stuck `evaluating` to `failed`. Retry = a NEW submission (re-gated). All writes owner-path; R/L untouched.

**Tech Stack:** Next.js server actions + route handler, `next/server` `after()`, Drizzle owner client, Plan 2 evaluator, tiers, `isCronAuthorized`, vitest.

**Scope:** migration 0024 + pipeline. No UI/admin (Plan 4). Disabled in product until `WRITING_EVAL_MODEL` set (gate fails closed when `writingEvalConfig()` null).

**Invariant:** new code under `src/lib/writing/`, `app/api/writing/`, `app/app/writing/`, `migrations/0024_*`, `src/db/schema.ts` (index only). R/L grading/import/answer_key untouched. `raw_output` never leaves the server.

**Rev-2 changes (from adversarial self-review of rev 1):** Task 0 (unique index closes preview-farm) · MAX_WORDS cost guard · `persistFeedback` status-guarded · `pending`/`evaluating` both handled on poll · middleware exclusion · retry-model made explicit · 0024 also REVOKEs client write-grants on writing tables (defense-in-depth; RLS already denies, this is the second layer).

**⚠️ Verify-at-implementation (Vercel, outside cutoff — confirm):** `after()`+`fetch` to own route runs post-response (Fluid). Fallback IS the `pending` re-kick in `getSubmissionStatus` (always present). App origin via `siteUrl()` (env), not request host.

---

## Task 0: Migration 0024 — anti-farm index + write-grant lockdown

**Files:** Create `migrations/0024_writing_lab_hardening/{up,down}.sql`; Modify `src/db/schema.ts` (add index to `writingSubmission`); Modify `scripts/verify.ts` (count unchanged at 22 — no new tables; just confirm).

- [ ] **Step 1: Write `up.sql`**

```sql
-- 0024_writing_lab_hardening :: up
-- (1) Anti-farm: at most ONE active (pending|evaluating) writing submission per
--     user — a concurrent/rapid second submit can't farm free evaluations while
--     the first is in flight (mirrors 0007 attempt_one_in_progress).
-- (2) Defense-in-depth: REVOKE client write-grants on the writing tables. RLS
--     already denies writes (no write-policy), but Supabase default-privileges
--     hand new tables [SIUD] to authenticated/anon; this removes the broad grant
--     so the owner-path is provably the only writer. debug is already locked.

CREATE UNIQUE INDEX writing_submission_one_active_idx
  ON writing_submission (user_id)
  WHERE status IN ('pending', 'evaluating');

REVOKE INSERT, UPDATE, DELETE ON writing_task       FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON writing_submission FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON writing_feedback   FROM anon, authenticated;
REVOKE ALL ON writing_task       FROM anon;  -- task is published-read for authenticated only
REVOKE ALL ON writing_submission FROM anon;
REVOKE ALL ON writing_feedback   FROM anon;
```

- [ ] **Step 2: Write `down.sql`**

```sql
-- 0024_writing_lab_hardening :: down
DROP INDEX IF EXISTS writing_submission_one_active_idx;
-- Re-grant to restore the pre-0024 baseline (Supabase default-privilege shape).
GRANT INSERT, UPDATE, DELETE ON writing_task       TO authenticated;
GRANT INSERT, UPDATE, DELETE ON writing_submission TO authenticated;
GRANT INSERT, UPDATE, DELETE ON writing_feedback   TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON writing_task       TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON writing_submission TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON writing_feedback   TO anon;
```

- [ ] **Step 3: Add the index to `schema.ts`** (keep SQL ↔ schema in lockstep)

In `src/db/schema.ts`, add to the `writingSubmission` table's index callback:

```ts
import { sql } from "drizzle-orm"; // already imported
// inside (t) => [ ... ] for writingSubmission:
uniqueIndex("writing_submission_one_active_idx")
  .on(t.userId)
  .where(sql`${t.status} in ('pending','evaluating')`),
```

(Import `uniqueIndex` from `drizzle-orm/pg-core` if not already.)

- [ ] **Step 4: Verify**

Run: `npm run verify` → 22 tables, migrations through 0024 apply + down/up roundtrip clean.
Run: `npx tsc --noEmit` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add migrations/0024_writing_lab_hardening/ src/db/schema.ts
git commit -m "feat(writing): 0024 — one-active-submission index + write-grant lockdown"
```

> ⚠️ After merge, apply 0024 to prod Supabase (`npm run db:migrate`, up only) before enabling the pipeline — same as 0023.

---

## Task 1: Internal secret seam

**Files:** Modify `src/env.ts`; `.env.example`.

- [ ] **Step 1: Add `writingInternalSecret()` (mirror `cronSecret()`)**

```ts
/**
 * Shared secret guarding the internal /api/writing/evaluate route. Absent => the
 * route refuses all calls (fail closed): users must never reach the evaluator
 * directly (cost-abuse via tokens).
 */
export function writingInternalSecret(): string | null {
  const v = process.env.WRITING_INTERNAL_SECRET;
  return v && v.trim() !== "" ? v : null;
}
```

Add `WRITING_INTERNAL_SECRET=` to `.env.example`; set a random value in local `.env.local`.

- [ ] **Step 2: Typecheck + commit**

Run: `npx tsc --noEmit` → exit 0.
```bash
git add src/env.ts .env.example
git commit -m "feat(writing): internal-secret seam for the evaluate route"
```

---

## Task 2: Pure lifecycle logic — gate + essay bounds + reaper

**Files:** Create `src/lib/writing/lifecycle.ts`; Test `src/lib/writing/lifecycle.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { canEvaluate, validateEssay, isStuckEvaluating, WRITING_DAILY_CAP, WRITING_STALE_MS, MIN_WORDS, MAX_WORDS } from "./lifecycle";

describe("validateEssay", () => {
  it("rejects too short", () => {
    expect(validateEssay("one two three")).toEqual({ ok: false, reason: "too_short" });
  });
  it("rejects too long (cost guard)", () => {
    expect(validateEssay(Array(MAX_WORDS + 1).fill("w").join(" "))).toEqual({ ok: false, reason: "too_long" });
  });
  it("accepts a normal essay and counts words", () => {
    const text = Array(MIN_WORDS + 5).fill("word").join(" ");
    expect(validateEssay(text)).toEqual({ ok: true, wordCount: MIN_WORDS + 5 });
  });
});

describe("canEvaluate", () => {
  const base = { configured: true, tier: "ultra" as const, lifetimeCompleted: 0, todayCompleted: 0 };
  it("blocks when not configured", () => {
    expect(canEvaluate({ ...base, configured: false })).toEqual({ allowed: false, reason: "not_configured" });
  });
  it("blocks Ultra at the daily cap", () => {
    expect(canEvaluate({ ...base, todayCompleted: WRITING_DAILY_CAP })).toEqual({ allowed: false, reason: "daily_cap" });
  });
  it("allows non-Ultra first preview, blocks after", () => {
    expect(canEvaluate({ ...base, tier: "basic", lifetimeCompleted: 0 })).toEqual({ allowed: true });
    expect(canEvaluate({ ...base, tier: "premium", lifetimeCompleted: 1 })).toEqual({ allowed: false, reason: "preview_used" });
  });
});

describe("isStuckEvaluating", () => {
  it("true past, false within the window", () => {
    const at = new Date("2026-06-25T12:00:00Z");
    expect(isStuckEvaluating(at, new Date("2026-06-25T12:10:00Z"), WRITING_STALE_MS)).toBe(true);
    expect(isStuckEvaluating(at, new Date("2026-06-25T12:01:00Z"), WRITING_STALE_MS)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test — FAIL**

Run: `npx vitest run src/lib/writing/lifecycle.test.ts` → FAIL (`./lifecycle` not found).

- [ ] **Step 3: Write `lifecycle.ts`**

```ts
import type { Tier } from "@/lib/tiers";

export const MIN_WORDS = 20;      // below this it's not an essay
export const MAX_WORDS = 1000;    // cost guard — IELTS Task 2 is ~250-400 words
export const WRITING_DAILY_CAP = 20;          // soft Ultra/day cap (placeholder)
export const WRITING_STALE_MS = 5 * 60 * 1000; // reap 'evaluating' older than this

export type EssayCheck = { ok: true; wordCount: number } | { ok: false; reason: "too_short" | "too_long" };
export function validateEssay(text: string): EssayCheck {
  const trimmed = text.trim();
  const wordCount = trimmed ? trimmed.split(/\s+/).length : 0;
  if (wordCount < MIN_WORDS) return { ok: false, reason: "too_short" };
  if (wordCount > MAX_WORDS) return { ok: false, reason: "too_long" };
  return { ok: true, wordCount };
}

export interface EvalGateInput {
  configured: boolean;
  tier: Tier;
  lifetimeCompleted: number;
  todayCompleted: number;
}
export type EvalGate = { allowed: true } | { allowed: false; reason: "not_configured" | "preview_used" | "daily_cap" };

// The one-active-submission UNIQUE INDEX (0024) closes the in-flight farm race at
// the DB; this gate handles the steady-state policy (config, preview, cap).
export function canEvaluate(i: EvalGateInput): EvalGate {
  if (!i.configured) return { allowed: false, reason: "not_configured" };
  if (i.tier !== "ultra") {
    return i.lifetimeCompleted >= 1 ? { allowed: false, reason: "preview_used" } : { allowed: true };
  }
  return i.todayCompleted >= WRITING_DAILY_CAP ? { allowed: false, reason: "daily_cap" } : { allowed: true };
}

export function isStuckEvaluating(updatedAt: Date, now: Date, staleMs: number): boolean {
  return now.getTime() - updatedAt.getTime() > staleMs;
}
```

- [ ] **Step 4: Run test — PASS**

Run: `npx vitest run src/lib/writing/lifecycle.test.ts` → PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/writing/lifecycle.ts src/lib/writing/lifecycle.test.ts
git commit -m "feat(writing): gate + essay bounds + reaper pure logic"
```

---

## Task 3: Owner-path store

**Files:** Create `src/lib/writing/store.ts`; Test `src/lib/writing/store.test.ts` (mock `@/db`).

- [ ] **Step 1: Write the failing test (claim + status-guarded persist)**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
const update = vi.fn();
vi.mock("@/db", () => ({ db: { update: (...a: unknown[]) => update(...a) } }));
import { claimForEvaluation } from "./store";

const chain = (rows: unknown[]) => ({ set: () => ({ where: () => ({ returning: () => Promise.resolve(rows) }) }) });
beforeEach(() => update.mockReset());

describe("claimForEvaluation", () => {
  it("true when pending→evaluating updates a row", async () => {
    update.mockReturnValue(chain([{ id: "s1" }]));
    expect(await claimForEvaluation("s1")).toBe(true);
  });
  it("false when already claimed/finished (0 rows)", async () => {
    update.mockReturnValue(chain([]));
    expect(await claimForEvaluation("s1")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test — FAIL** (`npx vitest run src/lib/writing/store.test.ts`)

- [ ] **Step 3: Write `store.ts`**

```ts
import { after } from "next/server";
import { and, count, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/db";
import { writingSubmission, writingFeedback, writingFeedbackDebug, writingTask } from "@/db/schema";
import { writingInternalSecret, siteUrl } from "@/env";
import type { EvaluateResult } from "@/lib/writing/evaluator";

// Insert pending, guarded by the 0024 one-active index. On conflict (user already
// has a pending|evaluating row) inserts nothing → returns null → caller surfaces it.
export async function insertPendingSubmission(userId: string, taskId: string, essay: string, wordCount: number): Promise<string | null> {
  const rows = await db.insert(writingSubmission)
    .values({ userId, taskId, essayText: essay, wordCount, status: "pending" })
    .onConflictDoNothing({ target: writingSubmission.userId, where: inArray(writingSubmission.status, ["pending", "evaluating"]) })
    .returning({ id: writingSubmission.id });
  return rows[0]?.id ?? null;
}

// Atomic single-fire claim — only the pending→evaluating winner evaluates.
export async function claimForEvaluation(submissionId: string): Promise<boolean> {
  const rows = await db.update(writingSubmission)
    .set({ status: "evaluating", updatedAt: new Date() })
    .where(and(eq(writingSubmission.id, submissionId), eq(writingSubmission.status, "pending")))
    .returning({ id: writingSubmission.id });
  return rows.length === 1;
}

export async function loadSubmissionForEval(submissionId: string): Promise<{ essay: string; taskPrompt: string; category: "academic" | "general" } | null> {
  const [row] = await db
    .select({ essay: writingSubmission.essayText, taskPrompt: writingTask.prompt, category: writingTask.category })
    .from(writingSubmission)
    .innerJoin(writingTask, eq(writingTask.id, writingSubmission.taskId))
    .where(eq(writingSubmission.id, submissionId));
  return row ?? null;
}

// Persist snapshot + raw and flip to completed — but ONLY if still 'evaluating'.
// If a reaper already failed it (slow eval), the guarded UPDATE affects 0 rows →
// throw to ROLL BACK the transaction so no orphan feedback is left on a failed row.
export async function persistFeedback(submissionId: string, r: EvaluateResult): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(writingFeedback).values({
      submissionId,
      bandLow: String(r.feedback.bandLow), bandHigh: String(r.feedback.bandHigh),
      confidence: r.feedback.confidence, criteria: r.feedback.criteria, topFixes: r.feedback.topFixes,
      annotations: r.feedback.annotations, rewrite: r.feedback.rewrite, checklist: r.feedback.checklist,
      provider: r.provider, model: r.model, promptVersion: r.promptVersion,
    });
    await tx.insert(writingFeedbackDebug).values({
      submissionId, rawOutput: r.raw, provider: r.provider, model: r.model, promptVersion: r.promptVersion,
    });
    const done = await tx.update(writingSubmission)
      .set({ status: "completed", updatedAt: new Date() })
      .where(and(eq(writingSubmission.id, submissionId), eq(writingSubmission.status, "evaluating")))
      .returning({ id: writingSubmission.id });
    if (done.length !== 1) throw new Error("submission no longer evaluating (reaped) — rolling back feedback");
  });
}

export async function markFailed(submissionId: string): Promise<void> {
  await db.update(writingSubmission).set({ status: "failed", updatedAt: new Date() }).where(eq(writingSubmission.id, submissionId));
}

export async function readOwnSubmission(userId: string, submissionId: string): Promise<{ status: "pending" | "evaluating" | "completed" | "failed"; updatedAt: Date } | null> {
  const [row] = await db.select({ status: writingSubmission.status, updatedAt: writingSubmission.updatedAt })
    .from(writingSubmission)
    .where(and(eq(writingSubmission.id, submissionId), eq(writingSubmission.userId, userId)));
  return row ?? null;
}

function dayStart(now: Date): Date { return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())); }
export async function completedCounts(userId: string, now: Date): Promise<{ lifetime: number; today: number }> {
  const [[life], [tod]] = await Promise.all([
    db.select({ n: count() }).from(writingSubmission).where(and(eq(writingSubmission.userId, userId), eq(writingSubmission.status, "completed"))),
    db.select({ n: count() }).from(writingSubmission).where(and(eq(writingSubmission.userId, userId), eq(writingSubmission.status, "completed"), gte(writingSubmission.createdAt, dayStart(now)))),
  ]);
  return { lifetime: life?.n ?? 0, today: tod?.n ?? 0 };
}

// Fire-and-forget trigger. Idempotent via the claim, so re-firing (lost-trigger
// re-kick or reaper) is safe. No origin/secret → stays pending, re-kicked on poll.
export function triggerEvaluate(submissionId: string): void {
  const origin = siteUrl();
  const secret = writingInternalSecret();
  if (!origin || !secret) return;
  after(async () => {
    try {
      await fetch(`${origin}/api/writing/evaluate`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
        body: JSON.stringify({ submissionId }),
      });
    } catch (e) { console.error("triggerEvaluate fetch failed", submissionId, e); }
  });
}
```

Note: confirm `onConflictDoNothing` with a partial-index `target`+`where` matches how `ensureAttempt` (0007) does it; `numeric` columns take string on insert (like `attempt.bandScore`).

- [ ] **Step 4: Run test — PASS** (`npx vitest run src/lib/writing/store.test.ts`)

- [ ] **Step 5: Commit**

```bash
git add src/lib/writing/store.ts src/lib/writing/store.test.ts
git commit -m "feat(writing): owner-path store — guarded insert/claim/persist, counts, trigger"
```

---

## Task 4: Internal idempotent evaluate route

**Files:** Create `app/api/writing/evaluate/route.ts`; Test `app/api/writing/evaluate/route.test.ts`.

- [ ] **Step 1: Write the failing test (mock store + evaluator + auth)**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
const claim = vi.fn(), persist = vi.fn(), fail = vi.fn(), evaluate = vi.fn(), load = vi.fn();
vi.mock("@/lib/writing/store", () => ({ claimForEvaluation: claim, persistFeedback: persist, markFailed: fail, loadSubmissionForEval: load }));
vi.mock("@/lib/writing/evaluator", () => ({ getEvaluator: () => ({ evaluate }) }));
vi.mock("@/env", () => ({ writingInternalSecret: () => "s3cret" }));
vi.mock("@/lib/cron-auth", () => ({ isCronAuthorized: (h: string | null, s: string | null) => h === `Bearer ${s}` }));
import { POST } from "./route";
const req = (auth: string | null, body: object) => new Request("http://x", { method: "POST", headers: auth ? { authorization: auth } : {}, body: JSON.stringify(body) });
beforeEach(() => [claim, persist, fail, evaluate, load].forEach((m) => m.mockReset()));

describe("POST /api/writing/evaluate", () => {
  it("401 without secret, no claim", async () => {
    expect((await POST(req(null, { submissionId: "s1" }))).status).toBe(401);
    expect(claim).not.toHaveBeenCalled();
  });
  it("200 no-op on lost claim", async () => {
    claim.mockResolvedValue(false);
    await POST(req("Bearer s3cret", { submissionId: "s1" }));
    expect(evaluate).not.toHaveBeenCalled();
  });
  it("evaluates + persists on won claim", async () => {
    claim.mockResolvedValue(true); load.mockResolvedValue({ essay: "e", taskPrompt: "t", category: "academic" });
    evaluate.mockResolvedValue({ feedback: {}, raw: "{}", provider: "gemini", model: "m", promptVersion: "v1" });
    await POST(req("Bearer s3cret", { submissionId: "s1" }));
    expect(persist).toHaveBeenCalledWith("s1", expect.any(Object));
  });
  it("marks failed when evaluate throws", async () => {
    claim.mockResolvedValue(true); load.mockResolvedValue({ essay: "e", taskPrompt: "t", category: "academic" });
    evaluate.mockRejectedValue(new Error("boom"));
    await POST(req("Bearer s3cret", { submissionId: "s1" }));
    expect(fail).toHaveBeenCalledWith("s1"); expect(persist).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test — FAIL**

- [ ] **Step 3: Write `route.ts`**

```ts
import { NextResponse } from "next/server";
import { writingInternalSecret } from "@/env";
import { isCronAuthorized } from "@/lib/cron-auth";
import { getEvaluator } from "@/lib/writing/evaluator";
import { claimForEvaluation, loadSubmissionForEval, persistFeedback, markFailed } from "@/lib/writing/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isCronAuthorized(request.headers.get("authorization"), writingInternalSecret())) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const { submissionId } = (await request.json().catch(() => ({}))) as { submissionId?: string };
  if (!submissionId) return NextResponse.json({ ok: false }, { status: 400 });

  if (!(await claimForEvaluation(submissionId))) return NextResponse.json({ ok: true, claimed: false }, { status: 200 });

  try {
    const input = await loadSubmissionForEval(submissionId);
    if (!input) { await markFailed(submissionId); return NextResponse.json({ ok: false, error: "submission_gone" }, { status: 200 }); }
    await persistFeedback(submissionId, await getEvaluator().evaluate(input));
    return NextResponse.json({ ok: true, claimed: true }, { status: 200 });
  } catch (e) {
    console.error("writing evaluate failed", submissionId, e);
    await markFailed(submissionId); // preview/cap NOT consumed — only 'completed' counts
    return NextResponse.json({ ok: false, error: "eval_failed" }, { status: 200 });
  }
}
```

- [ ] **Step 4: Run test — PASS**

- [ ] **Step 5: Commit**

```bash
git add app/api/writing/evaluate/route.ts app/api/writing/evaluate/route.test.ts
git commit -m "feat(writing): internal idempotent evaluate route"
```

---

## Task 5: Server actions — create + poll (re-kick + reaper)

**Files:** Create `app/app/writing/actions.ts`; Test `app/app/writing/actions.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
const getUser = vi.fn(), getProfile = vi.fn(), counts = vi.fn(), insert = vi.fn(), trigger = vi.fn();
vi.mock("@/lib/auth", () => ({ getUser, getProfile }));
vi.mock("@/lib/writing/store", () => ({ completedCounts: counts, insertPendingSubmission: insert, triggerEvaluate: trigger, readOwnSubmission: vi.fn(), markFailed: vi.fn() }));
vi.mock("@/env", () => ({ writingEvalConfig: () => ({ apiKey: "k", model: "m" }) }));
import { createWritingSubmission } from "./actions";
beforeEach(() => [getUser, getProfile, counts, insert, trigger].forEach((m) => m.mockReset()));

describe("createWritingSubmission", () => {
  it("blocks over-preview non-Ultra without insert", async () => {
    getUser.mockResolvedValue({ id: "u1" }); getProfile.mockResolvedValue({ tier: "basic", premium_until: null }); counts.mockResolvedValue({ lifetime: 1, today: 0 });
    expect(await createWritingSubmission({ taskId: "t1", essay: Array(30).fill("w").join(" ") })).toEqual({ ok: false, reason: "preview_used" });
    expect(insert).not.toHaveBeenCalled();
  });
  it("blocks too-long essay before any DB work", async () => {
    getUser.mockResolvedValue({ id: "u1" });
    expect(await createWritingSubmission({ taskId: "t1", essay: Array(2000).fill("w").join(" ") })).toEqual({ ok: false, reason: "too_long" });
    expect(getProfile).not.toHaveBeenCalled();
  });
  it("surfaces in_progress when the active-index conflict yields null", async () => {
    getUser.mockResolvedValue({ id: "u1" }); getProfile.mockResolvedValue({ tier: "ultra", premium_until: null }); counts.mockResolvedValue({ lifetime: 0, today: 0 }); insert.mockResolvedValue(null);
    expect(await createWritingSubmission({ taskId: "t1", essay: Array(30).fill("w").join(" ") })).toEqual({ ok: false, reason: "in_progress" });
  });
  it("inserts + triggers for an allowed user", async () => {
    getUser.mockResolvedValue({ id: "u1" }); getProfile.mockResolvedValue({ tier: "ultra", premium_until: null }); counts.mockResolvedValue({ lifetime: 5, today: 0 }); insert.mockResolvedValue("sub1");
    expect(await createWritingSubmission({ taskId: "t1", essay: Array(30).fill("w").join(" ") })).toEqual({ ok: true, submissionId: "sub1" });
    expect(trigger).toHaveBeenCalledWith("sub1");
  });
});
```

- [ ] **Step 2: Run test — FAIL**

- [ ] **Step 3: Write `actions.ts`**

```ts
"use server";

import { getProfile, getUser } from "@/lib/auth";
import { writingEvalConfig } from "@/env";
import { effectiveTier, type Tier } from "@/lib/tiers";
import { canEvaluate, validateEssay, isStuckEvaluating, WRITING_STALE_MS } from "@/lib/writing/lifecycle";
import { completedCounts, insertPendingSubmission, triggerEvaluate, readOwnSubmission, markFailed } from "@/lib/writing/store";

type CreateResult =
  | { ok: true; submissionId: string }
  | { ok: false; reason: "auth" | "too_short" | "too_long" | "not_configured" | "preview_used" | "daily_cap" | "in_progress" };

export async function createWritingSubmission(input: { taskId: string; essay: string }): Promise<CreateResult> {
  const user = await getUser();
  if (!user) return { ok: false, reason: "auth" };

  const essay = validateEssay(input.essay);   // size bounds BEFORE any DB/spend
  if (!essay.ok) return { ok: false, reason: essay.reason };

  const profile = await getProfile();
  const tier: Tier = profile ? effectiveTier(profile as { tier: Tier; premium_until: string | Date | null }) : "basic";
  const now = new Date();
  const { lifetime, today } = await completedCounts(user.id, now);

  const gate = canEvaluate({ configured: writingEvalConfig() !== null, tier, lifetimeCompleted: lifetime, todayCompleted: today });
  if (!gate.allowed) return { ok: false, reason: gate.reason };

  // 0024 one-active index: null = user already has a pending/evaluating submission.
  const submissionId = await insertPendingSubmission(user.id, input.taskId, input.essay.trim(), essay.wordCount);
  if (!submissionId) return { ok: false, reason: "in_progress" };

  triggerEvaluate(submissionId);
  return { ok: true, submissionId };
}

// Poll: owner-read. Re-kick a stuck pending (lost trigger — idempotent via claim).
// Reap a stuck evaluating to failed. Retry after failed = a NEW createWritingSubmission.
export async function getSubmissionStatus(submissionId: string): Promise<{ status: "pending" | "evaluating" | "completed" | "failed" } | null> {
  const user = await getUser();
  if (!user) return null;
  const row = await readOwnSubmission(user.id, submissionId);
  if (!row) return null;

  if (row.status === "pending") {
    triggerEvaluate(submissionId); // safety net if the original after()+fetch was lost
    return { status: "pending" };
  }
  if (row.status === "evaluating" && isStuckEvaluating(row.updatedAt, new Date(), WRITING_STALE_MS)) {
    await markFailed(submissionId);
    return { status: "failed" };
  }
  return { status: row.status };
}
```

- [ ] **Step 4: Run test — PASS**

- [ ] **Step 5: Commit**

```bash
git add app/app/writing/actions.ts app/app/writing/actions.test.ts
git commit -m "feat(writing): create + poll actions — gate, size bounds, re-kick, reaper"
```

---

## Task 6: Middleware exclusion for the internal route

**Files:** Modify `src/middleware.ts` (or `middleware.ts` at root — locate it).

- [ ] **Step 1: Exclude `/api/writing` from the auth-session middleware**

Find the middleware `matcher` / early-return that already excludes `/api/cron` and `/api/telegram` (internal routes that authenticate themselves). Add `/api/writing` to the same exclusion so the server→route fetch isn't intercepted by the user-session redirect. Mirror the existing exclusion exactly (matcher regex or the `pathname.startsWith` guard — whichever the project uses).

- [ ] **Step 2: Verify it doesn't break existing auth**

Run: `npx tsc --noEmit` → exit 0.
Run: `npx vitest run` → existing suite green (middleware has no unit test in-project; correctness confirmed by the matcher mirroring cron/telegram).

- [ ] **Step 3: Commit**

```bash
git add src/middleware.ts
git commit -m "feat(writing): exclude internal /api/writing from auth-session middleware"
```

---

## Task 7: Full gate

- [ ] **Step 1: Whole suite + types + DB gate**

Run: `npx vitest run` → all green (lifecycle 8, store 2, route 4, actions 4 + existing).
Run: `npx tsc --noEmit` → exit 0.
Run: `npm run verify` → 22 tables, migrations through 0024 apply + roundtrip, RLS intact.

- [ ] **Step 2: Commit any wiring fixups**

```bash
git add -A && git commit -m "test(writing): pipeline suite green end-to-end"
```

---

## Self-Review (plan author)

- **Adversarial findings closed:** preview-farm → 0024 unique index + `in_progress` surfacing (Tasks 0,3,5); MAX_WORDS → `validateEssay` (Task 2); reaped-row resurrection → status-guarded `persistFeedback` rollback (Task 3); lost-trigger pending → poll re-kick + idempotent claim (Tasks 3,5); middleware → Task 6; retry-model → explicit ("retry = new submission", Task 5 comment). ✅
- **Spec coverage:** async-flow A, idempotent claim, reaper, internal route, gates (Ultra + 1 lifetime preview + soft cap), preview only on `completed`, raw server-only — all mapped. ✅
- **Defense-in-depth:** 0024 also REVOKEs client write-grants on writing tables (RLS already denies; second layer). Project-wide REVOKE on other owner-scoped tables remains a separate decision. ✅
- **Out of scope (Plan 4):** UI/admin/catalog. Actions return plain discriminated results for the UI.
- **Honesty:** Vercel `after()`+fetch flagged VERIFY, with the always-present poll re-kick as the structural fallback. Drizzle `onConflictDoNothing` partial-target + numeric-as-string noted as wiring confirms.
- **Prod step:** apply 0024 to Supabase (up only) before enabling — like 0023.
