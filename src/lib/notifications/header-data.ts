import { cache } from "react";
import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/monitoring/log-error";
import { parseNotifPayload } from "@/lib/notifications/view";
import type { NotifItem } from "@/components/app/NotificationsBell";

export interface HeaderData {
  profile: Awaited<ReturnType<typeof getProfile>>;
  unread: number;
  recent: NotifItem[];
}

/** Сырая строка notification, как приходит от Supabase (data — нетипизированный jsonb). */
interface NotifRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  read_at: string | null;
  created_at: string;
  data: unknown;
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
        .select("id,type,title,body,read_at,created_at,data")
        .order("created_at", { ascending: false })
        .limit(8),
    ]);

    // Явно логируем сбой каждого запроса: Supabase возвращает {error}, а не throw,
    // поэтому без этой проверки деградация «пустая шапка» неотличима от честного
    // «нет уведомлений», и молчаливо теряется реальная проблема (RLS/сеть).
    if (notif.error) {
      await logError({ source: "server", message: `header unread count failed: ${notif.error.message}` });
    }
    if (recent.error) {
      await logError({ source: "server", message: `header recent notifications failed: ${recent.error.message}` });
    }

    const rows = (recent.data ?? []) as NotifRow[];
    return {
      profile,
      unread: notif.count ?? 0,
      recent: rows.map((r) => ({
        id: r.id,
        type: r.type,
        title: r.title,
        body: r.body,
        read_at: r.read_at,
        created_at: r.created_at,
        payload: parseNotifPayload(r.type, r.data),
      })),
    };
  } catch (e) {
    // Гарантируем non-throwing: `void getHeaderData()` в пре-варме не должен
    // ронять страницу unhandled-rejection'ом. Шапка деградирует до пустой.
    await logError({
      source: "server",
      message: `getHeaderData failed: ${e instanceof Error ? e.message : String(e)}`,
      stack: e instanceof Error ? e.stack : null,
    });
    return { profile: null, unread: 0, recent: [] };
  }
});
