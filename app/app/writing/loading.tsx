import type * as React from "react";
import { AppShellSkeleton } from "@/components/app/Skeletons";
import { Skeleton } from "@/components/core/Skeleton";

/**
 * Route-level skeleton for /app/writing. The catalog is `force-dynamic` and reaches
 * cloud Supabase, so navigation can wait on a round-trip — without a skeleton the prior
 * screen freezes. Mirrors WritingCatalog structurally (header, controls, card grid; the
 * grid breakpoint matches `.wl-grid` so the swap to real content doesn't shift layout).
 * Presentational, stateless → server component.
 */
export default function Loading() {
  return (
    <AppShellSkeleton active="practice">
      <div className="wls-wrap">
        <style>{`
          .wls-wrap{max-width:1100px;margin:0 auto;display:flex;flex-direction:column;gap:24px;padding:24px 16px 56px}
          .wls-controls{display:flex;flex-direction:column;gap:12px}
          .wls-segrow{display:flex;flex-wrap:wrap;gap:10px}
          .wls-searchrow{display:flex;flex-wrap:wrap;align-items:center;gap:12px}
          .wls-grid{display:grid;grid-template-columns:1fr;gap:16px}
          @media(min-width:680px){.wls-grid{grid-template-columns:repeat(auto-fill,minmax(330px,1fr))}}
          @media(min-width:768px){.wls-wrap{padding:32px 28px 72px}}
        `}</style>

        {/* header */}
        <div>
          <Skeleton w={110} h={12} style={{ marginBottom: 14 }} />
          <Skeleton w={220} h={36} style={{ marginBottom: 14 }} />
          <Skeleton w="80%" h={15} style={{ marginBottom: 6 }} />
          <Skeleton w="55%" h={15} />
        </div>

        {/* controls: three segmented groups + search row */}
        <div className="wls-controls">
          <div className="wls-segrow">
            {[112, 104, 150].map((w, i) => (
              <Skeleton key={i} w={w} h={56} r={11} />
            ))}
          </div>
          <div className="wls-searchrow">
            <Skeleton w={240} h={42} r="var(--radius-md)" style={{ flex: 1, minWidth: 200 }} />
            <Skeleton w={120} h={42} r="var(--radius-md)" />
            <Skeleton w={130} h={14} />
          </div>
        </div>

        {/* grid */}
        <div className="wls-grid">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} style={C.card}>
              <Skeleton w="100%" h={5} r={0} />
              <div style={C.body}>
                <div style={C.metaRow}>
                  <Skeleton w={96} h={24} r={8} />
                  <Skeleton w={80} h={14} />
                </div>
                <Skeleton w="100%" h={16} style={{ marginBottom: 8 }} />
                <Skeleton w="70%" h={16} style={{ marginBottom: 24 }} />
                <div style={C.footer}>
                  <Skeleton w={110} h={14} />
                  <Skeleton w={36} h={36} r="var(--radius-full)" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </AppShellSkeleton>
  );
}

const C: Record<string, React.CSSProperties> = {
  card: {
    display: "flex",
    flexDirection: "column",
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-lg)",
    overflow: "hidden",
    boxShadow: "var(--shadow-xs)",
  },
  body: { padding: "20px 20px 16px", display: "flex", flexDirection: "column" },
  metaRow: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 15 },
  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    borderTop: "1px solid var(--border-subtle)",
    paddingTop: 15,
  },
};
