"use client";
import Link from "next/link";
import { useInteractive } from "@/components/core/util";
import { Icon } from "@/components/core/icons";

/** Активный раздел сайта — подсветка в навигации. */
export type ActivePage =
  | "dashboard"
  | "reading"
  | "listening"
  | "leaderboard"
  | "badges"
  | "pricing"
  | "profile";

interface AppHeaderProps {
  active: ActivePage;
  streak: number;
  xp: number;
  initials: string;
  unread: number;
  /** Server action выхода — проброшен со страницы (RSC), чтобы не тянуть импорт через границу. */
  signOut: () => Promise<void>;
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

const LINKS: { id: ActivePage; label: string; href: string }[] = [
  { id: "dashboard", label: "Home", href: "/app" },
  { id: "reading", label: "Reading", href: "/app/reading" },
  { id: "listening", label: "Listening", href: "/app/listening" },
  { id: "leaderboard", label: "League", href: "/app/leaderboard" },
  { id: "badges", label: "Badges", href: "/app/badges" },
];

const COLORS_TRANSITION =
  "background-color var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard), border-color var(--duration-fast) var(--ease-standard)";

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

/** Ghost-иконка справа (колокольчик / выход). Hover — мягкая подложка. */
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

export function AppHeader({ active, streak, xp, initials, unread, signOut }: AppHeaderProps) {
  const upgrade = useInteractive();
  const bell = useInteractive();
  const out = useInteractive();
  const onPricing = active === "pricing";

  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 30,
        background: "color-mix(in oklab, var(--bg-base) 85%, transparent)",
        backdropFilter: "blur(12px)",
        borderBottom: "1px solid var(--border-subtle)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 18, padding: "12px 34px", maxWidth: 1180, margin: "0 auto" }}>
        <Link href="/app" style={{ display: "flex", alignItems: "center", gap: 11, textDecoration: "none" }}>
          <span style={{ width: 34, height: 34, flex: "none", borderRadius: 10, display: "grid", placeItems: "center", background: "linear-gradient(165deg,#211B33,#0E0B17)", border: "1px solid #2C2640" }}>
            <img src="/bando-mark.svg" width="19" height="19" alt="" />
          </span>
          <span style={{ fontFamily: "var(--font-ui)", fontWeight: 800, fontSize: 20, letterSpacing: "-0.02em", color: "var(--text-primary)" }}>
            band<span style={{ color: "var(--brand)" }}>o</span>
          </span>
        </Link>

        <nav style={{ marginLeft: 22, display: "flex", gap: 4 }}>
          {LINKS.map((l) => (
            <NavLink key={l.id} link={l} active={active === l.id} />
          ))}
        </nav>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 16 }}>
          <Link
            href="/app/upgrade"
            {...upgrade.handlers}
            style={{
              display: "inline-flex",
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

          {/* Колокольчик уведомлений (использует уже полученный unread; сохраняет доступ к /app/notifications). */}
          <Link href="/app/notifications" aria-label="Notifications" title="Notifications" style={{ textDecoration: "none" }}>
            <IconAction hover={bell.hover} handlers={bell.handlers}>
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
                    background: "var(--error)",
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
            </IconAction>
          </Link>

          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 800, color: "var(--streak)" }} title="Day streak">
            <Icon name="flame" size={17} strokeWidth={2.4} /> {streak}
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 800, color: "var(--warn-text)" }} title="Total XP">
            <Icon name="trophy" size={16} strokeWidth={2.4} /> {fmt(xp)}
          </span>

          <Link
            href="/app/profile"
            aria-label="Profile"
            title="Profile"
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

          {/* Выход — дизайн-хедер его не содержит; сохранён, т.к. иначе из нового UI не выйти. */}
          <form action={signOut} style={{ display: "flex" }}>
            <button type="submit" aria-label="Sign out" title="Sign out" style={{ border: "none", background: "transparent", padding: 0, cursor: "pointer" }}>
              <IconAction hover={out.hover} handlers={out.handlers}>
                <Icon name="log-out" size={18} strokeWidth={2.2} />
              </IconAction>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
