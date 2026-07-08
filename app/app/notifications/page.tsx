import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getHeaderData } from "@/lib/notifications/header-data";
import { markAllRead, markOneRead } from "@/lib/notifications/actions";
import { fetchNotifPage } from "@/lib/notifications/list";
import { AppShell } from "../_AppShell";
import { NotificationsList } from "./NotificationsList";
import { loadNotificationsPage } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Notifications" };

/**
 * `/app/notifications` — полная история уведомлений (мост из dropdown колокольчика).
 * Первая страница рендерится на сервере (SSR) тем же owner-путём, что «Load more»
 * (fetchNotifPage под RLS). getHeaderData() пре-варминг конкурентно с телом —
 * AppShell получит кэш-хит, а не отдельный round-trip (см. header-data.ts).
 */
export default async function NotificationsPage() {
  await requireUser();
  void getHeaderData();
  const supabase = await createClient();
  const first = await fetchNotifPage(supabase, null);

  return (
    <AppShell active="notifications">
      <NotificationsList
        initialItems={first.items}
        initialCursor={first.nextCursor}
        loadMore={loadNotificationsPage}
        markAllRead={markAllRead}
        markOneRead={markOneRead}
      />
    </AppShell>
  );
}
