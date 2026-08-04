import { redirect } from "next/navigation";
import { getProfile, requireUser } from "@/lib/auth";
import { writingFeatureEnabled } from "@/env";
import { listPublishedTasks } from "@/lib/writing/read";
import { completedCounts } from "@/lib/writing/store";
import { effectiveTier, meetsTier, WRITING_MIN_TIER, type Tier } from "@/lib/tiers";
import { AppShell } from "../_AppShell";
import { WritingCatalog, type PreviewState } from "./_Catalog";

export const dynamic = "force-dynamic";

/**
 * Writing Lab catalog (`/app/writing`). Disabled-safe: with WRITING_EVAL_MODEL
 * unset the feature is off → redirect to Practice (the Soon/locked-panel there is
 * the coming-soon state). Otherwise list published prompts (Task 1 + Task 2) owner-path.
 */
export default async function WritingCatalogPage() {
  const user = await requireUser();
  if (!writingFeatureEnabled()) redirect("/app/practice");

  const [profile, tasks] = await Promise.all([getProfile(), listPublishedTasks()]);

  // Surface the existing eval gate (lifecycle.canEvaluate) in the catalog: a Basic user
  // spends one lifetime teaser, after which the cards lock to the upgrade page. Premium+
  // never locks here — their daily cap is a soft limit enforced at eval, not a paywall.
  const tier: Tier = profile
    ? effectiveTier(profile as { tier: Tier; premium_until: string | Date | null })
    : "basic";
  const hasPaid = meetsTier(tier, WRITING_MIN_TIER);
  const previewUsed = hasPaid ? false : (await completedCounts(user.id, new Date())).lifetime >= 1;
  // Three states drive the catalog's tone: "paid" (no paywall), "available" (the one free
  // analysis is unspent → signpost it up front so it isn't burned by accident), "spent"
  // (the gate engages → upgrade framed as continuation, not a wall).
  const preview: PreviewState = hasPaid ? "paid" : previewUsed ? "spent" : "available";

  const rawTarget = (profile as { target_band: string | number | null } | null)?.target_band;
  const targetBand = rawTarget != null ? Number(rawTarget) : null;

  return (
    <AppShell active="practice">
      <WritingCatalog tasks={tasks} targetBand={targetBand} preview={preview} />
    </AppShell>
  );
}
