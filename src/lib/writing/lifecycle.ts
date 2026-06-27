import { meetsTier, WRITING_MIN_TIER, type Tier } from "@/lib/tiers";

export const MIN_WORDS = 20; // below this it's not an essay
export const MAX_WORDS = 1000; // cost guard — IELTS Task 2 is ~250-400 words
// Official IELTS minimums. Distinct from MIN_WORDS (the "is this even an essay"
// floor): below these the response is penalised for length, not rejected. Task 1
// (chart description) is 150; Task 2 (essay) is 250.
export const TASK2_MIN_WORDS = 250;
export const TASK1_MIN_WORDS = 150;

/** The official min-word floor for a given part — drives the ring, coach and underlength net. */
export function minWordsFor(taskPart: "task1" | "task2"): number {
  return taskPart === "task1" ? TASK1_MIN_WORDS : TASK2_MIN_WORDS;
}
// Daily analysis caps bound Gemini spend and form the Premium→Ultra upsell ladder.
export const WRITING_DAILY_CAP_PREMIUM = 5; // Premium: enough for a real student, caps abuse
export const WRITING_DAILY_CAP_ULTRA = 20; // Ultra: generous — effectively unlimited for a human
export const WRITING_STALE_MS = 5 * 60 * 1000; // reap 'evaluating' older than this

export type EssayCheck =
  | { ok: true; wordCount: number }
  | { ok: false; reason: "too_short" | "too_long" };

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
export type EvalGate =
  | { allowed: true }
  | { allowed: false; reason: "not_configured" | "preview_used" | "daily_cap" };

// The one-active-submission UNIQUE INDEX (0024) closes the in-flight farm race at
// the DB; this gate handles the steady-state policy (config, tier, preview, cap).
// AI Writing is a paid feature: Premium+ get it daily-capped (Ultra more generous);
// Basic gets one lifetime teaser, then must upgrade. Pricing-aligned via WRITING_MIN_TIER.
export function canEvaluate(i: EvalGateInput): EvalGate {
  if (!i.configured) return { allowed: false, reason: "not_configured" };
  if (meetsTier(i.tier, WRITING_MIN_TIER)) {
    const cap = i.tier === "ultra" ? WRITING_DAILY_CAP_ULTRA : WRITING_DAILY_CAP_PREMIUM;
    return i.todayCompleted >= cap
      ? { allowed: false, reason: "daily_cap" }
      : { allowed: true };
  }
  return i.lifetimeCompleted >= 1
    ? { allowed: false, reason: "preview_used" }
    : { allowed: true };
}

// True when a row in a transient state (pending | evaluating) is older than the
// stale window. Reaps two failure modes: a 'pending' whose trigger never landed
// (lost after()/fetch, misconfig) and re-kicks aren't progressing, and an
// 'evaluating' that died mid-eval. Either way → mark failed so the one-active
// index unblocks and the user can retry.
export function isStuck(updatedAt: Date, now: Date, staleMs: number): boolean {
  return now.getTime() - updatedAt.getTime() > staleMs;
}
