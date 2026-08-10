import type * as React from "react";
import { type ActivePage } from "./AppHeader";
import { navHighlight } from "./navActive";
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
  { id: "practice", label: "Practice" },
  { id: "progress", label: "Progress" },
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
      <style>{`
        .ahs-inner{padding:11px 16px;gap:10px}
        .ahs-nav,.ahs-upgrade,.ahs-xp{display:none}
        .ahs-burger{display:grid}
        @media (min-width:1024px){
          .ahs-inner{padding:12px 34px;gap:18px}
          .ahs-nav{display:flex}
          .ahs-upgrade{display:inline-flex}
          .ahs-xp{display:flex}
          .ahs-burger{display:none}
        }
      `}</style>
      <div style={H.bar}>
        <div className="ahs-inner" style={H.inner}>
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

          <nav className="ahs-nav" style={{ marginLeft: 22, gap: 4 }}>
            {NAV.map((l) => {
              // reading/listening loading тоже подсвечивают Practice (как в живой шапке).
              const on = active != null && navHighlight(active) === l.id;
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

          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
            <span className="ahs-upgrade" style={H.upgrade}>
              <Icon name="bar-chart" size={15} strokeWidth={2.4} /> Upgrade
            </span>
            <span style={H.iconBtn}>
              <Icon name="bell" size={19} strokeWidth={2.2} />
            </span>
            <span className="ahs-xp" style={{ alignItems: "center", gap: 16 }}>
              <Skeleton w={42} h={16} r="var(--radius-full)" />
              <Skeleton w={52} h={16} r="var(--radius-full)" />
            </span>
            <Skeleton w={36} h={36} r="50%" />
            <span className="ahs-burger" style={H.iconBtn}>
              <Icon name="menu" size={22} strokeWidth={2.3} />
            </span>
          </div>
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>{children}</div>
    </div>
  );
}

/** Контент-скелет Practice Hub — заголовок, hero-полоса, сетка из 4 skill-карт.
    Сетка зеркалит .ph-grid страницы (1-up → 2-up на 640px), чтобы свап скелета на
    контент не давал layout-shift; брейкпоинт-колонки в классе, не inline. */
export function PracticeSkeleton() {
  return (
    <div className="phs-wrap">
      <style>{`
        .phs-wrap{max-width:1160px;margin:0 auto;display:flex;flex-direction:column;gap:30px;padding:24px 16px 56px}
        .phs-head{display:grid;grid-template-columns:1fr;gap:20px}
        .phs-skills{display:grid;grid-template-columns:1fr;gap:14px}
        .phs-cat{display:grid;grid-template-columns:1fr;gap:20px;align-items:start}
        @media(min-width:560px){.phs-skills{grid-template-columns:repeat(2,1fr);gap:16px}}
        @media(min-width:768px){.phs-wrap{padding:32px 28px 72px}}
        @media(min-width:1024px){
          .phs-head{grid-template-columns:1fr 360px;gap:24px}
          .phs-skills{grid-template-columns:repeat(4,1fr)}
          .phs-cat{grid-template-columns:300px 1fr;gap:24px}
        }
      `}</style>

      {/* header + hero */}
      <div className="phs-head">
        <div>
          <Skeleton w={130} h={14} style={{ marginBottom: 14 }} />
          <Skeleton w="72%" h={40} style={{ marginBottom: 12 }} />
          <Skeleton w="90%" h={16} style={{ marginBottom: 8 }} />
          <Skeleton w="58%" h={16} style={{ marginBottom: 22 }} />
          <Skeleton w={240} h={42} r="var(--radius-full)" />
        </div>
        <Skeleton w="100%" h={200} r={22} />
      </div>

      {/* skills */}
      <div className="phs-skills">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} style={P.card}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <Skeleton w={42} h={42} r={12} />
              <Skeleton w={52} h={22} r="var(--radius-full)" />
            </div>
            <Skeleton w="55%" h={20} style={{ marginBottom: 8 }} />
            <Skeleton w="75%" h={12} />
          </div>
        ))}
      </div>

      {/* catalog: filter + list */}
      <div className="phs-cat">
        <Skeleton w="100%" h={300} r="var(--radius-xl)" />
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <Skeleton w={120} h={22} />
            <Skeleton w={70} h={14} />
          </div>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} style={P.row}>
              <Skeleton w={48} h={48} r={13} />
              <div style={{ flex: 1 }}>
                <Skeleton w={100} h={12} style={{ marginBottom: 8 }} />
                <Skeleton w="58%" h={16} style={{ marginBottom: 6 }} />
                <Skeleton w="40%" h={12} />
              </div>
              <Skeleton w={64} h={40} r="var(--radius-sm)" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const P: Record<string, React.CSSProperties> = {
  card: {
    background: "var(--surface)",
    border: "2px solid var(--border)",
    borderRadius: 18,
    padding: 20,
    boxShadow: "var(--shadow-solid)",
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: 18,
    background: "var(--surface)",
    border: "2px solid var(--border)",
    borderRadius: 18,
    padding: "18px 20px",
    boxShadow: "var(--shadow-solid)",
  },
};

const H: Record<string, React.CSSProperties> = {
  bar: {
    position: "sticky",
    top: 0,
    zIndex: 30,
    background: "color-mix(in oklab, var(--bg-base) 85%, transparent)",
    backdropFilter: "blur(12px)",
    borderBottom: "1px solid var(--border-subtle)",
  },
  inner: { display: "flex", alignItems: "center", maxWidth: 1180, margin: "0 auto" },
  logoMark: {
    width: 34,
    height: 34,
    flex: "none",
    borderRadius: 10,
    display: "grid",
    placeItems: "center",
    background: "linear-gradient(165deg,var(--surface-logo),var(--surface-logo-deep))",
    border: "1px solid var(--surface-logo-border)",
  },
  logoText: { fontFamily: "var(--font-ui)", fontWeight: 800, fontSize: 20, letterSpacing: "-0.02em", color: "var(--text-primary)" },
  nav: { fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", fontWeight: 700, padding: "8px 14px", borderRadius: "var(--radius-md)" },
  upgrade: {
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
