import type * as React from "react";
import { AppShellSkeleton } from "@/components/app/Skeletons";
import { Skeleton } from "@/components/core/Skeleton";

export default function Loading() {
  return (
    <AppShellSkeleton active="reading">
      <div style={S.wrap}>
        <Skeleton w={110} h={32} r="var(--radius-md)" style={{ marginBottom: 16 }} />

        {/* score header */}
        <div style={S.scoreCard}>
          <div>
            <Skeleton w={90} h={14} style={{ marginBottom: 12 }} />
            <Skeleton w={120} h={56} />
          </div>
          <div style={{ marginLeft: "auto", textAlign: "right" }}>
            <Skeleton w={80} h={30} style={{ marginBottom: 8, marginLeft: "auto" }} />
            <Skeleton w={120} h={14} style={{ marginLeft: "auto" }} />
          </div>
        </div>

        {/* breakdown */}
        <div style={S.section}>
          <Skeleton w={200} h={22} style={{ marginBottom: 6 }} />
          <Skeleton w={120} h={14} style={{ marginBottom: 16 }} />
          <div style={S.card}>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
                <div style={{ flex: 1 }}>
                  <Skeleton w={140} h={14} style={{ marginBottom: 8 }} />
                  <Skeleton w="100%" h={10} r="var(--radius-full)" />
                </div>
                <Skeleton w={44} h={16} />
              </div>
            ))}
          </div>
        </div>

        <div style={S.footer}>
          <Skeleton w="100%" h={48} r="var(--radius-md)" />
          <Skeleton w="100%" h={48} r="var(--radius-md)" />
        </div>
      </div>
    </AppShellSkeleton>
  );
}

const S: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 720, margin: "0 auto", padding: "30px 28px 48px" },
  scoreCard: { display: "flex", alignItems: "center", background: "var(--surface)", border: "2px solid var(--border)", borderRadius: "var(--radius-xl)", boxShadow: "var(--shadow-solid)", padding: 28, marginBottom: 20 },
  section: { marginBottom: 24 },
  card: { background: "var(--surface)", border: "2px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-solid)", padding: 20 },
  footer: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 8 },
};
