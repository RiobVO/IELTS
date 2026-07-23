import type * as React from "react";
import { AppShellSkeleton } from "@/components/app/Skeletons";
import { Skeleton } from "@/components/core/Skeleton";

/**
 * Скелетон для /app/upgrade/checkout. Совпадает по форме с реальной страницей
 * (узкая колонка 520px: заголовок + карточка деталей платежа + кнопка), чтобы при
 * переходе не мелькал широкий скелетон тарифов из родительского upgrade/loading и
 * не было «прыжка» формы. Те же токены/радиусы/тени, что на странице.
 */
export default function Loading() {
  return (
    <AppShellSkeleton active="pricing">
      <div style={S.wrap}>
        <Skeleton w={220} h={30} style={{ marginBottom: 18 }} />
        <div style={S.card}>
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              style={{ ...S.row, borderBottom: i === 4 ? "none" : "1px solid var(--border-subtle)" }}
            >
              <Skeleton w={68} h={14} />
              <Skeleton w={96} h={14} />
            </div>
          ))}
        </div>
        <div style={{ margin: "16px 0" }}>
          <Skeleton w="100%" h={14} style={{ marginBottom: 6 }} />
          <Skeleton w="70%" h={14} />
        </div>
        <Skeleton w="100%" h={48} r="var(--radius-md)" />
      </div>
    </AppShellSkeleton>
  );
}

const S: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 520, margin: "0 auto", padding: "30px 28px 48px" },
  card: { background: "var(--surface)", border: "2px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-solid)", padding: "8px 20px" },
  row: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0" },
};
