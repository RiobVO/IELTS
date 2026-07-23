import type * as React from "react";
import { AppShellSkeleton } from "@/components/app/Skeletons";
import { Skeleton } from "@/components/core/Skeleton";

export default function Loading() {
  return (
    <AppShellSkeleton active="notifications">
      <div style={S.wrap}>
        <div style={S.head}>
          <Skeleton w={180} h={26} />
          <Skeleton w={120} h={36} r="var(--radius-md)" />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} style={S.row}>
              <Skeleton w="40%" h={14} style={{ marginBottom: 8 }} />
              <Skeleton w="100%" h={12} style={{ marginBottom: 6 }} />
              <Skeleton w={90} h={10} />
            </div>
          ))}
        </div>
      </div>
    </AppShellSkeleton>
  );
}

const S: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 720, margin: "0 auto", padding: "30px 28px 48px" },
  head: { display: "flex", justifyContent: "space-between", alignItems: "center", margin: "0 0 18px", gap: 16 },
  row: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "14px 16px" },
};
