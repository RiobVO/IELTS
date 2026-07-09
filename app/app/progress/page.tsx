import type { Metadata } from "next";
import { LeaguePanel } from "./LeaguePanel";
import { BadgesPanel } from "./BadgesPanel";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Progress | bando" };

/**
 * Объединённый раздел Progress — League + Badges под одним маршрутом с route-табами
 * (`?tab=league|badges`, дефолт league). Роутер тонкий: резолвит searchParams, выбирает
 * таб и рендерит ТОЛЬКО активную панель — вторая не рендерится, значит и её данные не
 * фетчатся (никакого double-fetch). Каждая панель сама оборачивается в AppShell и
 * остаётся top-level fetcher'ом своей ветки (prewarm шапки + тело конкурентно, как было
 * у прежних отдельных страниц), поэтому перф-характеристики сохранены 1:1.
 * `period`/`scope` пробрасываются в League-панель; в Badges-табе игнорируются.
 */
export default async function ProgressPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; period?: string; scope?: string }>;
}) {
  const sp = await searchParams;
  const tab = sp.tab === "badges" ? "badges" : "league";
  return tab === "badges" ? <BadgesPanel /> : <LeaguePanel period={sp.period} scope={sp.scope} />;
}
