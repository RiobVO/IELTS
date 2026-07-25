import type * as React from "react";
import { AppShellSkeleton } from "@/components/app/Skeletons";
import { Skeleton } from "@/components/core/Skeleton";

export default function Loading() {
  return (
    <AppShellSkeleton active="dashboard">
      <style>{`.dl-wrap{padding:20px 16px 48px}.dl-split{display:grid;grid-template-columns:1fr;gap:14px}@media(min-width:768px){.dl-wrap{padding:32px 28px 56px}.dl-split{grid-template-columns:1.2fr 1fr;gap:22px}}`}</style>
      <div className="dl-wrap" style={S.wrap}>
        {/* progress + ring */}
        <div className="dl-split">
          <div style={{ ...S.card, padding: 34 }}>
            <Skeleton w={120} h={12} style={{ marginBottom: 18 }} />
            <Skeleton w={150} h={64} style={{ marginBottom: 18 }} />
            <Skeleton w="80%" h={16} style={{ marginBottom: 8 }} />
            <Skeleton w="55%" h={16} style={{ marginBottom: 26 }} />
            <Skeleton w={190} h={48} r="var(--radius-md)" />
          </div>
          <div style={{ ...S.card, padding: 34, display: "grid", placeItems: "center" }}>
            <Skeleton w={220} h={220} r="50%" />
          </div>
        </div>

        {/* stats */}
        <div style={S.stats}>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} style={{ ...S.card, padding: 22, display: "flex", alignItems: "center", gap: 16 }}>
              <Skeleton w={48} h={48} r="var(--radius-md)" />
              <div style={{ flex: 1 }}>
                <Skeleton w={70} h={22} style={{ marginBottom: 6 }} />
                <Skeleton w={54} h={12} />
              </div>
            </div>
          ))}
        </div>

        {/* weak + focus */}
        <div className="dl-split" style={{ alignItems: "stretch" }}>
          <div style={{ ...S.card, padding: 30 }}>
            <Skeleton w={150} h={20} style={{ marginBottom: 24 }} />
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} style={{ marginBottom: 20 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <Skeleton w={120} h={14} />
                  <Skeleton w={40} h={14} />
                </div>
                <Skeleton w="100%" h={10} r="var(--radius-full)" />
              </div>
            ))}
          </div>
          <div style={S.focus}>
            <Skeleton w={90} h={12} style={{ background: "rgba(255,255,255,0.25)" }} />
            <Skeleton w={160} h={24} style={{ background: "rgba(255,255,255,0.3)" }} />
            <Skeleton w="90%" h={14} style={{ background: "rgba(255,255,255,0.2)" }} />
            <Skeleton w="65%" h={14} style={{ background: "rgba(255,255,255,0.2)" }} />
            <Skeleton w={150} h={42} r="var(--radius-md)" style={{ background: "rgba(255,255,255,0.25)", marginTop: "auto" }} />
          </div>
        </div>

        {/* recent */}
        <div style={{ ...S.card, padding: "26px 30px" }}>
          <Skeleton w={140} h={20} style={{ marginBottom: 18 }} />
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} style={S.recentRow}>
              <Skeleton w={40} h={40} r="var(--radius-md)" />
              <div style={{ flex: 1 }}>
                <Skeleton w="40%" h={16} style={{ marginBottom: 6 }} />
                <Skeleton w={120} h={12} />
              </div>
              <Skeleton w={64} h={16} />
            </div>
          ))}
        </div>
      </div>
    </AppShellSkeleton>
  );
}

const S: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 1160, margin: "0 auto", display: "flex", flexDirection: "column", gap: 22 },
  card: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-xl)", boxShadow: "var(--shadow-sm)" },
  stats: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 22 },
  focus: { borderRadius: "var(--radius-xl)", padding: 32, background: "linear-gradient(150deg, var(--brand) 0%, var(--brand-active) 100%)", boxShadow: "var(--shadow-md)", display: "flex", flexDirection: "column", gap: 12 },
  recentRow: { display: "flex", alignItems: "center", gap: 14, padding: "14px 0", borderBottom: "1px solid var(--border-subtle)" },
};
