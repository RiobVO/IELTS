import { cache } from "react";
import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { NotifItem } from "@/components/app/NotificationsBell";

export interface HeaderData {
  profile: Awaited<ReturnType<typeof getProfile>>;
  unread: number;
  recent: NotifItem[];
}

/**
 * Данные шапки /app (profile + счётчик непрочитанных + последние уведомления) —
 * ОДИН набор запросов, request-мемоизированный через React `cache()`.
 *
 * Зачем: AppShell — обёртка `<AppShell>{children}</AppShell>`, поэтому React
 * рендерит его данные ПОСЛЕ того, как тело страницы разрешит свои await — это был
 * отдельный trailing round-trip на КАЖДОЙ /app-странице. Теперь страница зовёт
 * `getHeaderData()` КОНКУРЕНТНО со своим телом (в своём Promise.all или ранним
 * вызовом), а AppShell получает кэш-хит → уведомления едут параллельно с данными
 * страницы, а не отдельным хопом.
 *
 * Никогда не бросает: сбой уведомлений не должен ронять страницу (запросы Supabase
 * возвращают `{data,error}`, а не throw), поэтому `void getHeaderData()` для
 * пре-варма безопасен. `getProfile()` остаётся `cache()`-дедуплицированным.
 */
export const getHeaderData = cache(async (): Promise<HeaderData> => {
  try {
    const supabase = await createClient();
    const [profile, notif, recent] = await Promise.all([
      getProfile(),
      supabase
        .from("notification")
        .select("id", { count: "exact", head: true })
        .is("read_at", null),
      supabase
        .from("notification")
        .select("id,type,title,body,read_at,created_at")
        .order("created_at", { ascending: false })
        .limit(8),
    ]);
    return {
      profile,
      unread: notif.count ?? 0,
      recent: (recent.data ?? []) as NotifItem[],
    };
  } catch (e) {
    // Гарантируем non-throwing: `void getHeaderData()` в пре-варме не должен
    // ронять страницу unhandled-rejection'ом. Шапка деградирует до пустой.
    console.error("getHeaderData failed", e);
    return { profile: null, unread: 0, recent: [] };
  }
});
