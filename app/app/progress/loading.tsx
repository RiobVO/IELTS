import type * as React from "react";
import { AppShellSkeleton } from "@/components/app/Skeletons";
import { Skeleton } from "@/components/core/Skeleton";

/**
 * Скелетон раздела Progress. loading.tsx не получает searchParams, поэтому зеркалим
 * таб-бар + ДЕФОЛТНЫЙ (overview) таб — самый частый вход (роутер дефолтит на overview).
 * При переходе в league/badges свап контента даст короткий рефлоу, что допустимо для
 * fallback; зато на дефолтном приземлении нет мигания подиумом и layout-shift.
 */
export default function Loading() {
  return (
    <AppShellSkeleton active="progress">
      <div style={S.wrap}>
        {/* tab bar (overview / league / badges) */}
        <div style={{ display: "flex", gap: 9, marginBottom: 18 }}>
          <Skeleton w={104} h={38} r="var(--radius-full)" />
          <Skeleton w={92} h={38} r="var(--radius-full)" />
          <Skeleton w={92} h={38} r="var(--radius-full)" />
        </div>

        {/* head */}
        <div style={{ marginBottom: 16 }}>
          <Skeleton w={150} h={28} style={{ marginBottom: 8 }} />
          <Skeleton w={300} h={14} />
        </div>

        {/* trajectory hero */}
        <Skeleton w="100%" h={300} r="var(--radius-xl)" style={{ marginBottom: 16 }} />

        {/* forecast + readiness */}
        <div style={S.grid}>
          <Skeleton w="100%" h={196} r="var(--radius-xl)" />
          <Skeleton w="100%" h={196} r="var(--radius-xl)" />
        </div>

        {/* league / badges previews */}
        <div style={S.previews}>
          <Skeleton w="100%" h={72} r="var(--radius-lg)" />
          <Skeleton w="100%" h={72} r="var(--radius-lg)" />
        </div>
      </div>
    </AppShellSkeleton>
  );
}

const S: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 960, margin: "0 auto", padding: "22px 16px 44px" },
  // auto-fit → две колонки на широком, одна на узком, без брейкпоинтов (совпадает с
  // ov-grid/ov-previews по числу колонок, минимум layout-shift при гидратации).
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))", gap: 14, marginBottom: 12 },
  previews: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))", gap: 12 },
};
