import { after } from "next/server";
import { and, count, eq, gte, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { speakingSubmission, speakingFeedback, speakingFeedbackDebug, speakingTask } from "@/db/schema";
import { speakingInternalSecret, publicSiteUrl } from "@/env";
import { logAudioEvent } from "./events";
import type { EvaluateResult } from "./evaluator";

// Insert an 'uploading' row guarded by the 0028 one-active index. The id is needed
// to build the audio path BEFORE upload (id-first contract). On conflict → null.
export async function insertUploadingSubmission(
  userId: string,
  taskId: string,
  audioPath: string,
): Promise<string | null> {
  const rows = await db
    .insert(speakingSubmission)
    .values({ userId, taskId, audioPath, status: "uploading" })
    .onConflictDoNothing({
      target: speakingSubmission.userId,
      where: sql`${speakingSubmission.status} in ('uploading','pending','evaluating')`,
    })
    .returning({ id: speakingSubmission.id });
  return rows[0]?.id ?? null;
}

// uploading → pending once the object is confirmed present + within size. Single-fire.
export async function markUploaded(submissionId: string): Promise<boolean> {
  const rows = await db
    .update(speakingSubmission)
    .set({ status: "pending", updatedAt: new Date() })
    .where(and(eq(speakingSubmission.id, submissionId), eq(speakingSubmission.status, "uploading")))
    .returning({ id: speakingSubmission.id });
  return rows.length === 1;
}

// Atomic single-fire claim — only the pending→evaluating winner evaluates.
export async function claimForEvaluation(submissionId: string): Promise<boolean> {
  const rows = await db
    .update(speakingSubmission)
    .set({ status: "evaluating", updatedAt: new Date() })
    .where(and(eq(speakingSubmission.id, submissionId), eq(speakingSubmission.status, "pending")))
    .returning({ id: speakingSubmission.id });
  return rows.length === 1;
}

// Load for eval + the biometric guards. Returns null-ish if the row is gone, the audio
// was deleted (terminal — do NOT retry), or a delete was requested (abort, no transcript).
export async function loadSubmissionForEval(submissionId: string): Promise<
  | { ok: true; audioPath: string; cueCard: { prompt: string; bullets: string[]; closingPrompt: string } }
  | { ok: false; reason: "gone" | "audio_deleted" | "delete_requested" }
> {
  const [row] = await db
    .select({
      audioPath: speakingSubmission.audioPath,
      audioDeletedAt: speakingSubmission.audioDeletedAt,
      deleteRequestedAt: speakingSubmission.deleteRequestedAt,
      prompt: speakingTask.prompt,
      bullets: speakingTask.bullets,
      closingPrompt: speakingTask.closingPrompt,
    })
    .from(speakingSubmission)
    .innerJoin(speakingTask, eq(speakingTask.id, speakingSubmission.taskId))
    .where(eq(speakingSubmission.id, submissionId));
  if (!row) return { ok: false, reason: "gone" };
  if (row.audioDeletedAt) return { ok: false, reason: "audio_deleted" };
  if (row.deleteRequestedAt) return { ok: false, reason: "delete_requested" };
  return {
    ok: true,
    audioPath: row.audioPath,
    cueCard: { prompt: row.prompt, bullets: row.bullets as string[], closingPrompt: row.closingPrompt },
  };
}

// Persist snapshot + raw and flip to completed, ONLY if still 'evaluating' AND no
// delete was requested mid-eval (re-checked in the guarded UPDATE). 0 rows → throw →
// roll back (reaped or user-deleted in-flight) so no orphan feedback / no transcript.
export async function persistFeedback(submissionId: string, r: EvaluateResult): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(speakingFeedback).values({
      submissionId,
      bandLow: String(r.feedback.bandLow),
      bandHigh: String(r.feedback.bandHigh),
      confidence: r.feedback.confidence,
      criteria: r.feedback.criteria,
      transcript: r.feedback.transcript,
      annotations: r.feedback.annotations,
      topFixes: r.feedback.topFixes,
      drills: r.feedback.drills,
      provider: r.provider,
      model: r.model,
      promptVersion: r.promptVersion,
    });
    await tx.insert(speakingFeedbackDebug).values({
      submissionId, rawOutput: r.raw, provider: r.provider, model: r.model, promptVersion: r.promptVersion,
    });
    const done = await tx
      .update(speakingSubmission)
      .set({ status: "completed", updatedAt: new Date() })
      .where(and(
        eq(speakingSubmission.id, submissionId),
        eq(speakingSubmission.status, "evaluating"),
        isNull(speakingSubmission.deleteRequestedAt),
      ))
      .returning({ id: speakingSubmission.id });
    if (done.length !== 1) throw new Error("submission reaped or delete-requested — rolling back feedback");
  });
}

export async function markFailed(submissionId: string): Promise<void> {
  await db.update(speakingSubmission).set({ status: "failed", updatedAt: new Date() })
    .where(eq(speakingSubmission.id, submissionId));
}

// Mark audio gone after a successful eval (retention) or a user delete. Writes the
// reason + audit event; the actual object removal happens in the caller (storage).
export async function markAudioDeleted(
  submissionId: string, userId: string | null, reason: "user" | "retention" | "account",
): Promise<void> {
  await db.update(speakingSubmission)
    .set({ audioDeletedAt: new Date(), audioDeletedReason: reason, updatedAt: new Date() })
    .where(eq(speakingSubmission.id, submissionId));
  await logAudioEvent(
    userId,
    submissionId,
    reason === "user" ? "deleted_user" : reason === "retention" ? "deleted_retention" : "deleted_account",
  );
}

function dayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
export async function completedCounts(userId: string, now: Date): Promise<{ lifetime: number; today: number }> {
  const [[life], [tod]] = await Promise.all([
    db.select({ n: count() }).from(speakingSubmission)
      .where(and(eq(speakingSubmission.userId, userId), eq(speakingSubmission.status, "completed"))),
    db.select({ n: count() }).from(speakingSubmission)
      .where(and(eq(speakingSubmission.userId, userId), eq(speakingSubmission.status, "completed"),
        gte(speakingSubmission.createdAt, dayStart(now)))),
  ]);
  return { lifetime: life?.n ?? 0, today: tod?.n ?? 0 };
}

export async function readOwnSubmission(userId: string, submissionId: string): Promise<
  { status: "uploading" | "pending" | "evaluating" | "completed" | "failed"; updatedAt: Date } | null
> {
  const [row] = await db
    .select({ status: speakingSubmission.status, updatedAt: speakingSubmission.updatedAt })
    .from(speakingSubmission)
    .where(and(eq(speakingSubmission.id, submissionId), eq(speakingSubmission.userId, userId)));
  return row ?? null;
}

// Fire-and-forget via after() (keeps the serverless invocation alive). Idempotent
// via the claim. NEXT_PUBLIC_SITE_URL must NOT be Sensitive or this silently no-ops.
export function triggerEvaluate(submissionId: string): void {
  const origin = publicSiteUrl();
  const secret = speakingInternalSecret();
  if (!origin || !secret) return;
  after(async () => {
    try {
      await fetch(`${origin}/api/speaking/evaluate`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
        body: JSON.stringify({ submissionId }),
      });
    } catch (e) {
      console.error("triggerEvaluate (speaking) failed", submissionId, e);
    }
  });
}
