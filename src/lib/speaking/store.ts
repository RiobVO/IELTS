import { after } from "next/server";
import { and, count, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { speakingSubmission, speakingFeedback, speakingFeedbackDebug, speakingTask } from "@/db/schema";
import { speakingInternalSecret, publicSiteUrl } from "@/env";
import { logError } from "@/lib/monitoring/log-error";
import { logAudioEvent } from "./events";
import type { EvaluateResult } from "./evaluator";
import type { TranscriptTiming } from "./transcript-align";

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

// Pre-insert gate read (createSpeakingSubmission): the cue-card must be published and
// the user's tier must meet task.tier_required. Owner-path — the server action is the
// trust boundary, not the catalog UI. Null when no task matches the id (callers screen
// the id with isUuid first so it can't 22P02 the query).
export async function loadSpeakingTaskForSubmissionGate(
  taskId: string,
): Promise<{ status: "draft" | "published"; tierRequired: "basic" | "premium" | "ultra" } | null> {
  const [row] = await db
    .select({ status: speakingTask.status, tierRequired: speakingTask.tierRequired })
    .from(speakingTask)
    .where(eq(speakingTask.id, taskId));
  return row ?? null;
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
export async function persistFeedback(
  submissionId: string, r: EvaluateResult, timings: TranscriptTiming[] = [],
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(speakingFeedback).values({
      submissionId,
      bandLow: String(r.feedback.bandLow),
      bandHigh: String(r.feedback.bandHigh),
      confidence: r.feedback.confidence,
      criteria: r.feedback.criteria,
      transcript: r.feedback.transcript,
      annotations: r.feedback.annotations,
      transcriptTimings: timings,
      rewrites: r.feedback.rewrites,
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

// Status-guarded (#16): only a still-transient row may be failed, so a slow eval that
// just committed 'completed' isn't overwritten completed→failed by a racing reaper/poll
// (would lose feedback + undercount the preview). Mirrors persistFeedback's guarded flip.
export async function markFailed(submissionId: string): Promise<void> {
  await db.update(speakingSubmission).set({ status: "failed", updatedAt: new Date() })
    .where(
      and(
        eq(speakingSubmission.id, submissionId),
        inArray(speakingSubmission.status, ["uploading", "pending", "evaluating"]),
      ),
    );
}

// Fail transient rows (uploading|pending|evaluating) older than staleBefore so the
// one-active index (0028) unblocks. userId → reap-own-stale on create (a returning
// user unblocks immediately instead of waiting up to ~24h for the daily reaper — #5).
// Audio of the failed row is left for the retention reaper (no cleanup here). Mirrors
// writing/store.ts failStaleSubmissions.
export async function failStaleSubmissions(staleBefore: Date, userId?: string): Promise<number> {
  const active = inArray(speakingSubmission.status, ["uploading", "pending", "evaluating"]);
  const stale = lt(speakingSubmission.updatedAt, staleBefore);
  const where = userId
    ? and(active, stale, eq(speakingSubmission.userId, userId))
    : and(active, stale);
  const rows = await db
    .update(speakingSubmission)
    .set({ status: "failed", updatedAt: new Date() })
    .where(where)
    .returning({ id: speakingSubmission.id });
  return rows.length;
}

// A failed audio-object remove (user delete or retention reaper): keep the row
// retryable — do NOT set audio_deleted_at — but bump the attempt count + record the
// last error so the miss is observable (0032). The next reaper pass retries it.
export async function markAudioDeleteFailed(submissionId: string, error: string): Promise<void> {
  await db.update(speakingSubmission)
    .set({
      audioDeleteAttempts: sql`${speakingSubmission.audioDeleteAttempts} + 1`,
      audioDeleteError: error.slice(0, 500),
      updatedAt: new Date(),
    })
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

// Rate-throttle count (N3, зеркало Writing #21): ВСЕ статусы, включая failed —
// провал не тратит preview/cap, и именно его гоняет retry-цикл. Использует
// speaking_submission_user_created_idx (user_id, created_at).
export async function countRecentSubmissions(userId: string, since: Date): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(speakingSubmission)
    .where(and(eq(speakingSubmission.userId, userId), gte(speakingSubmission.createdAt, since)));
  return row?.n ?? 0;
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
      // Submission виснет в pending, если этот fetch не долетел — важный сигнал.
      await logError({
        source: "server",
        message: "triggerEvaluate (speaking) failed",
        stack: e instanceof Error ? e.stack : null,
        context: { op: "speakingTriggerEvaluate", submissionId },
      });
    }
  });
}
