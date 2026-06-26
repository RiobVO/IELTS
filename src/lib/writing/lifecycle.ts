import type { Tier } from "@/lib/tiers";

export const MIN_WORDS = 20; // below this it's not an essay
export const MAX_WORDS = 1000; // cost guard — IELTS Task 2 is ~250-400 words
export const WRITING_DAILY_CAP = 20; // soft Ultra/day cap (placeholder)
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
// the DB; this gate handles the steady-state policy (config, preview, cap).
export function canEvaluate(i: EvalGateInput): EvalGate {
  if (!i.configured) return { allowed: false, reason: "not_configured" };
  if (i.tier !== "ultra") {
    return i.lifetimeCompleted >= 1
      ? { allowed: false, reason: "preview_used" }
      : { allowed: true };
  }
  return i.todayCompleted >= WRITING_DAILY_CAP
    ? { allowed: false, reason: "daily_cap" }
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
