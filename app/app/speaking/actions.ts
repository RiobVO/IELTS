"use server";
import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { speakingSubmission, speakingFeedback, speakingFeedbackDebug, profile } from "@/db/schema";
import { getUser, getProfile } from "@/lib/auth";
import { effectiveTier, meetsTier, SPEAKING_MIN_TIER, type Tier } from "@/lib/tiers";
import { speakingFeatureEnabled } from "@/env";
import { isUuid } from "@/lib/uuid";
import { signedUploadUrl, audioSize, deleteAudio } from "@/lib/speaking/storage";
import { logAudioEvent } from "@/lib/speaking/events";
import { logError } from "@/lib/monitoring/log-error";
import {
  insertUploadingSubmission, markUploaded, triggerEvaluate, completedCounts,
  countRecentSubmissions, loadSpeakingTaskForSubmissionGate, readOwnSubmission,
  markFailed, markAudioDeleted, markAudioDeleteFailed, failStaleSubmissions,
} from "@/lib/speaking/store";
import {
  canEvaluate, isStuck, exceedsSpeakingRate,
  SPEAKING_STALE_MS_DEFAULT, SPEAKING_RATE_WINDOW_SECONDS,
} from "@/lib/speaking/lifecycle";

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
  const tier: Tier = effectiveTier(profileRow as { tier: Tier; premium_until: string | Date | null });
  const { lifetime, today } = await completedCounts(user.id, now);
  const gate = canEvaluate({
    configured: speakingFeatureEnabled(),
    tier,
    lifetimeCompleted: lifetime,
    todayCompleted: today,
  });
  if (!gate.allowed) return { error: gate.reason };

  // Cost-amp throttle (N3, зеркало Writing #21): провал оценки не тратит preview/cap,
  // поэтому цикл create→upload→fail крутил бы платные Gemini-AUDIO вызовы. Считаем
  // ДО insert — burst отбивается без траты.
  const recent = await countRecentSubmissions(
    user.id,
    new Date(now.getTime() - SPEAKING_RATE_WINDOW_SECONDS * 1000),
  );
  if (exceedsSpeakingRate(recent)) return { error: "too_fast" };

  // Task gate (defence in depth): the catalog only lists published cue-cards, but this
  // action is callable directly. Screen the id (avoid 22P02), then re-check published +
  // tier (canEvaluate only enforces the global SPEAKING_MIN_TIER). Opaque single reason.
  if (!isUuid(taskId)) return { error: "unavailable" };
  const task = await loadSpeakingTaskForSubmissionGate(taskId);
  if (!task || task.status !== "published") return { error: "unavailable" };
  // tier_required gates only at-tier users; sub-tier users are in the free-preview lane
  // (canEvaluate allowed them above) and must not be blocked by the per-task tier.
  if (meetsTier(tier, SPEAKING_MIN_TIER) && !meetsTier(tier, task.tierRequired)) {
    return { error: "unavailable" };
  }

  // Reap the user's OWN stale in-flight row first, so a lost upload / dead eval doesn't
  // block a fresh attempt behind the one-active index (0028) until the daily reaper runs
  // (~24h on Hobby). A genuinely fresh row is not stale → insert still yields conflict (#5).
  await failStaleSubmissions(new Date(now.getTime() - staleMs), user.id);

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
  // Mark intent first (the eval guard reads delete_requested_at), then wipe the transcript
  // (verbatim speech = PII) from feedback — a reliable DB op done regardless of storage.
  await db.update(speakingSubmission).set({ deleteRequestedAt: new Date(), updatedAt: new Date() })
    .where(eq(speakingSubmission.id, submissionId));
  await logAudioEvent(user.id, submissionId, "delete_requested");
  await db.update(speakingFeedback).set({ transcript: "", annotations: [], transcriptTimings: [], rewrites: [] })
    .where(eq(speakingFeedback.submissionId, submissionId));
  // N6: raw_output в debug-строке несёт полный транскрипт (эхо речи = PII). Hard-lock
  // (RLS+REVOKE) прячет её от клиента, но обещание «удалить запись» обязано чистить
  // и её — до remove, чтобы текст ушёл даже при сбое storage.
  await db.update(speakingFeedbackDebug).set({ rawOutput: "[redacted: user delete]" })
    .where(eq(speakingFeedbackDebug.submissionId, submissionId));
  // Mark the AUDIO deleted ONLY after the object is actually gone. A failed remove used to
  // be swallowed (empty catch) then marked deleted anyway → biometrics silently retained
  // forever (#2). Now record the failure and stay retryable (audio_deleted_at NULL) so the
  // reaper picks it up; report the honest result (the UI only shows "removed" on ok).
  try {
    await deleteAudio(audioPath);
  } catch (e) {
    await markAudioDeleteFailed(submissionId, String(e));
    await logError({
      source: "server",
      message: "speaking audio delete failed (user)",
      stack: e instanceof Error ? e.stack : null,
      context: { op: "deleteSpeakingRecording", userId: user.id, submissionId },
    });
    return { ok: false };
  }
  await markAudioDeleted(submissionId, user.id, "user");
  return { ok: true };
}
