import { meetsTier, SPEAKING_MIN_TIER, type Tier } from "@/lib/tiers";

// A Part 2 long-turn is ~150-220 words. Below this the response is too short to
// assess — a deterministic server signal (we count the model's transcript, the
// model never decides "too short"). Mirrors the Writing underlength lesson.
export const MIN_TRANSCRIPT_WORDS = 40;

// Daily analysis caps bound Gemini spend (audio is pricier than text → tighter).
export const SPEAKING_DAILY_CAP_ULTRA = 10;
export const SPEAKING_STALE_MS_DEFAULT = 2 * 60 * 1000;

// Cost-amp throttle (N3, зеркало Writing #21): провал оценки не тратит preview/cap,
// поэтому цикл create→upload→fail крутил бы платные Gemini-AUDIO вызовы без предела.
// Порог жёстче Writing (5): запись Part 2 занимает минуты, а аудио-вызов дороже
// текстового. Чистый порог; COUNT в store (индекс speaking_submission_user_created_idx).
export const SPEAKING_RATE_WINDOW_SECONDS = 60;
export const SPEAKING_RATE_MAX = 3; // submissions per window per user; >= threshold → reject
export function exceedsSpeakingRate(recentInWindow: number): boolean {
  return recentInWindow >= SPEAKING_RATE_MAX;
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

// One-active UNIQUE index closes the in-flight farm race; this is steady-state
// policy. Speaking is Ultra-only with a daily cap; free/premium get ONE lifetime
// preview, then must upgrade (pricing-aligned via SPEAKING_MIN_TIER).
export function canEvaluate(i: EvalGateInput): EvalGate {
  if (!i.configured) return { allowed: false, reason: "not_configured" };
  if (meetsTier(i.tier, SPEAKING_MIN_TIER)) {
    return i.todayCompleted >= SPEAKING_DAILY_CAP_ULTRA
      ? { allowed: false, reason: "daily_cap" }
      : { allowed: true };
  }
  return i.lifetimeCompleted >= 1 ? { allowed: false, reason: "preview_used" } : { allowed: true };
}

export function isStuck(updatedAt: Date, now: Date, staleMs: number): boolean {
  return now.getTime() - updatedAt.getTime() > staleMs;
}

/** True when the transcript is too short to assess (server-side word count). */
export function isUnderlength(transcript: string): boolean {
  const t = transcript.trim();
  const words = t ? t.split(/\s+/).length : 0;
  return words < MIN_TRANSCRIPT_WORDS;
}
