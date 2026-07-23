import type * as React from "react";
import { Skeleton } from "@/components/core/Skeleton";

/** Admin живёт вне /app shell (свой <main>), поэтому без AppShellSkeleton. */
export default function Loading() {
  return (
    <main style={S.page}>
      <div style={S.wrap}>
        <Skeleton w={120} h={28} style={{ marginBottom: 8 }} />
        <Skeleton w={260} h={14} style={{ marginBottom: 20 }} />

        <div style={S.card}>
          <Skeleton w={160} h={16} style={{ marginBottom: 10 }} />
          <Skeleton w="90%" h={14} style={{ marginBottom: 16 }} />
          <Skeleton w={200} h={40} r="var(--radius-md)" />
        </div>

        <Skeleton w={120} h={16} style={{ margin: "28px 0 12px" }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} w="100%" h={64} r="var(--radius-md)" />
          ))}
        </div>
      </div>
    </main>
  );
}

const S: Record<string, React.CSSProperties> = {
  page: { minHeight: "100dvh", padding: "2.5rem 1.5rem 4rem", background: "var(--bg-base)" },
  wrap: { maxWidth: 760, margin: "0 auto" },
  card: { background: "var(--surface)", border: "2px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-solid)", padding: "20px", marginTop: 20 },
};
