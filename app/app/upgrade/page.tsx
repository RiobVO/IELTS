import { getProfile, requireUser } from "@/lib/auth";
import { getHeaderData } from "@/lib/notifications/header-data";
import { effectiveTier, type Tier } from "@/lib/tiers";
import { findPlan } from "@/lib/payments/plans";
import { speakingFeatureEnabled } from "@/env";
import { AppShell } from "../_AppShell";
import { Button } from "@/components/core/Button";
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
      {/* Мобильный путь назад — тут, а не в PricingScreen: тот же компонент рендерит
          публичную /pricing, куда back-ссылка в приложение попадать не должна. */}
      <style>{`.mob-back{display:none}@media(max-width:430px){.mob-back{display:block;padding:16px 16px 0}}`}</style>
      <div className="mob-back">
        <Button variant="ghost" size="sm" icon="arrow-left" href="/app">Home</Button>
      </div>
      <PricingScreen current={current} price={price} speakingEnabled={speakingFeatureEnabled()} />
    </AppShell>
  );
}
