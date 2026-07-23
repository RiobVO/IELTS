import type * as React from "react";
import { AppShellSkeleton } from "@/components/app/Skeletons";
import { Skeleton } from "@/components/core/Skeleton";

export default function Loading() {
  return (
    <AppShellSkeleton active="leaderboard">
      <div style={S.arena}>
        <div style={S.wrap}>
          <div style={S.head}>
            <Skeleton w={46} h={46} r={14} />
            <div style={{ flex: 1 }}>
              <Skeleton w={180} h={26} style={{ marginBottom: 8 }} />
              <Skeleton w={120} h={14} />
            </div>
          </div>

          <Skeleton w="100%" h={44} r="var(--radius-md)" style={{ marginBottom: 18 }} />

          {/* podium */}
          <div style={S.podium}>
            {[120, 168, 96].map((h, i) => (
              <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
                <Skeleton w={i === 1 ? 78 : 60} h={i === 1 ? 78 : 60} r="50%" />
                <Skeleton w={70} h={14} />
                <Skeleton w="100%" h={h} r="14px 14px 0 0" />
              </div>
            ))}
          </div>

          <Skeleton w="100%" h={80} r="var(--radius-xl)" style={{ margin: "18px 0 10px" }} />

          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} w="100%" h={60} r="var(--radius-md)" />
            ))}
          </div>
        </div>
      </div>
    </AppShellSkeleton>
  );
}

const S: Record<string, React.CSSProperties> = {
  arena: { minHeight: "100%", background: "radial-gradient(120% 80% at 50% -8%, color-mix(in oklab, var(--brand) 14%, white) 0%, var(--bg-base) 52%)" },
  wrap: { maxWidth: 720, margin: "0 auto", padding: "26px 28px 44px" },
  head: { display: "flex", alignItems: "center", gap: 13, marginBottom: 16 },
  podium: { display: "grid", gridTemplateColumns: "1fr 1.12fr 1fr", alignItems: "end", gap: 12, marginTop: 8 },
};
