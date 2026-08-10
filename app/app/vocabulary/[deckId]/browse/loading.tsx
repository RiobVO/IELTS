import { AppShellSkeleton } from "@/components/app/Skeletons";
import { Skeleton } from "@/components/core/Skeleton";

/** Скелетон read-only списка слов (browse/page.tsx) — заголовок + кнопка + строки
 *  таблицы, чтобы свап на контент не давал layout-shift. */
export default function Loading() {
  return (
    <AppShellSkeleton active="vocabulary">
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "24px 16px 56px", display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <Skeleton w={220} h={22} style={{ marginBottom: 8 }} />
            <Skeleton w={180} h={13} />
          </div>
          <Skeleton w={150} h={40} r="var(--radius-sm)" />
        </div>

        <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <Skeleton w={90} h={14} />
              <Skeleton w="45%" h={14} />
              <Skeleton w={70} h={14} style={{ marginLeft: "auto" }} />
            </div>
          ))}
        </div>
      </div>
    </AppShellSkeleton>
  );
}
