import type * as React from "react";
import { AppShellSkeleton } from "@/components/app/Skeletons";
import { Skeleton } from "@/components/core/Skeleton";

export default function Loading() {
  return (
    <AppShellSkeleton active="profile">
      <div style={S.wrap}>
        <Skeleton w={200} h={26} style={{ marginBottom: 8 }} />
        <Skeleton w={320} h={14} style={{ marginBottom: 20 }} />
        <div style={S.invite}>
          <Skeleton w={160} h={20} style={{ background: "rgba(255,255,255,0.25)", marginBottom: 14 }} />
          <Skeleton w="80%" h={14} style={{ background: "rgba(255,255,255,0.18)", marginBottom: 20 }} />
          <Skeleton w="100%" h={48} r="var(--radius-md)" style={{ background: "rgba(255,255,255,0.22)", marginBottom: 16 }} />
          <Skeleton w={200} h={14} style={{ background: "rgba(255,255,255,0.18)" }} />
        </div>
      </div>
    </AppShellSkeleton>
  );
}

const S: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 720, margin: "0 auto", padding: "30px 28px 48px" },
  invite: { background: "linear-gradient(160deg, #2A2342, #14101F)", borderRadius: "var(--radius-xl)", padding: 28 },
};
