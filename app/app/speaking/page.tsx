import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getProfile, requireUser } from "@/lib/auth";
import { speakingFeatureEnabled } from "@/env";
import { listPublishedTasks, listUserHistory } from "@/lib/speaking/read";
import { effectiveTier, meetsTier, SPEAKING_MIN_TIER, type Tier } from "@/lib/tiers";
import { AppShell } from "../_AppShell";
import { SpeakingCatalog } from "./_Catalog";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Speaking | bando" };

/**
 * Speaking Lab catalog (`/app/speaking`). Disabled-safe: with SPEAKING_EVAL_MODEL
 * unset the feature is off → redirect to Practice (the coming-soon teaser there is
 * the off state), exactly like Writing. Otherwise list published cue-cards.
 *
 * Speaking is Ultra-only with one lifetime free preview (free/premium): the catalog
 * surfaces that honestly — preview-available → "1 free analysis", preview-spent →
 * an Ultra lock that routes to upgrade. Ultra is unlocked outright.
 */
export default async function SpeakingCatalogPage() {
  const user = await requireUser();
  if (!speakingFeatureEnabled()) redirect("/app/practice");

  const [profile, tasks] = await Promise.all([getProfile(), listPublishedTasks()]);
  const tier: Tier = profile
    ? effectiveTier(profile as { tier: Tier; premium_until: string | Date | null })
    : "basic";

  // Preview-spent only matters for non-Ultra; skip the history query for Ultra. For a
  // non-Ultra user the lock state sells the upgrade with the band they actually earned,
  // so we read history (exactly one completed attempt at the free cap) for that band.
  const isUltra = meetsTier(tier, SPEAKING_MIN_TIER);
  const history = isUltra ? [] : await listUserHistory(user.id);
  const previewUsed = history.length >= 1;
  const lastBand = previewUsed ? { low: history[0].bandLow, high: history[0].bandHigh } : null;

  // Target band powers the per-card "on target" hint (same profile source as Writing).
  const rawTarget = (profile as { target_band?: string | number | null } | null)?.target_band;
  const targetBand = rawTarget != null ? Number(rawTarget) : null;

  return (
    <AppShell active="practice">
      <SpeakingCatalog
        tasks={tasks}
        isUltra={isUltra}
        previewUsed={previewUsed}
        lastBand={lastBand}
        targetBand={targetBand}
      />
    </AppShell>
  );
}
