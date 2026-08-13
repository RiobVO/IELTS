/**
 * Чистая логика уведомлений: безопасный разбор нетипизированного jsonb-поля `data`
 * в дискриминированное объединение + вывод навигационной цели. Без server/client
 * зависимостей — импортируется и из header-data (server), и из NotificationsBell
 * (client), и покрывается vitest'ом.
 *
 * Продюсеры кладут в `data` разные формы (vocab-cron: {kind,href,dueCount};
 * badges: {code,icon}; referral: null), а колонка в БД — просто jsonb, поэтому на
 * входе тип `unknown`: разбираем защитно, любая кривая форма схлопывается в `plain`
 * (некликабельное уведомление), а не роняет шапку.
 */

/**
 * Разобранный payload. Дискриминант — `kind` (по `type`, а для system — по
 * `data.kind`). `plain` = уведомление без действия (streak/digest/referral).
 */
export type NotifPayload =
  | { kind: "vocab_due_reminder"; href: string; dueCount: number }
  | { kind: "badge_unlocked"; href: string }
  | { kind: "plain" };

const VOCAB_DUE_REMINDER_KIND = "vocab_due_reminder";
const VOCAB_FALLBACK_HREF = "/app/vocabulary";
/** Бейджи живут на route-табе /app/badges раздела Progress. */
const BADGE_HREF = "/app/badges";

/**
 * Разбирает (type, data) в типизированный payload. НИКОГДА не бросает: неизвестный
 * type или кривой `data` → `plain`. Иконку бейджа из `data.icon` осознанно не
 * тащим — в БД это эмодзи, для Lucide-Icon непригодна (стиль бейджа берётся из
 * TYPE-map компонента по type).
 */
/** Внутренний app-путь: начинается с одиночного `/` (не `//`, не схема). */
function isInternalHref(v: unknown): v is string {
  return typeof v === "string" && v.startsWith("/") && !v.startsWith("//");
}

export function parseNotifPayload(type: string, data: unknown): NotifPayload {
  const d =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : null;

  if (type === "badge_unlocked") {
    return { kind: "badge_unlocked", href: BADGE_HREF };
  }

  if (type === "system" && d?.kind === VOCAB_DUE_REMINDER_KIND) {
    // Только внутренние пути: data пишется сервером, но RLS-грант UPDATE пока не
    // сколонкован (ужесточается миграцией) — внешний/`javascript:`-href из jsonb
    // не должен стать Link. `//host` — protocol-relative, тоже наружу.
    const href = isInternalHref(d.href) ? d.href : VOCAB_FALLBACK_HREF;
    const dueCount =
      typeof d.dueCount === "number" && Number.isFinite(d.dueCount) && d.dueCount > 0
        ? Math.floor(d.dueCount)
        : 0;
    return { kind: "vocab_due_reminder", href, dueCount };
  }

  return { kind: "plain" };
}

/** Навигационная цель уведомления, либо null для некликабельного `plain`. */
export function notifHref(payload: NotifPayload): string | null {
  return payload.kind === "plain" ? null : payload.href;
}
