import { getProfile, requireUser } from "@/lib/auth";
import { getHeaderData } from "@/lib/notifications/header-data";
import { effectiveTier, type Tier } from "@/lib/tiers";
import { findPlan } from "@/lib/payments/plans";
import { speakingEvalConfig } from "@/env";
import { AppShell } from "../_AppShell";
import PricingScreen from "./PricingScreen";

export const dynamic = "force-dynamic";

export default async function UpgradePage() {
  await requireUser();
  // Пре-варм данных шапки конкурентно (cache()'d; AppShell reuses).
  void getHeaderData();
  const profile = await getProfile();
  const current: Tier = profile
    ? effectiveTier({ tier: profile.tier, premium_until: profile.premium_until })
    : "basic";

  // Цены — из единого каталога PLANS (клиент не диктует сумму).
  const price = {
    premium: { monthly: findPlan("premium", 1)!.amount, annual: findPlan("premium", 12)!.amount },
    ultra: { monthly: findPlan("ultra", 1)!.amount, annual: findPlan("ultra", 12)!.amount },
  };

  return (
    <AppShell active="pricing">
      <PricingScreen current={current} price={price} speakingEnabled={speakingEvalConfig() !== null} />
    </AppShell>
  );
}
