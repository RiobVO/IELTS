import type * as React from "react";
import { AppShellSkeleton } from "@/components/app/Skeletons";
import { Skeleton } from "@/components/core/Skeleton";

export default function Loading() {
  return (
    <AppShellSkeleton active="pricing">
      <div style={S.wrap}>
        <div style={{ textAlign: "center", marginBottom: 30 }}>
          <Skeleton w={300} h={20} r="var(--radius-full)" style={{ margin: "0 auto 14px" }} />
          <Skeleton w={260} h={34} style={{ margin: "0 auto 10px" }} />
          <Skeleton w={420} h={16} style={{ margin: "0 auto" }} />
        </div>
        <Skeleton w={200} h={44} r="var(--radius-full)" style={{ margin: "0 auto 30px" }} />

        <div style={S.plans}>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} style={S.plan}>
              <Skeleton w={100} h={22} style={{ marginBottom: 8 }} />
              <Skeleton w="80%" h={14} style={{ marginBottom: 16 }} />
              <Skeleton w={120} h={40} style={{ marginBottom: 18 }} />
              <Skeleton w="100%" h={48} r="var(--radius-md)" style={{ marginBottom: 20 }} />
              {Array.from({ length: 6 }).map((_, j) => (
                <div key={j} style={{ display: "flex", gap: 10, marginBottom: 12 }}>
                  <Skeleton w={20} h={20} r="50%" />
                  <Skeleton w="80%" h={14} />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </AppShellSkeleton>
  );
}

const S: Record<string, React.CSSProperties> = {
  wrap: { padding: "38px 28px 56px" },
  plans: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 18, alignItems: "start", maxWidth: 920, margin: "0 auto" },
  plan: { background: "var(--surface)", border: "2px solid var(--border)", borderRadius: "var(--radius-xl)", boxShadow: "var(--shadow-solid)", padding: "26px 24px" },
};
