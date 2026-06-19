import type * as React from "react";
import { AppShellSkeleton } from "@/components/app/Skeletons";
import { Skeleton } from "@/components/core/Skeleton";

export default function Loading() {
  return (
    <AppShellSkeleton active="profile">
      <div style={S.wrap}>
        <div style={S.head}>
          <Skeleton w={76} h={76} r="50%" />
          <div style={{ flex: 1 }}>
            <Skeleton w={200} h={26} style={{ marginBottom: 8 }} />
            <Skeleton w={160} h={14} />
          </div>
        </div>

        <div style={S.statsBar}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} style={{ flex: 1, textAlign: "center", padding: "16px 8px" }}>
              <Skeleton w={50} h={26} style={{ margin: "0 auto 6px" }} />
              <Skeleton w={70} h={12} style={{ margin: "0 auto" }} />
            </div>
          ))}
        </div>

        <div style={S.cols}>
          <div style={S.card}>
            <Skeleton w={100} h={16} style={{ marginBottom: 18 }} />
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 13, padding: "14px 0", borderBottom: "1px solid var(--border-subtle)" }}>
                <Skeleton w={36} h={36} r="10px" />
                <Skeleton w={90} h={14} />
                <Skeleton w={60} h={20} r="var(--radius-full)" style={{ marginLeft: "auto" }} />
              </div>
            ))}
            <Skeleton w="100%" h={44} r="var(--radius-md)" style={{ marginTop: 16 }} />
          </div>
          <div style={S.invite}>
            <Skeleton w={140} h={20} style={{ background: "rgba(255,255,255,0.25)", marginBottom: 14 }} />
            <Skeleton w="90%" h={14} style={{ background: "rgba(255,255,255,0.18)", marginBottom: 8 }} />
            <Skeleton w="70%" h={14} style={{ background: "rgba(255,255,255,0.18)", marginBottom: 20 }} />
            <Skeleton w={150} h={42} r="var(--radius-md)" style={{ background: "rgba(255,255,255,0.25)" }} />
          </div>
        </div>

        <Skeleton w={180} h={22} style={{ margin: "26px 0 12px" }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} w="100%" h={56} r="var(--radius-md)" />
          ))}
        </div>
      </div>
    </AppShellSkeleton>
  );
}

const S: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 820, margin: "0 auto", padding: "30px 28px 48px" },
  head: { display: "flex", alignItems: "center", gap: 20, marginBottom: 22 },
  statsBar: { display: "flex", background: "var(--surface)", border: "2px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-solid)", marginBottom: 16 },
  cols: { display: "grid", gridTemplateColumns: "1fr 1.1fr", gap: 16, alignItems: "start" },
  card: { background: "var(--surface)", border: "2px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-solid)", padding: "20px" },
  invite: { background: "linear-gradient(160deg, var(--surface-premium), var(--surface-premium-deep))", borderRadius: "var(--radius-xl)", padding: 24 },
};
