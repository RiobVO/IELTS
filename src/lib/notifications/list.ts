import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/monitoring/log-error";
import { parseNotifPayload } from "@/lib/notifications/view";
import type { NotifItem } from "@/components/app/NotificationsBell";

/**
 * Пагинированное чтение полной истории уведомлений юзера. Supabase anon-путь под
 * RLS (как header-data.ts) — клиент видит только свои строки. Keyset по
 * (created_at desc, id desc): стабилен при вставке новых уведомлений в голову между
 * подгрузками (offset бы дублировал/пропускал строку). Разбор `data` — общий
 * защитный parseNotifPayload, без дубля.
 *
 * Общий модуль для page.tsx (первая страница, SSR) и server action «Load more».
 */

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export const NOTIF_PAGE_SIZE = 20;

/** Курсор keyset-пагинации — последняя показанная (created_at, id). */
export interface NotifCursor {
  createdAt: string;
  id: string;
}

export interface NotifPage {
  items: NotifItem[];
  nextCursor: NotifCursor | null;
}

interface NotifRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  read_at: string | null;
  created_at: string;
  data: unknown;
}

// Курсор приходит с клиента (эхо серверных значений). RLS всё равно ограничивает
// выборку своими строками, но валидируем форму, чтобы кривой курсор не ломал
// PostgREST-фильтр `.or()` инъекцией запятой/скобки (структурные символы синтаксиса).
// timestamptz-regex сам по себе запрещает запятые/скобки (только цифры, -:.T+Z);
// Date.parse — доп. проверка, что это реальная дата (Date.parse один недостаточен:
// принял бы RFC-2822 «Sat, 01 Jan 2024» с запятой). UUID — канонический вид.
const TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validCursor(c: NotifCursor | null | undefined): c is NotifCursor {
  return (
    c != null &&
    typeof c.createdAt === "string" &&
    TS_RE.test(c.createdAt) &&
    Number.isFinite(Date.parse(c.createdAt)) &&
    typeof c.id === "string" &&
    UUID_RE.test(c.id)
  );
}

export async function fetchNotifPage(
  supabase: SupabaseServerClient,
  cursor: NotifCursor | null,
): Promise<NotifPage> {
  let q = supabase
    .from("notification")
    .select("id,type,title,body,read_at,created_at,data")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    // +1 сверх страницы — детектор «есть ещё» без отдельного count-запроса.
    .limit(NOTIF_PAGE_SIZE + 1);

  if (validCursor(cursor)) {
    // Keyset-предикат: строго «раньше» курсора по (created_at, id).
    q = q.or(
      `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
    );
  }

  const { data, error } = await q;
  if (error) {
    await logError({ source: "server", message: `fetchNotifPage failed: ${error.message}` });
    return { items: [], nextCursor: null };
  }

  const rows = (data ?? []) as NotifRow[];
  const hasMore = rows.length > NOTIF_PAGE_SIZE;
  const kept = hasMore ? rows.slice(0, NOTIF_PAGE_SIZE) : rows;
  const items: NotifItem[] = kept.map((r) => ({
    id: r.id,
    type: r.type,
    title: r.title,
    body: r.body,
    read_at: r.read_at,
    created_at: r.created_at,
    payload: parseNotifPayload(r.type, r.data),
  }));
  const last = kept[kept.length - 1];
  const nextCursor = hasMore && last ? { createdAt: last.created_at, id: last.id } : null;
  return { items, nextCursor };
}
