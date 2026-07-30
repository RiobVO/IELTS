# Writing Lab — Data Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the 4 Writing Lab tables (`writing_task`, `writing_submission`, `writing_feedback`, `writing_feedback_debug`) with up/down migration, Drizzle schema, and RLS — the data foundation for the AI Writing evaluator (Phase 3 unfreeze, spec `docs/superpowers/specs/2026-06-25-writing-lab-design.md`).

**Architecture:** One new migration `0023_writing_lab` follows the project's hand-authored up/down SQL pattern. RLS mirrors existing tables exactly: `writing_task` is published-gated (like `content_item`), `writing_submission`/`writing_feedback` are owner-read (like `annotation`), and `writing_feedback_debug` is HARD-LOCKED (like `answer_key` — grants revoked, raw model output never reaches the client). `schema.ts` is kept in lockstep. R/L grading is untouched — these are additive tables.

**Tech Stack:** Postgres 16, Drizzle ORM, custom up/down migrator (`scripts/migrate.ts`), `npm run verify` acceptance gate (local docker).

**Scope:** This plan is data only — no evaluator, no route, no UI (those are Plans 2-4). Done = `npm run verify` green with 22 tables, RLS proven, down/up reversible.

---

## File Structure

- Create: `migrations/0023_writing_lab/up.sql` — enums + 4 tables + indexes + RLS.
- Create: `migrations/0023_writing_lab/down.sql` — reverse drop (tables then types).
- Modify: `src/db/schema.ts` — add 3 enums + 4 `pgTable` definitions (append after `payment`).
- Modify: `scripts/verify.ts` — bump `APP_TABLE_COUNT` 18 → 22.

**Naming (locked — used across all tasks):**
- Enums: `writing_category('academic','general')`, `writing_task_status('draft','published')`, `writing_submission_status('pending','evaluating','completed','failed')`, `writing_confidence('low','medium','high')`.
- Tables: `writing_task`, `writing_submission`, `writing_feedback`, `writing_feedback_debug`.
- Drizzle exports: `writingCategory`, `writingTaskStatus`, `writingSubmissionStatus`, `writingConfidence`, `writingTask`, `writingSubmission`, `writingFeedback`, `writingFeedbackDebug`.

---

## Task 1: Migration scaffold + enums + `writing_task` (published-gated)

**Files:**
- Create: `migrations/0023_writing_lab/up.sql`
- Modify: `src/db/schema.ts` (append enums + `writingTask`)

- [ ] **Step 1: Write `up.sql` — header, enums, `writing_task` table + RLS**

Create `migrations/0023_writing_lab/up.sql`:

```sql
-- 0023_writing_lab :: up
-- Phase 3 unfreeze (Writing Lab, Task 2 MVP). Four additive tables for AI essay
-- evaluation. Core Reading/Listening grading/import stays LLM-free and untouched.
-- RLS mirrors existing tables: writing_task is published-gated (like content_item),
-- submission/feedback are owner-read (like annotation), and writing_feedback_debug
-- is hard-locked (like answer_key) so raw model output never reaches the client.
-- Tables 19-22 (see SCHEMA_NOTES.md "Phase 3 Writing").

CREATE TYPE writing_category          AS ENUM ('academic', 'general');
CREATE TYPE writing_task_status       AS ENUM ('draft', 'published');
CREATE TYPE writing_submission_status AS ENUM ('pending', 'evaluating', 'completed', 'failed');
CREATE TYPE writing_confidence        AS ENUM ('low', 'medium', 'high');

-- writing_task: admin-authored essay prompt. Published-gated like content_item;
-- drafts are read via the owner-path (admin), never the anon/authenticated client.
CREATE TABLE writing_task (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category      writing_category NOT NULL,
  prompt        text NOT NULL,
  tier_required user_tier NOT NULL DEFAULT 'ultra',   -- AI = Ultra (BRIEF §4.8)
  status        writing_task_status NOT NULL DEFAULT 'draft',
  created_by    uuid REFERENCES profile(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX writing_task_status_idx ON writing_task (status, category);

ALTER TABLE writing_task ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON writing_task TO authenticated;
GRANT ALL ON writing_task TO service_role;
CREATE POLICY writing_task_select_published ON writing_task
  FOR SELECT TO authenticated USING (status = 'published');
```

- [ ] **Step 2: Add enums + `writingTask` to `schema.ts`**

Append to `src/db/schema.ts` (after the `payment` table). Match the existing `pgEnum`/`pgTable` style:

```ts
/* -------------------------------------------------------------------------- */
/* Writing Lab (Phase 3) — AI essay evaluation tables                          */
/* -------------------------------------------------------------------------- */
export const writingCategory = pgEnum("writing_category", ["academic", "general"]);
export const writingTaskStatus = pgEnum("writing_task_status", ["draft", "published"]);
export const writingSubmissionStatus = pgEnum("writing_submission_status", [
  "pending",
  "evaluating",
  "completed",
  "failed",
]);
export const writingConfidence = pgEnum("writing_confidence", ["low", "medium", "high"]);

export const writingTask = pgTable(
  "writing_task",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    category: writingCategory("category").notNull(),
    prompt: text("prompt").notNull(),
    tierRequired: userTier("tier_required").notNull().default("ultra"),
    status: writingTaskStatus("status").notNull().default("draft"),
    createdBy: uuid("created_by").references(() => profile.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("writing_task_status_idx").on(t.status, t.category)],
);
```

- [ ] **Step 3: Run the verify gate**

Run: `npm run verify`
Expected: PASS — gate drops/recreates `public`, applies all migrations through `0018`, `writing_task` exists with RLS enabled. (Requires local docker DB: `npm run docker:db` first if not running.)

- [ ] **Step 4: Commit**

```bash
git add migrations/0023_writing_lab/up.sql src/db/schema.ts
git commit -m "feat(writing): add writing_task table + enums (Phase 3 data foundation)"
```

---

## Task 2: `writing_submission` (owner-read, status lifecycle)

**Files:**
- Modify: `migrations/0023_writing_lab/up.sql` (append table + RLS)
- Modify: `src/db/schema.ts` (append `writingSubmission`)

- [ ] **Step 1: Append `writing_submission` to `up.sql`**

Add to `migrations/0023_writing_lab/up.sql` (after the `writing_task` RLS block):

```sql
-- writing_submission: a user's essay attempt. Owner-read like annotation; writes
-- go through the owner-path server action (no insert/update grant). updated_at
-- drives the reaper: a row stuck in 'evaluating' past a threshold is failed.
CREATE TABLE writing_submission (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES profile(id) ON DELETE CASCADE,
  task_id    uuid NOT NULL REFERENCES writing_task(id) ON DELETE CASCADE,
  essay_text text NOT NULL,
  word_count integer NOT NULL,
  status     writing_submission_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX writing_submission_user_created_idx ON writing_submission (user_id, created_at);
-- Reaper scan: find rows stuck in a non-terminal state by age.
CREATE INDEX writing_submission_status_updated_idx ON writing_submission (status, updated_at);

ALTER TABLE writing_submission ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON writing_submission TO authenticated;
GRANT ALL ON writing_submission TO service_role;
CREATE POLICY writing_submission_select_own ON writing_submission
  FOR SELECT TO authenticated USING (user_id = auth.uid());
```

- [ ] **Step 2: Append `writingSubmission` to `schema.ts`**

```ts
export const writingSubmission = pgTable(
  "writing_submission",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profile.id, { onDelete: "cascade" }),
    taskId: uuid("task_id")
      .notNull()
      .references(() => writingTask.id, { onDelete: "cascade" }),
    essayText: text("essay_text").notNull(),
    wordCount: integer("word_count").notNull(),
    status: writingSubmissionStatus("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("writing_submission_user_created_idx").on(t.userId, t.createdAt),
    index("writing_submission_status_updated_idx").on(t.status, t.updatedAt),
  ],
);
```

- [ ] **Step 3: Run the verify gate**

Run: `npm run verify`
Expected: PASS — `writing_submission` exists, owner-read RLS policy present, FK to `writing_task` resolves.

- [ ] **Step 4: Commit**

```bash
git add migrations/0023_writing_lab/up.sql src/db/schema.ts
git commit -m "feat(writing): add writing_submission table (owner-read, status lifecycle)"
```

---

## Task 3: `writing_feedback` (owner-read via submission) + `writing_feedback_debug` (LOCKED)

**Files:**
- Modify: `migrations/0023_writing_lab/up.sql` (append both tables + RLS)
- Modify: `src/db/schema.ts` (append `writingFeedback`, `writingFeedbackDebug`)

- [ ] **Step 1: Append both tables to `up.sql`**

Add to `migrations/0023_writing_lab/up.sql` (after the `writing_submission` RLS block):

```sql
-- writing_feedback: the user-visible snapshot of the analysis. Owner-read THROUGH
-- the submission (EXISTS join, like passage→content_item). One row per submission.
-- Does NOT hold raw model output (that lives in writing_feedback_debug).
CREATE TABLE writing_feedback (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id  uuid NOT NULL UNIQUE REFERENCES writing_submission(id) ON DELETE CASCADE,
  band_low       numeric(2,1) NOT NULL,
  band_high      numeric(2,1) NOT NULL,
  confidence     writing_confidence NOT NULL,
  criteria       jsonb NOT NULL,
  top_fixes      jsonb NOT NULL,
  annotations    jsonb NOT NULL,
  rewrite        jsonb NOT NULL,
  checklist      jsonb NOT NULL,
  provider       text NOT NULL,
  model          text NOT NULL,
  prompt_version text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE writing_feedback ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON writing_feedback TO authenticated;
GRANT ALL ON writing_feedback TO service_role;
CREATE POLICY writing_feedback_select_own ON writing_feedback
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM writing_submission s
    WHERE s.id = writing_feedback.submission_id AND s.user_id = auth.uid()
  ));

-- writing_feedback_debug: raw model output for calibration/debugging. HARD-LOCKED
-- like answer_key — RLS on, NO anon/authenticated policy, grants revoked. Raw may
-- carry prompt-leakage / model reasoning; only the owner-path (Drizzle) reads it.
CREATE TABLE writing_feedback_debug (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id  uuid NOT NULL REFERENCES writing_submission(id) ON DELETE CASCADE,
  raw_output     text NOT NULL,
  provider       text NOT NULL,
  model          text NOT NULL,
  prompt_version text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX writing_feedback_debug_submission_idx ON writing_feedback_debug (submission_id);

ALTER TABLE writing_feedback_debug ENABLE ROW LEVEL SECURITY;
GRANT ALL ON writing_feedback_debug TO service_role;
REVOKE ALL ON writing_feedback_debug FROM anon, authenticated, PUBLIC;
```

- [ ] **Step 2: Append both tables to `schema.ts`**

```ts
export const writingFeedback = pgTable("writing_feedback", {
  id: uuid("id").defaultRandom().primaryKey(),
  submissionId: uuid("submission_id")
    .notNull()
    .unique()
    .references(() => writingSubmission.id, { onDelete: "cascade" }),
  bandLow: numeric("band_low", { precision: 2, scale: 1 }).notNull(),
  bandHigh: numeric("band_high", { precision: 2, scale: 1 }).notNull(),
  confidence: writingConfidence("confidence").notNull(),
  criteria: jsonb("criteria").notNull(),
  topFixes: jsonb("top_fixes").notNull(),
  annotations: jsonb("annotations").notNull(),
  rewrite: jsonb("rewrite").notNull(),
  checklist: jsonb("checklist").notNull(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  promptVersion: text("prompt_version").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const writingFeedbackDebug = pgTable(
  "writing_feedback_debug",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => writingSubmission.id, { onDelete: "cascade" }),
    rawOutput: text("raw_output").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("writing_feedback_debug_submission_idx").on(t.submissionId)],
);
```

Note: confirm `numeric` and `jsonb` are imported at the top of `schema.ts` from `drizzle-orm/pg-core` (jsonb is already used by `notification.data`; add `numeric` to the import if missing).

- [ ] **Step 3: Run the verify gate**

Run: `npm run verify`
Expected: PASS — both tables exist; `writing_feedback_debug` has RLS enabled with NO policy and no authenticated grant (locked), `writing_feedback` owner-read policy resolves the submission join.

- [ ] **Step 4: Commit**

```bash
git add migrations/0023_writing_lab/up.sql src/db/schema.ts
git commit -m "feat(writing): add writing_feedback (owner-read) + locked debug table"
```

---

## Task 4: `down.sql` + reversibility roundtrip

**Files:**
- Create: `migrations/0023_writing_lab/down.sql`

- [ ] **Step 1: Write `down.sql` (reverse order — tables then types)**

Create `migrations/0023_writing_lab/down.sql`:

```sql
-- 0023_writing_lab :: down
DROP TABLE IF EXISTS writing_feedback_debug;
DROP TABLE IF EXISTS writing_feedback;
DROP TABLE IF EXISTS writing_submission;
DROP TABLE IF EXISTS writing_task;

DROP TYPE IF EXISTS writing_confidence;
DROP TYPE IF EXISTS writing_submission_status;
DROP TYPE IF EXISTS writing_task_status;
DROP TYPE IF EXISTS writing_category;
```

- [ ] **Step 2: Prove down → up roundtrip on local docker**

Run (against local docker DB only — never Supabase):
```bash
npm run db:migrate    # ensure 0018 up is applied
npm run db:down       # reverts ALL migrations (drops schema) — local only
npm run db:migrate    # re-applies everything including 0018
npm run db:status     # all applied, none pending
```
Expected: each command exits 0; final `db:status` shows `0023_writing_lab` applied, 0 pending. Proves `down.sql` is valid (no dangling type/table) and the migration re-applies cleanly.

- [ ] **Step 3: Commit**

```bash
git add migrations/0023_writing_lab/down.sql
git commit -m "feat(writing): add 0018 down migration (reversible)"
```

---

## Task 5: Bump verify table count

**Files:**
- Modify: `scripts/verify.ts`

- [ ] **Step 1: Update `APP_TABLE_COUNT`**

In `scripts/verify.ts`, find the `APP_TABLE_COUNT` constant (currently `18`) and change it to `22` (4 new Writing Lab tables: `writing_task`, `writing_submission`, `writing_feedback`, `writing_feedback_debug`). Extend the existing inline comment with the Phase 3 additions, mirroring how it documents prior tables.

- [ ] **Step 2: Run the full gate green**

Run: `npm run verify`
Expected: PASS — table-count assertion now expects 22 and matches the live schema. Then:

Run: `npx tsc --noEmit`
Expected: exit 0 — new `schema.ts` exports typecheck.

- [ ] **Step 3: Commit**

```bash
git add scripts/verify.ts
git commit -m "chore(verify): expect 22 tables after Writing Lab data foundation"
```

---

## Self-Review (done by plan author)

- **Spec coverage:** Data-model section of the spec (4 tables, RLS rules, raw server-only, status lifecycle incl. `evaluating`, `updated_at` for reaper) — all mapped to Tasks 1-3. `topic`-stub left untouched per spec decision. ✅
- **Out of scope (later plans):** evaluator/Gemini, route, server actions, admin, UX — Plans 2-4. Migration `0019+` for any extra column surfaces there. ✅
- **Type consistency:** enum/table/export names fixed in "File Structure / Naming" and used identically in every task. `writingSubmission.id` ← `writingFeedback.submissionId` (unique) and `writingFeedbackDebug.submissionId` match. ✅
- **No placeholders:** every step has the actual SQL/TS. The only "find the constant" step (Task 5) names the constant, file, current and target value. ✅
- **Open dependency:** `SCHEMA_NOTES.md` "Phase 3 Writing" note (referenced in up.sql header) — add it when documenting; not code-blocking for this plan.
