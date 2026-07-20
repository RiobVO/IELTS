/**
 * Tier gating helpers (BRIEF §4.8). The order basic < premium < ultra is the
 * single source of truth for "does this user meet a required tier". Pure, no I/O
 * — both the SQL gates (exam start / submit) and the UI (catalog locks, review
 * gating) derive their decisions from here so the rule lives in one place.
 */
export type Tier = "basic" | "premium" | "ultra";

const TIER_RANK: Record<Tier, number> = { basic: 0, premium: 1, ultra: 2 };

/**
 * Basic-tier daily limit on submitted tests (BRIEF §4.8 placeholder `N` — tune at
 * launch). Premium/Ultra are unlimited.
 */
export const BASIC_DAILY_LIMIT = 3;

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

/** True if the tier gets the full post-submit review (breakdown + evidence). */
export function hasFullReview(userTier: Tier): boolean {
  return meetsTier(userTier, "premium");
}
