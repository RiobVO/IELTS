import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * League свёрнута в объединённый раздел /app/progress (таб league). Роут остаётся как
 * redirect (307, как reading/listening-стабы — 308 кэшируется браузером намертво):
 * переживает старые ссылки/закладки и переносит period/scope в новый URL, сохраняя таб.
 */
export default async function LeaderboardRedirect({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; scope?: string }>;
}) {
  const sp = await searchParams;
  const p = new URLSearchParams({ tab: "league" });
  if (sp.period) p.set("period", sp.period);
  if (sp.scope) p.set("scope", sp.scope);
  redirect(`/app/progress?${p.toString()}`);
}
