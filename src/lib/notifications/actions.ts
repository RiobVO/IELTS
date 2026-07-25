"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

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
  await supabase
    .from("notification")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .is("read_at", null);
  revalidatePath("/app", "layout");
}
