import "server-only";
import { db } from "@/db";
import { notification, notificationType } from "@/db/schema";

/** Значения совпадают с pgEnum notification_type (schema) — синхронизированы. */
type NotificationType = (typeof notificationType.enumValues)[number];

export interface NewNotification {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  data?: Record<string, unknown> | null;
}

/**
 * Запись уведомлений (BRIEF §11) серверным owner-клиентом. INSERT в notification
 * НЕ выдан роли authenticated (RLS, миграция 0001) — создаёт только сервер,
 * клиент их лишь читает и помечает прочитанными. Best-effort: НЕ бросает (как
 * analytics/badges) — уведомление некритично и не должно ломать вызывающий
 * post-submit или cron. Bulk-вставка одним INSERT для cron-рассылок.
 */
export async function createNotifications(
  items: NewNotification[],
): Promise<void> {
  if (items.length === 0) return;
  try {
    await db.insert(notification).values(
      items.map((n) => ({
        userId: n.userId,
        type: n.type,
        title: n.title,
        body: n.body ?? null,
        data: n.data ?? null,
      })),
    );
  } catch (e) {
    console.error("createNotifications failed", e);
  }
}

export async function createNotification(item: NewNotification): Promise<void> {
  return createNotifications([item]);
}
