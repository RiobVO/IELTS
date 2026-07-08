"use client";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon, type IconName } from "@/components/core/icons";
import { useInteractive } from "@/components/core/util";
import { notifHref, type NotifPayload } from "@/lib/notifications/view";

export interface NotifItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  read_at: string | null;
  created_at: string;
  /** Разобранный на сервере payload `data` (дискриминированное объединение). */
  payload: NotifPayload;
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
/* Vocab-напоминания приходят как type='system' (падали в серый FALLBACK) — узнаём
   их по payload.kind и красим в цвет раздела Vocabulary (graduation-cap, --success). */
const VOCAB_STYLE: TypeStyle = { icon: "graduation-cap", color: "var(--success)", sub: "var(--success-subtle)" };

function styleFor(n: NotifItem): TypeStyle {
  if (n.payload.kind === "vocab_due_reminder") return VOCAB_STYLE;
  return TYPE[n.type] ?? FALLBACK;
}

/* Адаптив + строки уведомлений. Колокольчик: 40px (44 на touch). Dropdown: на
   десктопе якорится к кнопке (absolute), на мобильном — fixed почти на всю ширину
   под шапкой, иначе панель 360px уезжает за левый край. display/позицию задаём
   классом, не inline. Фон строки/hover — в классах (inline перебил бы hover, а
   транзишен фона гасим при prefers-reduced-motion). */
const NB_CSS = `
.nb-bell{width:40px;height:40px}
@media (pointer:coarse){ .nb-bell{width:44px;height:44px} }
.nb-panel{position:absolute;top:46px;right:0;width:360px}
@media (max-width:1023px){
  .nb-panel{position:fixed;top:58px;left:12px;right:12px;width:auto;max-width:380px;margin-left:auto}
}
/* Тап-таргет 44px на узких телефонах — "Mark all read" был обычным текстом без высоты. */
@media (max-width:430px){
  .nb-markall{display:inline-flex;align-items:center;min-height:44px}
  /* Счётчик непрочитанных — чисто цифровой микро-лейбл, поднимаем до минимума 11px. */
  .nb-badge{font-size:11px!important}
}
.nb-row{display:flex;gap:12px;align-items:flex-start;padding:12px 16px;transition:background-color var(--duration-fast) var(--ease-standard)}
.nb-row.is-read{background:var(--surface)}
.nb-row.is-unread{background:color-mix(in oklab, var(--brand) 4%, var(--surface))}
.nb-row.nb-link{cursor:pointer;text-decoration:none}
/* Двойной класс поднимает специфичность выше .is-unread — иначе тинт перебил бы hover. */
.nb-row.nb-link:hover{background:var(--surface-hover)}
@media (prefers-reduced-motion:reduce){ .nb-row{transition:none} }
.nb-due{flex:none;font-family:var(--font-mono);font-size:var(--text-2xs);font-weight:700;color:var(--success-text);background:var(--success-subtle);border-radius:999px;padding:1px 7px;line-height:1.4}
`;

function relTime(iso: string): string {
  const then = new Date(iso);
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return then.toLocaleDateString("en-US", { day: "numeric", month: "short" });
}

/** Внутренность строки уведомления — общая для ссылочного (<Link>) и статичного (<div>) вариантов. */
function RowInner({ n, isUnread }: { n: NotifItem; isUnread: boolean }) {
  const st = styleFor(n);
  const dueCount = n.payload.kind === "vocab_due_reminder" ? n.payload.dueCount : 0;
  return (
    <>
      <span style={{ flex: "none", width: 34, height: 34, borderRadius: 10, display: "grid", placeItems: "center", background: st.sub, color: st.color }}>
        <Icon name={st.icon} size={17} strokeWidth={2.3} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: isUnread ? 700 : 600, color: isUnread ? "var(--text-primary)" : "var(--text-secondary)", lineHeight: 1.3 }}>{n.title}</div>
          {dueCount > 0 && <span className="nb-due">{dueCount} due</span>}
        </div>
        {n.body && (
          <div style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 2, lineHeight: 1.4, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{n.body}</div>
        )}
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)", color: "var(--text-muted)", marginTop: 4 }}>{relTime(n.created_at)}</div>
      </div>
      {isUnread && <span style={{ flex: "none", width: 7, height: 7, borderRadius: "50%", background: st.color, marginTop: 6 }} />}
    </>
  );
}

/**
 * Колокольчик уведомлений с выпадающим окошком (вместо отдельной страницы).
 * Данные приходят с сервера (AppShell) — компонент рисует, закрывается по клику-вне
 * / Esc и делает уведомления действенными: кликабельный пункт (payload.href) —
 * это <Link>, клик по непрочитанному оптимистично снимает unread + вызывает
 * markOneRead и уводит по ссылке. markAllRead/markOneRead — проброшенные server
 * actions; после markAll router.refresh() перечитывает серверный счётчик, при
 * переходе по ссылке layout ревалидируется навигацией.
 */
export function NotificationsBell({
  unread,
  items,
  markAllRead,
  markOneRead,
}: {
  unread: number;
  items: NotifItem[];
  markAllRead: () => Promise<void>;
  markOneRead: (id: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  // Оптимистично прочитанные id: снимают unread мгновенно, до ревалидации сервера.
  const [locallyRead, setLocallyRead] = useState<ReadonlySet<string>>(() => new Set());
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const bell = useInteractive();

  // Счётчик с поправкой на оптимистично прочитанные (считаем только те, что были
  // непрочитанными на сервере — чтобы не уйти в минус при повторных кликах).
  const shownUnread = useMemo(() => {
    const cleared = items.filter((n) => n.read_at === null && locallyRead.has(n.id)).length;
    return Math.max(0, unread - cleared);
  }, [items, unread, locallyRead]);

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

  // Клик по кликабельному пункту: закрыть окно, оптимистично снять unread и
  // отметить прочитанным на сервере. Навигацию выполняет сам <Link>; если она
  // отрендерила шапку ДО завершения экшена, серверный счётчик остался бы старым —
  // поэтому после await добираем router.refresh(), как в handleMarkAll.
  const openItem = (n: NotifItem) => {
    setOpen(false);
    if (n.read_at === null && !locallyRead.has(n.id)) {
      setLocallyRead((prev) => new Set(prev).add(n.id));
      startTransition(async () => {
        await markOneRead(n.id);
        router.refresh();
      });
    }
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
        {shownUnread > 0 && (
          <span
            className="nb-badge"
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
            {shownUnread > 9 ? "9+" : shownUnread}
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
            {shownUnread > 0 && (
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)", fontWeight: 700, color: "var(--brand-active)", background: "var(--brand-subtle)", borderRadius: 999, padding: "2px 8px" }}>{shownUnread}</span>
            )}
            {shownUnread > 0 && (
              <button
                type="button"
                onClick={handleMarkAll}
                disabled={pending}
                className="nb-markall"
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
                const isUnread = n.read_at === null && !locallyRead.has(n.id);
                const href = notifHref(n.payload);
                const borderBottom = i < items.length - 1 ? "1px solid var(--border-subtle)" : "none";
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
        </div>
      )}
    </div>
  );
}
