"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/monitoring/log-error";

/**
 * Помечает все непрочитанные уведомления пользователя прочитанными. Supabase
 * client (anon, RLS): политика notification_update_own (миграция 0001) разрешает
 * UPDATE только своих строк (user_id = auth.uid()); .eq("user_id") —
 * defense-in-depth поверх RLS. Ревалидируем сегмент /app, чтобы счётчик в шапке
 * (общий каркас) обновился сразу на любой странице зоны.
 */
export async function markAllRead() {
  const user = await requireUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from("notification")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .is("read_at", null);
  if (error) {
    await logError({ source: "server", message: `markAllRead failed: ${error.message}`, userId: user.id });
  }
  revalidatePath("/app", "layout");
}

/**
 * Помечает ОДНО уведомление прочитанным (клик по кликабельному пункту dropdown'а).
 * Тот же owner-путь, что markAllRead: Supabase anon + RLS (notification_update_own),
 * .eq("user_id") — defense-in-depth. Фильтр .is("read_at", null) — идемпотентность:
 * повторный клик по уже прочитанному ничего не трогает. Ревалидируем /app, чтобы
 * серверный счётчик догнал оптимистичное состояние клиента.
 */
export async function markOneRead(id: string) {
  const user = await requireUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from("notification")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id)
    .is("read_at", null);
  if (error) {
    await logError({ source: "server", message: `markOneRead failed: ${error.message}`, userId: user.id });
  }
  revalidatePath("/app", "layout");
}
