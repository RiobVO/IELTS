import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Badges свёрнуты в объединённый раздел /app/progress (таб badges). Роут остаётся как
 * redirect (307, как reading/listening-стабы — 308 кэшируется браузером намертво).
 */
export default function BadgesRedirect() {
  redirect("/app/progress?tab=badges");
}
