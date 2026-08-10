"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useInteractive } from "@/components/core/util";
import { Icon } from "@/components/core/icons";
import { Button } from "@/components/core/Button";
import { NotificationsBell, type NotifItem } from "./NotificationsBell";
import { navHighlight } from "./navActive";

/** Активный раздел сайта — подсветка в навигации. */
export type ActivePage =
  | "dashboard"
  | "practice"
  | "reading"
  | "listening"
  | "progress"
  | "vocabulary"
  | "pricing"
  | "profile";

interface AppHeaderProps {
  active: ActivePage;
  streak: number;
  xp: number;
  initials: string;
  unread: number;
  /** Последние уведомления для dropdown-окошка колокольчика. */
  recent: NotifItem[];
  /** Server actions проброшены со страницы (RSC), чтобы не тянуть импорт через границу. */
  markAllRead: () => Promise<void>;
  signOut: () => Promise<void>;
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

const LINKS: { id: ActivePage; label: string; href: string; icon: Parameters<typeof Icon>[0]["name"] }[] = [
  { id: "dashboard", label: "Home", href: "/app", icon: "target" },
  // Practice — единый вход во все 4 skill; reading/listening остаются каталогами
  // под ним и подсвечивают этот пункт (см. navHighlight).
  { id: "practice", label: "Practice", href: "/app/practice", icon: "dumbbell" },
  // Progress — объединённый раздел League + Badges (route-табы внутри /app/progress).
  { id: "progress", label: "Progress", href: "/app/progress", icon: "award" },
  // Vocabulary — flashcards с интервальным повторением (SRS), отдельный раздел.
  { id: "vocabulary", label: "Vocabulary", href: "/app/vocabulary", icon: "graduation-cap" },
];

const COLORS_TRANSITION =
  "background-color var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard), border-color var(--duration-fast) var(--ease-standard)";

/* Адаптив шапки. Inline-стили не держат @media, поэтому переключаемые элементы
   получают класс (display задаётся ТОЛЬКО классом, не inline — иначе inline
   перебьёт media-query). База = мобильный (бургер, drawer-навигация);
   ≥1024px = десктоп (горизонтальная навигация, скрытый бургер). */
const HEADER_CSS = `
.ah-bar{padding:11px 16px;gap:10px}
.ah-nav{display:none}
.ah-xp{display:none}
.ah-upgrade{display:none}
.ah-signout{display:none}
.ah-burger{display:grid}
.ah-drawer{display:flex;animation:ah-drawer-in var(--duration-base) var(--ease-out)}
.ah-scrim{display:block;animation:ah-scrim-in var(--duration-base) var(--ease-standard)}
@keyframes ah-drawer-in{from{transform:translateX(100%)}to{transform:translateX(0)}}
@keyframes ah-scrim-in{from{opacity:0}to{opacity:1}}
@media (min-width:1024px){
  .ah-bar{padding:12px 34px;gap:18px}
  .ah-nav{display:flex}
  .ah-xp{display:inline-flex}
  .ah-upgrade{display:inline-flex}
  .ah-signout{display:flex}
  .ah-burger{display:none}
  .ah-drawer,.ah-scrim{display:none}
}
.ah-tap{width:40px;height:40px}
@media (pointer:coarse){ .ah-tap{width:44px;height:44px} }
/* Профильный аватар — единственный тап-таргет шапки без бампа (36×36). Визуальный
   кружок не трогаем — расширяем хит-зону до 44×44 псевдоэлементом на узких экранах. */
.ah-avatar{position:relative}
@media (max-width:430px){
  .ah-avatar::before{content:"";position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:44px;height:44px}
}
`;

function NavLink({ link, active }: { link: (typeof LINKS)[number]; active: boolean }) {
  const { hover, handlers } = useInteractive();
  return (
    <Link
      href={link.href}
      {...handlers}
      style={{
        textDecoration: "none",
        background: active ? "var(--brand-subtle)" : hover ? "var(--surface-hover)" : "transparent",
        color: active ? "var(--text-link)" : "var(--text-secondary)",
        fontFamily: "var(--font-ui)",
        fontSize: "var(--text-sm)",
        fontWeight: 700,
        padding: "8px 14px",
        borderRadius: "var(--radius-md)",
        transition: COLORS_TRANSITION,
      }}
    >
      {link.label}
    </Link>
  );
}

/** Строка навигации внутри мобильного drawer — крупная touch-цель, активный фон. */
function DrawerLink({ link, active, onClose }: { link: (typeof LINKS)[number]; active: boolean; onClose: () => void }) {
  return (
    <Link
      href={link.href}
      onClick={onClose}
      aria-current={active ? "page" : undefined}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 13,
        minHeight: 48,
        padding: "0 14px",
        borderRadius: "var(--radius-md)",
        textDecoration: "none",
        background: active ? "var(--brand-subtle)" : "transparent",
        color: active ? "var(--text-link)" : "var(--text-secondary)",
        fontFamily: "var(--font-ui)",
        fontSize: "var(--text-md)",
        fontWeight: 700,
      }}
    >
      <Icon name={link.icon} size={19} strokeWidth={2.3} style={{ color: active ? "var(--brand)" : "var(--text-muted)" }} />
      {link.label}
      <Icon name="chevron-right" size={17} strokeWidth={2.2} style={{ marginLeft: "auto", color: "var(--text-disabled)" }} />
    </Link>
  );
}

/** Ghost-иконка справа (выход на десктопе). Hover — мягкая подложка. */
function IconAction({
  children,
  hover,
  handlers,
  extra,
}: {
  children: React.ReactNode;
  hover: boolean;
  handlers: React.HTMLAttributes<HTMLElement>;
  extra?: React.CSSProperties;
}) {
  return (
    <span
      {...handlers}
      style={{
        position: "relative",
        width: 38,
        height: 38,
        borderRadius: "var(--radius-md)",
        display: "grid",
        placeItems: "center",
        color: "var(--text-secondary)",
        background: hover ? "var(--surface-hover)" : "transparent",
        transition: COLORS_TRANSITION,
        ...extra,
      }}
    >
      {children}
    </span>
  );
}

function StatPill({ icon, value, label, color }: { icon: Parameters<typeof Icon>[0]["name"]; value: string; label: string; color: string }) {
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: "var(--radius-md)", background: "var(--surface-inset)" }}>
      <Icon name={icon} size={20} strokeWidth={2.3} style={{ color }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-lg)", fontWeight: 600, color: "var(--text-primary)", lineHeight: 1 }}>{value}</div>
        <div style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-2xs)", fontWeight: 600, color: "var(--text-muted)", marginTop: 3 }}>{label}</div>
      </div>
    </div>
  );
}

export function AppHeader({ active, streak, xp, initials, unread, recent, markAllRead, signOut }: AppHeaderProps) {
  const upgrade = useInteractive();
  const out = useInteractive();
  const burger = useInteractive();
  const [open, setOpen] = useState(false);
  const onPricing = active === "pricing";
  // Practice-пункт подсвечивается и на /app/reading, и на /app/listening.
  const hi = navHighlight(active);

  // Drawer: Esc закрывает, body-scroll лочится пока открыт, ресайз в десктоп
  // (≥1024px) закрывает — иначе скрытый классом drawer оставит scroll-lock висеть.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const mq = window.matchMedia("(min-width:1024px)");
    const onMq = (e: MediaQueryListEvent) => { if (e.matches) setOpen(false); };
    document.addEventListener("keydown", onKey);
    mq.addEventListener("change", onMq);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      mq.removeEventListener("change", onMq);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 30,
        background: "color-mix(in oklab, var(--bg-base) 85%, transparent)",
        backdropFilter: "blur(12px)",
        // Промоутим шапку в свой compositor-слой: фрост-blur рекомпозитится на GPU, а
        // собственные пиксели (тинт/бордер/лого/нав) не перерисовываются на каждом кадре
        // скролла. translateZ(0) не ломает backdrop-filter — transform на самом элементе
        // не создаёт backdrop-root (в отличие от filter/will-change на предке).
        transform: "translateZ(0)",
        borderBottom: "1px solid var(--border-subtle)",
      }}
    >
      <style>{HEADER_CSS}</style>

      <div className="ah-bar" style={{ display: "flex", alignItems: "center", maxWidth: 1180, margin: "0 auto" }}>
        <Link href="/app" style={{ display: "flex", alignItems: "center", gap: 11, textDecoration: "none" }}>
          <span style={{ width: 34, height: 34, flex: "none", borderRadius: 10, display: "grid", placeItems: "center", background: "linear-gradient(165deg,var(--surface-logo),var(--surface-logo-deep))", border: "1px solid var(--surface-logo-border)" }}>
            {/* inline SVG (не <img>) — иначе currentColor рисует бары чёрными на тёмной плитке */}
            <svg width="19" height="19" viewBox="0 0 64 64" fill="none" aria-hidden="true">
              <rect x="9" y="18" width="34" height="9" rx="4.5" fill="var(--brand)" />
              <rect x="9" y="31" width="46" height="9" rx="4.5" fill="#fff" opacity="0.92" />
              <rect x="9" y="44" width="22" height="9" rx="4.5" fill="#fff" opacity="0.5" />
            </svg>
          </span>
          <span style={{ fontFamily: "var(--font-ui)", fontWeight: 800, fontSize: 20, letterSpacing: "-0.02em", color: "var(--text-primary)" }}>
            band<span style={{ color: "var(--brand)" }}>o</span>
          </span>
        </Link>

        <nav className="ah-nav" style={{ marginLeft: 22, gap: 4 }}>
          {LINKS.map((l) => (
            <NavLink key={l.id} link={l} active={hi === l.id} />
          ))}
        </nav>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
          <Link
            href="/app/upgrade"
            className="ah-upgrade"
            {...upgrade.handlers}
            style={{
              alignItems: "center",
              gap: 6,
              height: 38,
              padding: "0 16px",
              border: "2px solid var(--brand-border)",
              background: onPricing || upgrade.hover ? "var(--brand-subtle)" : "transparent",
              color: "var(--text-link)",
              fontFamily: "var(--font-ui)",
              fontSize: "var(--text-sm)",
              fontWeight: 800,
              borderRadius: "var(--radius-md)",
              textDecoration: "none",
              transition: COLORS_TRANSITION,
            }}
          >
            <Icon name="bar-chart" size={15} strokeWidth={2.4} /> Upgrade
          </Link>

          {/* Колокольчик уведомлений — dropdown-окошко (вместо отдельной страницы). */}
          <NotificationsBell unread={unread} items={recent} markAllRead={markAllRead} />

          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 800, color: "var(--streak)" }} title="Day streak">
            <Icon name="flame" size={17} strokeWidth={2.4} /> {streak}
          </span>
          <span className="ah-xp" style={{ alignItems: "center", gap: 6, fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 800, color: "var(--warn-text)" }} title="Total XP">
            <Icon name="trophy" size={16} strokeWidth={2.4} /> {fmt(xp)}
          </span>

          <Link
            href="/app/profile"
            aria-label="Profile"
            title="Profile"
            className="ah-avatar"
            style={{
              width: 36,
              height: 36,
              borderRadius: "50%",
              background: active === "profile" ? "linear-gradient(165deg, var(--brand), var(--brand-active))" : "var(--surface-hover)",
              display: "grid",
              placeItems: "center",
              fontFamily: "var(--font-ui)",
              fontSize: 13,
              fontWeight: 700,
              color: active === "profile" ? "var(--text-on-brand)" : "var(--text-secondary)",
              boxShadow: active === "profile" ? "none" : "inset 0 0 0 1px var(--border)",
              textDecoration: "none",
            }}
          >
            {initials}
          </Link>

          {/* Выход — дизайн-хедер его не содержит; сохранён, т.к. иначе из нового UI не выйти.
              На мобильном живёт в drawer (.ah-signout скрыт классом). */}
          <form action={signOut} className="ah-signout" style={{ alignItems: "center" }}>
            <button type="submit" aria-label="Sign out" title="Sign out" style={{ border: "none", background: "transparent", padding: 0, cursor: "pointer" }}>
              <IconAction hover={out.hover} handlers={out.handlers}>
                <Icon name="log-out" size={18} strokeWidth={2.2} />
              </IconAction>
            </button>
          </form>

          {/* Бургер — только мобильный (.ah-burger скрыт на десктопе). */}
          <button
            type="button"
            className="ah-burger ah-tap"
            aria-label="Menu"
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-controls="ah-drawer"
            onClick={() => setOpen(true)}
            {...burger.handlers}
            style={{
              placeItems: "center",
              borderRadius: "var(--radius-md)",
              border: "none",
              background: open || burger.hover ? "var(--surface-hover)" : "transparent",
              color: "var(--text-secondary)",
              cursor: "pointer",
              transition: COLORS_TRANSITION,
            }}
          >
            <Icon name="menu" size={22} strokeWidth={2.3} />
          </button>
        </div>
      </div>
      </div>

      {/* Scrim + drawer — вне sticky-обёртки шапки: fixed-потомок внутри предка с
          transform/backdrop-filter контейнится его коробкой (предок становится
          containing block), иначе inset:0/top:0 считались бы от шапки, а не вьюпорта.
          Только мобильный, рендерятся пока open (slide-in через @keyframes; при
          закрытии элемент исчезает → нет off-screen overflow). Класс
          .ah-drawer/.ah-scrim гасит их на десктопе на случай open при ресайзе. */}
      {open && (
        <>
          <div
            className="ah-scrim"
            onClick={() => setOpen(false)}
            aria-hidden="true"
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 60,
              background: "color-mix(in oklab, var(--slate-950) 48%, transparent)",
            }}
          />
          <nav
            id="ah-drawer"
            className="ah-drawer"
            aria-label="Main menu"
            style={{
              position: "fixed",
              top: 0,
              right: 0,
              bottom: 0,
              zIndex: 61,
              width: "min(86vw, 340px)",
              flexDirection: "column",
              background: "var(--surface)",
              borderLeft: "1px solid var(--border)",
              boxShadow: "var(--shadow-lg)",
              padding: "max(14px, env(safe-area-inset-top)) max(14px, env(safe-area-inset-right)) max(18px, env(safe-area-inset-bottom)) 14px",
              overflowY: "auto",
            }}
          >
        <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
          <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-base)", fontWeight: 800, color: "var(--text-primary)" }}>Menu</span>
          <button
            type="button"
            className="ah-tap"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            style={{ marginLeft: "auto", display: "grid", placeItems: "center", borderRadius: "var(--radius-md)", border: "none", background: "var(--surface-inset)", color: "var(--text-secondary)", cursor: "pointer" }}
          >
            <Icon name="x" size={20} strokeWidth={2.3} />
          </button>
        </div>

        <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
          <StatPill icon="flame" value={String(streak)} label="day streak" color="var(--streak)" />
          <StatPill icon="trophy" value={fmt(xp)} label="total XP" color="var(--warn-text)" />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {LINKS.map((l) => (
            <DrawerLink key={l.id} link={l} active={hi === l.id} onClose={() => setOpen(false)} />
          ))}
        </div>

        <div style={{ height: 1, background: "var(--border-subtle)", margin: "16px 0" }} />

        <Button href="/app/upgrade" icon="bar-chart" fullWidth onClick={() => setOpen(false)}>
          Upgrade
        </Button>
        <form action={signOut} style={{ marginTop: 10 }}>
          <Button type="submit" variant="secondary" icon="log-out" fullWidth>
            Sign out
          </Button>
        </form>
          </nav>
        </>
      )}
    </>
  );
}
