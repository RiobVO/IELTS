import type * as React from "react";
import { type ActivePage } from "./AppHeader";
import { Icon } from "@/components/core/icons";
import { Skeleton } from "@/components/core/Skeleton";

/**
 * Скелетоны зоны /app. Шапка живёт в каждой page (через AppShell), а не в layout,
 * поэтому при навигации Next подменяет page целиком вместе с шапкой — без «призрака»
 * она бы мигала. AppShellSkeleton зеркалит хедер структурно (лого+nav реальны,
 * streak/xp/avatar → плейсхолдеры), чтобы подмена читалась как «шапка осталась,
 * контент сменился скелетом». Презентационный, без состояния → серверный.
 */

const NAV = [
  { id: "dashboard", label: "Home" },
  { id: "reading", label: "Reading" },
  { id: "listening", label: "Listening" },
  { id: "leaderboard", label: "League" },
  { id: "badges", label: "Badges" },
] as const;

export function AppShellSkeleton({
  active,
  children,
}: {
  active?: ActivePage;
  children: React.ReactNode;
}) {
  return (
    <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", background: "var(--bg-base)" }}>
      <div style={H.bar}>
        <div style={H.inner}>
          <span style={{ display: "flex", alignItems: "center", gap: 11 }}>
            <span style={H.logoMark}>
              <svg width="19" height="19" viewBox="0 0 64 64" fill="none" aria-hidden="true">
                <rect x="9" y="18" width="34" height="9" rx="4.5" fill="var(--brand)" />
                <rect x="9" y="31" width="46" height="9" rx="4.5" fill="#fff" opacity="0.92" />
                <rect x="9" y="44" width="22" height="9" rx="4.5" fill="#fff" opacity="0.5" />
              </svg>
            </span>
            <span style={H.logoText}>
              band<span style={{ color: "var(--brand)" }}>o</span>
            </span>
          </span>

          <nav style={{ marginLeft: 22, display: "flex", gap: 4 }}>
            {NAV.map((l) => {
              const on = active === l.id;
              return (
                <span
                  key={l.id}
                  style={{
                    ...H.nav,
                    background: on ? "var(--brand-subtle)" : "transparent",
                    color: on ? "var(--text-link)" : "var(--text-secondary)",
                  }}
                >
                  {l.label}
                </span>
              );
            })}
          </nav>

          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 16 }}>
            <span style={H.upgrade}>
              <Icon name="bar-chart" size={15} strokeWidth={2.4} /> Upgrade
            </span>
            <span style={H.iconBtn}>
              <Icon name="bell" size={19} strokeWidth={2.2} />
            </span>
            <Skeleton w={42} h={16} r="var(--radius-full)" />
            <Skeleton w={52} h={16} r="var(--radius-full)" />
            <Skeleton w={36} h={36} r="50%" />
          </div>
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>{children}</div>
    </div>
  );
}

/** Контент-скелет каталога — общий для Reading и Listening (один _CatalogView). */
export function CatalogSkeleton() {
  return (
    <div style={C.wrap}>
      <Skeleton w={210} h={26} style={{ marginBottom: 8 }} />
      <Skeleton w={330} h={14} style={{ marginBottom: 18 }} />

      <div style={C.filter}>
        <Skeleton w={120} h={18} style={{ marginBottom: 16 }} />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {[84, 120, 96, 110, 70].map((w, i) => (
            <Skeleton key={i} w={w} h={30} r="var(--radius-full)" />
          ))}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} style={C.card}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <Skeleton w={90} h={20} r="var(--radius-full)" />
              <Skeleton w={48} h={14} style={{ marginLeft: "auto" }} />
            </div>
            <Skeleton w="58%" h={20} style={{ marginBottom: 14 }} />
            <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
              {[70, 90, 60].map((w, j) => (
                <Skeleton key={j} w={w} h={18} r="var(--radius-full)" />
              ))}
            </div>
            <Skeleton w={80} h={16} />
          </div>
        ))}
      </div>
    </div>
  );
}

const H: Record<string, React.CSSProperties> = {
  bar: {
    position: "sticky",
    top: 0,
    zIndex: 30,
    background: "color-mix(in oklab, var(--bg-base) 85%, transparent)",
    backdropFilter: "blur(12px)",
    borderBottom: "1px solid var(--border-subtle)",
  },
  inner: { display: "flex", alignItems: "center", gap: 18, padding: "12px 34px", maxWidth: 1180, margin: "0 auto" },
  logoMark: {
    width: 34,
    height: 34,
    flex: "none",
    borderRadius: 10,
    display: "grid",
    placeItems: "center",
    background: "linear-gradient(165deg,#211B33,#0E0B17)",
    border: "1px solid #2C2640",
  },
  logoText: { fontFamily: "var(--font-ui)", fontWeight: 800, fontSize: 20, letterSpacing: "-0.02em", color: "var(--text-primary)" },
  nav: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 700, padding: "8px 14px", borderRadius: "var(--radius-md)" },
  upgrade: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    height: 38,
    padding: "0 16px",
    border: "2px solid var(--brand-border)",
    color: "var(--text-link)",
    fontFamily: "var(--font-ui)",
    fontSize: "var(--text-sm)",
    fontWeight: 800,
    borderRadius: "var(--radius-md)",
  },
  iconBtn: { width: 38, height: 38, borderRadius: "var(--radius-md)", display: "grid", placeItems: "center", color: "var(--text-secondary)" },
};

const C: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 980, margin: "0 auto", padding: "var(--space-8) var(--space-6) var(--space-12)" },
  filter: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-xl)",
    padding: "var(--space-5)",
    boxShadow: "var(--shadow-sm)",
    marginBottom: 18,
  },
  card: {
    background: "var(--surface)",
    border: "2px solid var(--border)",
    borderRadius: "var(--radius-lg)",
    padding: "var(--space-4)",
    boxShadow: "var(--shadow-solid)",
  },
};
