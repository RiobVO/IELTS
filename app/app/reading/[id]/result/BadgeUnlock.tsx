"use client";

import { Icon, type IconName } from "@/components/core/icons";

interface UnlockedBadge {
  id: string;
  code: string;
  name: string;
  description: string | null;
  icon: string | null;
}

/**
 * BadgeUnlock — единственный праздничный момент (BRIEF §4.7): spring-pop на
 * появлении, с уважением к reduced-motion. Визуал — bando.
 */
export default function BadgeUnlock({ badges }: { badges: UnlockedBadge[] }) {
  if (badges.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      <style>{`@keyframes bando-badge-pop{from{opacity:0;transform:scale(.9)}to{opacity:1;transform:none}}@media (prefers-reduced-motion:reduce){.bando-badge{animation:none!important}}`}</style>
      {badges.map((b, i) => (
        <div
          key={b.code || b.id}
          className="bando-badge"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-4)",
            padding: "var(--space-4)",
            background: "linear-gradient(180deg, var(--surface-raised), var(--surface))",
            border: "1px solid var(--brand-border)",
            borderRadius: "var(--radius-lg)",
            boxShadow: "var(--glow-brand)",
            animation: `bando-badge-pop 560ms var(--ease-spring) ${i * 110}ms`,
          }}
        >
          <div style={{ width: 48, height: 48, flex: "none", display: "grid", placeItems: "center", borderRadius: "var(--radius-md)", background: "var(--brand-subtle)", color: "var(--brand-hover)" }}>
            <Icon name={(b.icon as IconName) || "trophy"} size={24} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-2xs)", fontWeight: 700, letterSpacing: "var(--tracking-caps)", textTransform: "uppercase", color: "var(--text-link)" }}>Badge unlocked</div>
            <div style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-lg)", fontWeight: 700, color: "var(--text-primary)", marginTop: 2 }}>{b.name}</div>
            {b.description && <div style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)", color: "var(--text-secondary)", marginTop: 2 }}>{b.description}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}
