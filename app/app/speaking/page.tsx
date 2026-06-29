import { redirect } from "next/navigation";
import { getProfile, requireUser } from "@/lib/auth";
import { speakingEvalConfig } from "@/env";
import { listPublishedTasks } from "@/lib/speaking/read";
import { completedCounts } from "@/lib/speaking/store";
import { effectiveTier, meetsTier, SPEAKING_MIN_TIER, type Tier } from "@/lib/tiers";
import { AppShell } from "../_AppShell";
import { SpeakingCatalog } from "./_Catalog";

export const dynamic = "force-dynamic";

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
  if (speakingEvalConfig() === null) redirect("/app/practice");

  const [profile, tasks] = await Promise.all([getProfile(), listPublishedTasks()]);
  const tier: Tier = profile
    ? effectiveTier(profile as { tier: Tier; premium_until: string | Date | null })
    : "basic";

  // Preview-spent only matters for non-Ultra; skip the count query for Ultra.
  const isUltra = meetsTier(tier, SPEAKING_MIN_TIER);
  const previewUsed = isUltra
    ? false
    : (await completedCounts(user.id, new Date())).lifetime >= 1;

  return (
    <AppShell active="practice">
      <SpeakingCatalog tasks={tasks} isUltra={isUltra} previewUsed={previewUsed} />
    </AppShell>
  );
}
