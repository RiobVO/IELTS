/**
 * Tier gating helpers (BRIEF §4.8). The order basic < premium < ultra is the
 * single source of truth for "does this user meet a required tier". Pure, no I/O
 * — both the SQL gates (exam start / submit) and the UI (catalog locks, review
 * gating) derive their decisions from here so the rule lives in one place.
 */
export type Tier = "basic" | "premium" | "ultra";

const TIER_RANK: Record<Tier, number> = { basic: 0, premium: 1, ultra: 2 };

/**
 * Basic-tier daily limit on submitted tests (BRIEF §4.8). Set high at launch (no
 * monetization yet) so it's effectively unlimited for a real student, while still
 * capping run-away abuse per account; tighten it as an upsell when paid tiers go
 * live. Premium/Ultra are unlimited.
 */
export const BASIC_DAILY_LIMIT = 25;

/**
 * Basic-tier daily cap on NEW vocab cards introduced per day (SRS anti-cram, Vocab
 * plan). Premium/Ultra are unlimited. Only NEW cards (no progress row yet) count —
 * reviews of already-seen cards are never capped. Enforced server-side (owner-path
 * SRS write), so a UI hint can't bypass it; tighten as an upsell when paid tiers land.
 */
export const VOCAB_DAILY_NEW_LIMIT = 20;

/**
 * Дневная цель повторов для приватного vocab-стрика (план V3). Хардкод-константа
 * (прецедент — GoalBar goal=5): цель мотивирует прогресс-панель, но НЕ гейтит доступ
 * и НЕ течёт в рейтинг/Elo/XP — это отдельный обучающий счётчик.
 */
export const VOCAB_DAILY_GOAL = 15;

/**
 * Порог «карта освоена» (план V4): SM-2 interval_days ≥ этого значения. На таком
 * интервале карта уходит в режим maintenance — каталог красит дек success и ставит
 * бейдж «Mastered». Держим рядом с остальными vocab-тюнингами.
 */
export const VOCAB_MASTERED_INTERVAL_DAYS = 21;

/**
 * AI Writing (Task 2 feedback) is a paid feature and unlocks at Premium and up
 * (pricing page: "AI Writing feedback" sits in Premium; Ultra adds human review +
 * Speaking on top, still to come). Basic gets a single lifetime teaser preview so
 * they taste the AI, then upgrade — see lifecycle.canEvaluate.
 */
export const WRITING_MIN_TIER: Tier = "premium";

/**
 * AI Speaking (Part 2 feedback) is Ultra-only (BRIEF §4.8; Writing=Premium,
 * Speaking=Ultra). Free/Premium get a single lifetime preview as a wow-hook —
 * pricing copy must advertise "1 free Speaking analysis" (Plan 3). The preview is
 * INDEPENDENT of the Writing preview (counted off speaking_submission completions).
 */
export const SPEAKING_MIN_TIER: Tier = "ultra";

/** One lifetime free Speaking preview per account (not per day). */
export const SPEAKING_PREVIEW_LIMIT = 1;

/**
 * The tier a profile is ACTUALLY entitled to right now. A premium/ultra profile
 * whose `premium_until` has passed counts as basic regardless of the stored tier
 * — the cron downgrade (§11) may lag, so gating must not trust a stale tier. A
 * null `premium_until` on a non-basic tier means "no expiry" (e.g. a comped
 * grant) and is honoured.
 */
export function effectiveTier(p: {
  tier: Tier;
  premium_until: string | Date | null;
}): Tier {
  if (p.tier === "basic") return "basic";
  if (p.premium_until == null) return p.tier;
  const until =
    p.premium_until instanceof Date
      ? p.premium_until
      : new Date(p.premium_until);
  return until.getTime() > Date.now() ? p.tier : "basic";
}

/** True if `userTier` satisfies a `required` tier (basic < premium < ultra). */
export function meetsTier(userTier: Tier, required: Tier): boolean {
  return TIER_RANK[userTier] >= TIER_RANK[required];
}

/**
 * Monetization flag (REDESIGN S5 / W1-1). When `false`, the post-submit review —
 * correct answers, explanations and text evidence — is gated behind Premium. The
 * per-type breakdown and per-question ✓/✗ stay FREE for everyone regardless (the
 * grading insight that grows the audience, W1-1); only the answer / why / evidence
 * are Premium. Flip to `true` to re-open the full review to all in a single edit.
 */
export const REVIEW_OPEN = true;

/**
 * True if the tier gets the full post-submit review (breakdown + evidence).
 * `open` defaults to the launch flag `REVIEW_OPEN` (free for all). Pass `open`
 * explicitly to evaluate the underlying Premium gate (tests / when re-gating).
 */
export function hasFullReview(userTier: Tier, open: boolean = REVIEW_OPEN): boolean {
  if (open) return true;
  return meetsTier(userTier, "premium");
}
