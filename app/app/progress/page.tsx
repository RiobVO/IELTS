import type { Metadata } from "next";
import { OverviewPanel } from "./OverviewPanel";
import { LeaguePanel } from "./LeaguePanel";
import { BadgesPanel } from "./BadgesPanel";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Progress | bando" };

/**
 * Объединённый раздел Progress — Overview + League + Badges под одним маршрутом с
 * route-табами (`?tab=overview|league|badges`, дефолт overview). Роутер тонкий:
 * резолвит searchParams, выбирает таб и рендерит ТОЛЬКО активную панель — остальные
 * не рендерятся, значит и их данные не фетчатся (никакого double-fetch). Каждая
 * панель сама оборачивается в AppShell и остаётся top-level fetcher'ом своей ветки
 * (prewarm шапки + тело конкурентно), поэтому перф-характеристики сохранены 1:1.
 * `period`/`scope` пробрасываются в League-панель; в остальных табах игнорируются.
 */
export default async function ProgressPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; period?: string; scope?: string }>;
}) {
  const sp = await searchParams;
  const tab = sp.tab === "badges" ? "badges" : sp.tab === "league" ? "league" : "overview";
  if (tab === "badges") return <BadgesPanel />;
  if (tab === "league") return <LeaguePanel period={sp.period} scope={sp.scope} />;
  return <OverviewPanel />;
}
