import "server-only";
import { db } from "@/db";
import { notification, notificationType } from "@/db/schema";
import { logError } from "@/lib/monitoring/log-error";

/** Значения совпадают с pgEnum notification_type (schema) — синхронизированы. */
type NotificationType = (typeof notificationType.enumValues)[number];

export interface NewNotification {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  data?: Record<string, unknown> | null;
  /** Дискриминатор подтипа (0046). По умолчанию = type; system-подтипы (vocab_due_reminder) передают явно. */
  kind?: string;
  /** Ключ атомарного дедупа (0046): при заданном конфликт по partial unique index молча пропускается. */
  dedupKey?: string | null;
}

/**
 * Запись уведомлений (BRIEF §11) серверным owner-клиентом. INSERT в notification
 * НЕ выдан роли authenticated (RLS, миграция 0001) — создаёт только сервер,
 * клиент их лишь читает и помечает прочитанными. Best-effort: НЕ бросает (как
 * analytics/badges) — уведомление некритично и не должно ломать вызывающий
 * post-submit или cron. Bulk-вставка одним INSERT для cron-рассылок.
 *
 * При заданном dedupKey добавляем ON CONFLICT DO NOTHING по партиальному
 * уникальному индексу (user_id, dedup_key) — атомарная идемпотентность
 * периодических продюсеров (закрывает TOCTOU параллельных прогонов cron).
 *
 * Возвращает user_id РЕАЛЬНО вставленных строк (returning) — при дедупе их меньше,
 * чем кандидатов, и логи cron должны отражать факт, а не намерение. Именно список,
 * а не счётчик: ретеншен-телеметрия (G2-3) шлёт `nudge_sent` только тем, кому
 * уведомление действительно создано, иначе повторный прогон крона надувал бы
 * знаменатель открываемости.
 */
export async function createNotifications(
  items: NewNotification[],
): Promise<string[]> {
  if (items.length === 0) return [];
  try {
    const q = db.insert(notification).values(
      items.map((n) => ({
        userId: n.userId,
        type: n.type,
        kind: n.kind ?? n.type,
        title: n.title,
        body: n.body ?? null,
        data: n.data ?? null,
        dedupKey: n.dedupKey ?? null,
      })),
    );
    // ON CONFLICT DO NOTHING только когда есть дедуп-ключи. Без target — конфликтовать
    // может лишь partial-индекс по dedup_key (строки без ключа = dedup_key NULL, вне
    // индекса), поэтому не-дедуп-строки в том же батче не задеваются.
    const inserted = await (items.some((n) => n.dedupKey != null)
      ? q.onConflictDoNothing()
      : q
    ).returning({ userId: notification.userId });
    return inserted.map((r) => r.userId);
  } catch (e) {
    await logError({
      source: "server",
      message: `createNotifications failed: ${e instanceof Error ? e.message : String(e)}`,
      stack: e instanceof Error ? e.stack : null,
    });
    return [];
  }
}

export async function createNotification(item: NewNotification): Promise<string[]> {
  return createNotifications([item]);
}
