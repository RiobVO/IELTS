import type * as React from "react";
import { AppShellSkeleton } from "@/components/app/Skeletons";
import { Skeleton } from "@/components/core/Skeleton";

export default function Loading() {
  return (
    <AppShellSkeleton active="badges">
      <style>{`.bdl-wrap{padding:22px 16px 44px}.bdl-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}@media(min-width:560px){.bdl-grid{grid-template-columns:repeat(3,1fr)}}@media(min-width:820px){.bdl-wrap{padding:30px 28px 48px}.bdl-grid{grid-template-columns:repeat(4,1fr);gap:14px}}`}</style>
      <div className="bdl-wrap" style={S.wrap}>
        <div style={S.head}>
          <div style={{ flex: 1 }}>
            <Skeleton w={140} h={26} style={{ marginBottom: 8 }} />
            <Skeleton w={320} h={14} />
          </div>
          <Skeleton w={60} h={30} />
        </div>

        <div className="bdl-grid">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} style={S.tile}>
              <Skeleton w={48} h={48} r="50%" style={{ margin: "0 auto 14px" }} />
              <Skeleton w="70%" h={16} style={{ margin: "0 auto 8px" }} />
              <Skeleton w="90%" h={12} style={{ margin: "0 auto 4px" }} />
              <Skeleton w="60%" h={12} style={{ margin: "0 auto" }} />
            </div>
          ))}
        </div>
      </div>
    </AppShellSkeleton>
  );
}

const S: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 980, margin: "0 auto" },
  head: { display: "flex", alignItems: "flex-end", gap: 14, marginBottom: 22 },
  tile: { background: "var(--surface)", border: "2px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-solid)", padding: "20px 18px", textAlign: "center" },
};
