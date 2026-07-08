"use client";
import { type CSSProperties, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { notifHref } from "@/lib/notifications/view";
import { RowInner, NB_CSS, type NotifItem } from "@/components/app/NotificationsBell";
import type { NotifCursor, NotifPage } from "@/lib/notifications/list";

/* Локальные стили страницы истории. Ховер чипов и prefers-reduced-motion — в
   классах (inline не держит :hover/@media). Список переиспользует .nb-row из
   NB_CSS, поэтому unread-стайлинг идентичен dropdown'у колокольчика. */
const NL_CSS = `
.nl-chip{border:1px solid var(--border);background:var(--surface);color:var(--text-secondary);font-family:var(--font-ui);font-size:var(--text-xs);font-weight:700;padding:7px 14px;min-height:36px;border-radius:var(--radius-full);cursor:pointer;transition:background-color var(--duration-fast) var(--ease-standard),color var(--duration-fast) var(--ease-standard),border-color var(--duration-fast) var(--ease-standard)}
.nl-chip:hover{background:var(--surface-hover)}
.nl-chip.is-active{background:var(--brand-subtle);color:var(--text-link);border-color:var(--brand-border)}
.nl-loadmore{width:100%;min-height:44px;border:1px solid var(--border);background:var(--surface);color:var(--text-link);font-family:var(--font-ui);font-size:var(--text-sm);font-weight:700;border-radius:var(--radius-md);cursor:pointer;transition:background-color var(--duration-fast) var(--ease-standard)}
.nl-loadmore:hover{background:var(--surface-hover)}
.nl-loadmore:disabled{cursor:default;opacity:0.55}
@media (prefers-reduced-motion:reduce){ .nl-chip,.nl-loadmore{transition:none} }
`;

const FILTERS = [
  { id: "all", label: "All" },
  { id: "badges", label: "Badges" },
  { id: "vocab", label: "Vocab" },
  { id: "streak", label: "Streak" },
  { id: "digest", label: "Digest" },
] as const;
type FilterId = (typeof FILTERS)[number]["id"];

/** Соответствие уведомления фильтру. Vocab узнаётся по payload.kind (type='system'). */
function matchesFilter(n: NotifItem, f: FilterId): boolean {
  switch (f) {
    case "all":
      return true;
    case "badges":
      return n.type === "badge_unlocked";
    case "vocab":
      return n.payload.kind === "vocab_due_reminder";
    case "streak":
      return n.type === "streak_reminder";
    case "digest":
      return n.type === "weekly_digest";
  }
}

/**
 * Полная история уведомлений с фильтром по типу и подгрузкой «Load more». Серверные
 * данные — начальная страница + курсор; фильтр — клиентский стейт поверх загруженных
 * страниц (не грузим всё разом). Клик по кликабельному пункту уводит по ссылке и
 * оптимистично помечает прочитанным (markOneRead); «Mark all read» — оптимистично
 * гасит все загруженные + серверный экшен (шапка догонит на навигации/refocus).
 */
export function NotificationsList({
  initialItems,
  initialCursor,
  loadMore,
  markAllRead,
  markOneRead,
}: {
  initialItems: NotifItem[];
  initialCursor: NotifCursor | null;
  loadMore: (cursor: NotifCursor) => Promise<NotifPage>;
  markAllRead: () => Promise<void>;
  markOneRead: (id: string) => Promise<void>;
}) {
  const [items, setItems] = useState<NotifItem[]>(initialItems);
  const [cursor, setCursor] = useState<NotifCursor | null>(initialCursor);
  const [filter, setFilter] = useState<FilterId>("all");
  const [locallyRead, setLocallyRead] = useState<ReadonlySet<string>>(() => new Set());
  const [loadingMore, setLoadingMore] = useState(false);
  const [pending, startTransition] = useTransition();

  const visible = useMemo(() => items.filter((n) => matchesFilter(n, filter)), [items, filter]);
  const anyUnread = useMemo(
    () => items.some((n) => n.read_at === null && !locallyRead.has(n.id)),
    [items, locallyRead],
  );

  const handleMarkAll = () => {
    // Оптимистично помечаем все загруженные; серверный markAllRead гасит на бэке
    // (revalidatePath('/app','layout') обновит счётчик шапки на след. запросе). Не
    // router.refresh — иначе потеряли бы подгруженные страницы (сброс к первой).
    setLocallyRead(new Set(items.map((n) => n.id)));
    startTransition(() => {
      void markAllRead();
    });
  };

  const openItem = (n: NotifItem) => {
    if (n.read_at === null && !locallyRead.has(n.id)) {
      setLocallyRead((prev) => new Set(prev).add(n.id));
      startTransition(() => {
        void markOneRead(n.id);
      });
    }
  };

  const handleLoadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await loadMore(cursor);
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    } catch {
      // Best-effort: сбой подгрузки не рушит показанное; кнопка снова активна для
      // повторной попытки. Серверная сторона уже залогировала (fetchNotifPage).
    } finally {
      setLoadingMore(false);
    }
  };

  const activeLabel = FILTERS.find((f) => f.id === filter)?.label ?? "";

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "22px 16px 48px" }}>
      <style>{NB_CSS}</style>
      <style>{NL_CSS}</style>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontFamily: "var(--font-ui)", fontSize: "var(--text-xl)", fontWeight: 800, color: "var(--text-primary)" }}>
          Notifications
        </h1>
        {anyUnread && (
          <button
            type="button"
            onClick={handleMarkAll}
            disabled={pending}
            style={{
              marginLeft: "auto",
              border: "none",
              background: "transparent",
              color: "var(--text-link)",
              fontFamily: "var(--font-ui)",
              fontSize: "var(--text-sm)",
              fontWeight: 700,
              minHeight: 44,
              cursor: pending ? "default" : "pointer",
              opacity: pending ? 0.5 : 1,
            }}
          >
            Mark all read
          </button>
        )}
      </div>

      <div role="group" aria-label="Filter notifications" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`nl-chip${filter === f.id ? " is-active" : ""}`}
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <div style={emptyStyle}>
          No notifications yet. Unlocked badges, streak reminders and the weekly digest will land here.
        </div>
      ) : visible.length === 0 ? (
        <div style={emptyStyle}>
          {cursor
            ? `No ${activeLabel.toLowerCase()} notifications loaded yet — load more below.`
            : `No ${activeLabel.toLowerCase()} notifications yet.`}
        </div>
      ) : (
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-xl)", overflow: "hidden" }}>
          {visible.map((n, i) => {
            const isUnread = n.read_at === null && !locallyRead.has(n.id);
            const href = notifHref(n.payload);
            const borderBottom = i < visible.length - 1 ? "1px solid var(--border-subtle)" : "none";
            const cls = `nb-row ${isUnread ? "is-unread" : "is-read"}${href ? " nb-link" : ""}`;
            return href ? (
              <Link key={n.id} href={href} className={cls} onClick={() => openItem(n)} style={{ borderBottom }}>
                <RowInner n={n} isUnread={isUnread} />
              </Link>
            ) : (
              <div key={n.id} className={cls} style={{ borderBottom }}>
                <RowInner n={n} isUnread={isUnread} />
              </div>
            );
          })}
        </div>
      )}

      {cursor && (
        <button type="button" className="nl-loadmore" onClick={handleLoadMore} disabled={loadingMore} style={{ marginTop: 16 }}>
          {loadingMore ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}

const emptyStyle: CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-xl)",
  padding: "40px 20px",
  textAlign: "center",
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-sm)",
  color: "var(--text-muted)",
};
