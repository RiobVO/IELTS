"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon, type IconName } from "@/components/core/icons";
import { useInteractive } from "@/components/core/util";

export interface NotifItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  read_at: string | null;
  created_at: string;
}

interface TypeStyle {
  icon: IconName;
  color: string;
  sub: string;
}
/** Визуальное представление по реальным значениям notification_type (schema). */
const TYPE: Record<string, TypeStyle> = {
  badge_unlocked: { icon: "award", color: "var(--brand)", sub: "var(--brand-subtle)" },
  streak_reminder: { icon: "flame", color: "var(--streak)", sub: "var(--streak-subtle)" },
  weekly_digest: { icon: "bar-chart", color: "var(--info)", sub: "var(--info-subtle)" },
  system: { icon: "bell", color: "var(--text-muted)", sub: "var(--surface-inset)" },
};
const FALLBACK: TypeStyle = { icon: "bell", color: "var(--text-muted)", sub: "var(--surface-inset)" };

/* Адаптив. Колокольчик: 40px (44 на touch). Dropdown: на десктопе якорится к
   кнопке (absolute), на мобильном — fixed почти на всю ширину под шапкой, иначе
   панель 360px уезжает за левый край. display/позицию задаём классом, не inline. */
const NB_CSS = `
.nb-bell{width:40px;height:40px}
@media (pointer:coarse){ .nb-bell{width:44px;height:44px} }
.nb-panel{position:absolute;top:46px;right:0;width:360px}
@media (max-width:1023px){
  .nb-panel{position:fixed;top:58px;left:12px;right:12px;width:auto;max-width:380px;margin-left:auto}
}
`;

function relTime(iso: string): string {
  const then = new Date(iso);
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return then.toLocaleDateString("en-US", { day: "numeric", month: "short" });
}

/**
 * Колокольчик уведомлений с выпадающим окошком (вместо отдельной страницы).
 * Данные приходят с сервера (AppShell) — компонент только рисует и закрывается по
 * клику-вне / Esc; markAllRead — проброшенный server action, после него
 * router.refresh() перечитывает серверный счётчик и список.
 */
export function NotificationsBell({
  unread,
  items,
  markAllRead,
}: {
  unread: number;
  items: NotifItem[];
  markAllRead: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const bell = useInteractive();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const handleMarkAll = () => {
    startTransition(async () => {
      await markAllRead();
      router.refresh();
    });
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <style>{NB_CSS}</style>
      <button
        type="button"
        className="nb-bell"
        aria-label="Notifications"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        {...bell.handlers}
        style={{
          position: "relative",
          borderRadius: "var(--radius-md)",
          display: "grid",
          placeItems: "center",
          color: "var(--text-secondary)",
          background: open || bell.hover ? "var(--surface-hover)" : "transparent",
          border: "none",
          cursor: "pointer",
          transition: "background-color var(--duration-fast) var(--ease-standard)",
        }}
      >
        <Icon name="bell" size={19} strokeWidth={2.2} />
        {unread > 0 && (
          <span
            style={{
              position: "absolute",
              top: 4,
              right: 4,
              minWidth: 16,
              height: 16,
              padding: "0 4px",
              borderRadius: "var(--radius-full)",
              background: "var(--error-edge)",
              color: "#fff",
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              fontWeight: 700,
              display: "grid",
              placeItems: "center",
              lineHeight: 1,
            }}
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="nb-panel"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-xl)",
            boxShadow: "var(--shadow-lg)",
            overflow: "hidden",
            zIndex: 50,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: "1px solid var(--border-subtle)" }}>
            <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-base)", fontWeight: 800, color: "var(--text-primary)" }}>Notifications</span>
            {unread > 0 && (
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)", fontWeight: 700, color: "var(--brand-active)", background: "var(--brand-subtle)", borderRadius: 999, padding: "2px 8px" }}>{unread}</span>
            )}
            {unread > 0 && (
              <button
                type="button"
                onClick={handleMarkAll}
                disabled={pending}
                style={{ marginLeft: "auto", border: "none", background: "transparent", color: "var(--text-link)", fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", fontWeight: 700, cursor: pending ? "default" : "pointer", opacity: pending ? 0.5 : 1 }}
              >
                Mark all read
              </button>
            )}
          </div>

          {items.length === 0 ? (
            <div style={{ padding: "30px 18px", textAlign: "center", fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
              No notifications yet. Unlocked badges, streak reminders and the weekly digest will land here.
            </div>
          ) : (
            <div style={{ maxHeight: 380, overflowY: "auto" }}>
              {items.map((n, i) => {
                const t = TYPE[n.type] ?? FALLBACK;
                const isUnread = n.read_at === null;
                return (
                  <div
                    key={n.id}
                    style={{
                      display: "flex",
                      gap: 12,
                      alignItems: "flex-start",
                      padding: "12px 16px",
                      borderBottom: i < items.length - 1 ? "1px solid var(--border-subtle)" : "none",
                      background: isUnread ? "color-mix(in oklab, var(--brand) 4%, var(--surface))" : "var(--surface)",
                    }}
                  >
                    <span style={{ flex: "none", width: 34, height: 34, borderRadius: 10, display: "grid", placeItems: "center", background: t.sub, color: t.color }}>
                      <Icon name={t.icon} size={17} strokeWidth={2.3} />
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: isUnread ? 700 : 600, color: isUnread ? "var(--text-primary)" : "var(--text-secondary)", lineHeight: 1.3 }}>{n.title}</div>
                      {n.body && (
                        <div style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 2, lineHeight: 1.4, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{n.body}</div>
                      )}
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)", color: "var(--text-muted)", marginTop: 4 }}>{relTime(n.created_at)}</div>
                    </div>
                    {isUnread && <span style={{ flex: "none", width: 7, height: 7, borderRadius: "50%", background: t.color, marginTop: 6 }} />}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
