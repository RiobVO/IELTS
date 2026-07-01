"use server";

import { getProfile, getUser } from "@/lib/auth";
import { writingFeatureEnabled } from "@/env";
import { isUuid } from "@/lib/uuid";
import { effectiveTier, meetsTier, WRITING_MIN_TIER, type Tier } from "@/lib/tiers";
import { canEvaluate, validateEssay, isStuck, WRITING_STALE_MS } from "@/lib/writing/lifecycle";
import {
  completedCounts,
  insertPendingSubmission,
  loadWritingTaskForSubmissionGate,
  triggerEvaluate,
  readOwnSubmission,
  markFailed,
  failStaleSubmissions,
} from "@/lib/writing/store";

type CreateResult =
  | { ok: true; submissionId: string }
  | {
      ok: false;
      reason:
        | "auth"
        | "too_short"
        | "too_long"
        | "not_configured"
        | "preview_used"
        | "daily_cap"
        | "in_progress"
        | "unavailable";
    };

export async function createWritingSubmission(input: { taskId: string; essay: string }): Promise<CreateResult> {
  const user = await getUser();
  if (!user) return { ok: false, reason: "auth" };

  const essay = validateEssay(input.essay); // size bounds BEFORE any DB/spend
  if (!essay.ok) return { ok: false, reason: essay.reason };

  const profile = await getProfile();
  const tier: Tier = profile
    ? effectiveTier(profile as { tier: Tier; premium_until: string | Date | null })
    : "basic";
  const now = new Date();
  const { lifetime, today } = await completedCounts(user.id, now);

  const gate = canEvaluate({
    configured: writingFeatureEnabled(),
    tier,
    lifetimeCompleted: lifetime,
    todayCompleted: today,
  });
  if (!gate.allowed) return { ok: false, reason: gate.reason };

  // Task gate (defence in depth): the catalog only lists published tasks the user can
  // open, but this action is POST-reachable directly. Screen the id first (so a
  // malformed value never reaches the uuid column → 22P02), then re-check the task is
  // published and the user's tier meets task.tier_required (canEvaluate only enforces
  // the global WRITING_MIN_TIER). All failures collapse to one opaque reason.
  if (!isUuid(input.taskId)) return { ok: false, reason: "unavailable" };
  const task = await loadWritingTaskForSubmissionGate(input.taskId);
  if (!task || task.status !== "published") return { ok: false, reason: "unavailable" };
  // tier_required gates only at-tier users; sub-tier users are in the free-preview lane
  // (canEvaluate allowed them above) and must not be blocked by the per-task tier.
  if (meetsTier(tier, WRITING_MIN_TIER) && !meetsTier(tier, task.tierRequired)) {
    return { ok: false, reason: "unavailable" };
  }

  // Reap the user's OWN stale in-flight row first, so a lost trigger / dead eval doesn't
  // block a fresh attempt behind the one-active index (0024) until the daily cron runs.
  // A genuinely fresh in-flight row is NOT stale → insert still yields in_progress (#1).
  await failStaleSubmissions(new Date(now.getTime() - WRITING_STALE_MS), user.id);

  // 0024 one-active index: null = user already has a pending/evaluating submission.
  const submissionId = await insertPendingSubmission(user.id, input.taskId, input.essay.trim(), essay.wordCount);
  if (!submissionId) return { ok: false, reason: "in_progress" };

  triggerEvaluate(submissionId);
  return { ok: true, submissionId };
}

// Poll: owner-read. Re-kick a stuck pending (lost trigger — idempotent via claim).
// Reap a stuck evaluating to failed. Retry after failed = a NEW createWritingSubmission.
export async function getSubmissionStatus(
  submissionId: string,
): Promise<{ status: "pending" | "evaluating" | "completed" | "failed" } | null> {
  const user = await getUser();
  if (!user) return null;
  const row = await readOwnSubmission(user.id, submissionId);
  if (!row) return null;

  const now = new Date();
  if (row.status === "pending") {
    // A pending older than the stale window means the trigger never landed and
    // re-kicks aren't progressing — reap it so the one-active index unblocks and
    // the user can retry. Fresh pendings get re-kicked (idempotent via claim).
    if (isStuck(row.updatedAt, now, WRITING_STALE_MS)) {
      await markFailed(submissionId);
      return { status: "failed" };
    }
    triggerEvaluate(submissionId); // safety net if the original after()+fetch was lost
    return { status: "pending" };
  }
  if (row.status === "evaluating" && isStuck(row.updatedAt, now, WRITING_STALE_MS)) {
    await markFailed(submissionId);
    return { status: "failed" };
  }
  return { status: row.status };
}
