"use server";
import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { speakingSubmission, speakingFeedback, profile } from "@/db/schema";
import { getUser, getProfile } from "@/lib/auth";
import { effectiveTier, type Tier } from "@/lib/tiers";
import { speakingEvalConfig } from "@/env";
import { signedUploadUrl, audioSize, deleteAudio } from "@/lib/speaking/storage";
import { logAudioEvent } from "@/lib/speaking/events";
import {
  insertUploadingSubmission, markUploaded, triggerEvaluate, completedCounts,
  readOwnSubmission, markFailed, markAudioDeleted,
} from "@/lib/speaking/store";
import { canEvaluate, isStuck, SPEAKING_STALE_MS_DEFAULT } from "@/lib/speaking/lifecycle";

const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const staleMs = Number(process.env.SPEAKING_STALE_MS ?? SPEAKING_STALE_MS_DEFAULT);

export async function recordConsent(): Promise<void> {
  const user = await getUser();
  if (!user) throw new Error("unauthorized");
  // profile.recording_consent_at written owner-path (Drizzle), trusted id only —
  // first consent wins (isNull guard keeps the original timestamp).
  await db
    .update(profile)
    .set({ recordingConsentAt: new Date() })
    .where(and(eq(profile.id, user.id), isNull(profile.recordingConsentAt)));
  await logAudioEvent(user.id, null, "consent_given");
}

export async function createSpeakingSubmission(
  taskId: string, ext: "webm" | "m4a",
): Promise<{ submissionId: string; uploadUrl: string } | { error: string }> {
  const user = await getUser();
  if (!user) return { error: "unauthorized" };
  const profileRow = await getProfile();
  if (!profileRow?.recording_consent_at) return { error: "consent_required" };

  const now = new Date();
  const { lifetime, today } = await completedCounts(user.id, now);
  const gate = canEvaluate({
    configured: speakingEvalConfig() !== null,
    tier: effectiveTier(profileRow as { tier: Tier; premium_until: string | Date | null }),
    lifetimeCompleted: lifetime,
    todayCompleted: today,
  });
  if (!gate.allowed) return { error: gate.reason };

  const id = randomUUID();
  const path = `${user.id}/${id}.${ext}`;
  const insertedId = await insertUploadingSubmission(user.id, taskId, path);
  if (!insertedId) return { error: "already_in_progress" };
  // The insert generated its own id; sign the path the row actually holds.
  const [{ audioPath }] = await db
    .select({ audioPath: speakingSubmission.audioPath })
    .from(speakingSubmission).where(eq(speakingSubmission.id, insertedId));
  const { url } = await signedUploadUrl(audioPath);
  return { submissionId: insertedId, uploadUrl: url };
}

export async function markSpeakingUploaded(submissionId: string): Promise<{ ok: boolean; error?: string }> {
  const user = await getUser();
  if (!user) return { ok: false, error: "unauthorized" };
  const own = await readOwnSubmission(user.id, submissionId);
  if (!own) return { ok: false, error: "not_found" };
  const [{ audioPath }] = await db
    .select({ audioPath: speakingSubmission.audioPath })
    .from(speakingSubmission).where(eq(speakingSubmission.id, submissionId));
  const size = await audioSize(audioPath);
  if (size != null && size > MAX_AUDIO_BYTES) {
    await deleteAudio(audioPath).catch(() => {});
    await markFailed(submissionId);
    return { ok: false, error: "too_large" };
  }
  if (!(await markUploaded(submissionId))) return { ok: false, error: "bad_state" };
  await logAudioEvent(user.id, submissionId, "uploaded");
  triggerEvaluate(submissionId);
  return { ok: true };
}

export async function getSpeakingStatus(
  submissionId: string,
): Promise<{ status: "uploading" | "pending" | "evaluating" | "completed" | "failed" }> {
  const user = await getUser();
  if (!user) return { status: "failed" };
  const own = await readOwnSubmission(user.id, submissionId);
  if (!own) return { status: "failed" };
  // Lazy reaper: a transient row past the stale window → fail (cron is the primary
  // sweeper for users who left; this catches active pollers). pending also re-kicks.
  if ((own.status === "uploading" || own.status === "pending" || own.status === "evaluating")
      && isStuck(own.updatedAt, new Date(), staleMs)) {
    await markFailed(submissionId);
    return { status: "failed" };
  }
  if (own.status === "pending") triggerEvaluate(submissionId); // re-kick a lost trigger
  return { status: own.status };
}

export async function deleteSpeakingRecording(submissionId: string): Promise<{ ok: boolean }> {
  const user = await getUser();
  if (!user) return { ok: false };
  const own = await readOwnSubmission(user.id, submissionId);
  if (!own) return { ok: false };
  const [{ audioPath }] = await db
    .select({ audioPath: speakingSubmission.audioPath })
    .from(speakingSubmission).where(eq(speakingSubmission.id, submissionId));
  // Mark intent first (the eval guard reads delete_requested_at), then remove object
  // + wipe the transcript (verbatim speech = PII) from feedback.
  await db.update(speakingSubmission).set({ deleteRequestedAt: new Date(), updatedAt: new Date() })
    .where(eq(speakingSubmission.id, submissionId));
  await logAudioEvent(user.id, submissionId, "delete_requested");
  await deleteAudio(audioPath).catch(() => {});
  await db.update(speakingFeedback).set({ transcript: "", annotations: [], transcriptTimings: [], rewrites: [] })
    .where(eq(speakingFeedback.submissionId, submissionId));
  await markAudioDeleted(submissionId, user.id, "user");
  return { ok: true };
}
