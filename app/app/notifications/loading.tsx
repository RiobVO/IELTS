import type * as React from "react";
import { AppShellSkeleton } from "@/components/app/Skeletons";
import { Skeleton } from "@/components/core/Skeleton";

/**
 * Скелетон истории уведомлений. Зеркалит структуру страницы (заголовок + чипы
 * фильтра + карточка со строками), чтобы подмена на контент не давала layout-shift.
 * active='notifications' → в шапке-скелете ни один пункт не подсвечен (как на живой
 * странице). Презентационный, без состояния → серверный.
 */
export default function Loading() {
  return (
    <AppShellSkeleton active="notifications">
      <div style={S.wrap}>
        <div style={S.head}>
          <Skeleton w={150} h={28} />
          <Skeleton w={96} h={16} style={{ marginLeft: "auto" }} />
        </div>

        {/* filter chips */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
          {[52, 74, 66, 70, 68].map((w, i) => (
            <Skeleton key={i} w={w} h={36} r="var(--radius-full)" />
          ))}
        </div>

        {/* list card */}
        <div style={S.card}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} style={{ ...S.row, borderBottom: i < 5 ? "1px solid var(--border-subtle)" : "none" }}>
              <Skeleton w={34} h={34} r={10} />
              <div style={{ flex: 1 }}>
                <Skeleton w="55%" h={15} style={{ marginBottom: 8 }} />
                <Skeleton w="82%" h={12} style={{ marginBottom: 6 }} />
                <Skeleton w={64} h={10} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </AppShellSkeleton>
  );
}

const S: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 720, margin: "0 auto", padding: "22px 16px 48px" },
  head: { display: "flex", alignItems: "center", gap: 12, marginBottom: 16 },
  card: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-xl)", overflow: "hidden" },
  row: { display: "flex", gap: 12, alignItems: "flex-start", padding: "12px 16px" },
};
