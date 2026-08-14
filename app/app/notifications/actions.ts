"use server";

import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fetchNotifPage, type NotifCursor, type NotifPage } from "@/lib/notifications/list";

/**
 * «Load more» полной истории уведомлений — следующая keyset-страница после курсора.
 * Owner-путь: requireUser + Supabase anon под RLS (клиент получает только свои
 * строки). Логику разбора/пагинации держит общий fetchNotifPage (тот же путь, что
 * SSR первой страницы), тут — только auth-граница server action.
 */
export async function loadNotificationsPage(cursor: NotifCursor): Promise<NotifPage> {
  await requireUser();
  const supabase = await createClient();
  return fetchNotifPage(supabase, cursor);
}
