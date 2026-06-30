import { after } from "next/server";
import { and, count, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  writingSubmission,
  writingFeedback,
  writingFeedbackDebug,
  writingTask,
} from "@/db/schema";
import { writingInternalSecret, publicSiteUrl } from "@/env";
import type { EvaluateResult } from "@/lib/writing/evaluator";

// Insert pending, guarded by the 0024 one-active index. On conflict (user already
// has a pending|evaluating row) inserts nothing → returns null → caller surfaces it.
// The partial-index predicate is mirrored verbatim (sql fragment, like ensureAttempt
// 0007) so Postgres infers the right index for the ON CONFLICT.
export async function insertPendingSubmission(
  userId: string,
  taskId: string,
  essay: string,
  wordCount: number,
): Promise<string | null> {
  const rows = await db
    .insert(writingSubmission)
    .values({ userId, taskId, essayText: essay, wordCount, status: "pending" })
    .onConflictDoNothing({
      target: writingSubmission.userId,
      where: sql`${writingSubmission.status} in ('pending','evaluating')`,
    })
    .returning({ id: writingSubmission.id });
  return rows[0]?.id ?? null;
}

// Pre-insert gate read (createWritingSubmission): the task must be published and the
// user's tier must meet task.tier_required. Owner-path (RLS-bypassing) — the server
// action is the trust boundary, not the catalog UI. Returns null when no task matches
// the id (callers must screen the id with isUuid first so it can't 22P02 the query).
export async function loadWritingTaskForSubmissionGate(
  taskId: string,
): Promise<{ status: "draft" | "published"; tierRequired: "basic" | "premium" | "ultra" } | null> {
  const [row] = await db
    .select({ status: writingTask.status, tierRequired: writingTask.tierRequired })
    .from(writingTask)
    .where(eq(writingTask.id, taskId));
  return row ?? null;
}

// Atomic single-fire claim — only the pending→evaluating winner evaluates.
export async function claimForEvaluation(submissionId: string): Promise<boolean> {
  const rows = await db
    .update(writingSubmission)
    .set({ status: "evaluating", updatedAt: new Date() })
    .where(and(eq(writingSubmission.id, submissionId), eq(writingSubmission.status, "pending")))
    .returning({ id: writingSubmission.id });
  return rows.length === 1;
}

export async function loadSubmissionForEval(submissionId: string): Promise<{
  essay: string;
  taskPrompt: string;
  category: "academic" | "general";
  taskPart: "task1" | "task2";
  imagePath: string | null;
  wordCount: number;
} | null> {
  const [row] = await db
    .select({
      essay: writingSubmission.essayText,
      taskPrompt: writingTask.prompt,
      category: writingTask.category,
      taskPart: writingTask.taskPart,
      imagePath: writingTask.imagePath,
      wordCount: writingSubmission.wordCount,
    })
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
      bandLow: String(r.feedback.bandLow),
      bandHigh: String(r.feedback.bandHigh),
      confidence: r.feedback.confidence,
      criteria: r.feedback.criteria,
      topFixes: r.feedback.topFixes,
      annotations: r.feedback.annotations,
      rewrite: r.feedback.rewrite,
      checklist: r.feedback.checklist,
      provider: r.provider,
      model: r.model,
      promptVersion: r.promptVersion,
    });
    await tx.insert(writingFeedbackDebug).values({
      submissionId,
      rawOutput: r.raw,
      provider: r.provider,
      model: r.model,
      promptVersion: r.promptVersion,
    });
    const done = await tx
      .update(writingSubmission)
      .set({ status: "completed", updatedAt: new Date() })
      .where(and(eq(writingSubmission.id, submissionId), eq(writingSubmission.status, "evaluating")))
      .returning({ id: writingSubmission.id });
    if (done.length !== 1) throw new Error("submission no longer evaluating (reaped) — rolling back feedback");
  });
}

export async function markFailed(submissionId: string): Promise<void> {
  await db
    .update(writingSubmission)
    .set({ status: "failed", updatedAt: new Date() })
    .where(eq(writingSubmission.id, submissionId));
}

export async function readOwnSubmission(
  userId: string,
  submissionId: string,
): Promise<{ status: "pending" | "evaluating" | "completed" | "failed"; updatedAt: Date } | null> {
  const [row] = await db
    .select({ status: writingSubmission.status, updatedAt: writingSubmission.updatedAt })
    .from(writingSubmission)
    .where(and(eq(writingSubmission.id, submissionId), eq(writingSubmission.userId, userId)));
  return row ?? null;
}

function dayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
export async function completedCounts(
  userId: string,
  now: Date,
): Promise<{ lifetime: number; today: number }> {
  const [[life], [tod]] = await Promise.all([
    db
      .select({ n: count() })
      .from(writingSubmission)
      .where(and(eq(writingSubmission.userId, userId), eq(writingSubmission.status, "completed"))),
    db
      .select({ n: count() })
      .from(writingSubmission)
      .where(
        and(
          eq(writingSubmission.userId, userId),
          eq(writingSubmission.status, "completed"),
          gte(writingSubmission.createdAt, dayStart(now)),
        ),
      ),
  ]);
  return { lifetime: life?.n ?? 0, today: tod?.n ?? 0 };
}

// Fire-and-forget trigger. Idempotent via the claim, so re-firing (lost-trigger
// re-kick or reaper) is safe. No origin/secret → stays pending, re-kicked on poll.
export function triggerEvaluate(submissionId: string): void {
  const origin = publicSiteUrl();
  const secret = writingInternalSecret();
  if (!origin || !secret) return;
  after(async () => {
    try {
      await fetch(`${origin}/api/writing/evaluate`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
        body: JSON.stringify({ submissionId }),
      });
    } catch (e) {
      console.error("triggerEvaluate fetch failed", submissionId, e);
    }
  });
}
