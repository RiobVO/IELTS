import { AppShellSkeleton } from "@/components/app/Skeletons";
import { Skeleton } from "@/components/core/Skeleton";

/** Скелетон сессии повторов — зеркалит шапку + прогресс-бар + флеш-карту (page.tsx /
 *  ReviewSession.tsx), чтобы свап на контент не давал layout-shift. */
export default function Loading() {
  return (
    <AppShellSkeleton active="vocabulary">
      <div style={{ maxWidth: 640, margin: "0 auto", padding: "24px 16px 64px", display: "flex", flexDirection: "column", gap: 18 }}>
        <div>
          <Skeleton w={120} h={14} style={{ marginBottom: 12 }} />
          <Skeleton w="55%" h={26} style={{ marginBottom: 10 }} />
          <div style={{ display: "flex", gap: 8 }}>
            <Skeleton w={70} h={22} r="var(--radius-full)" />
            <Skeleton w={110} h={22} r="var(--radius-full)" />
          </div>
        </div>

        <Skeleton w="100%" h={8} r="var(--radius-full)" />

        <Skeleton w="100%" h={230} r="var(--radius-xl)" />

        <div style={{ display: "flex", gap: 12 }}>
          <Skeleton w="100%" h={50} r="var(--radius-md)" />
          <Skeleton w="100%" h={50} r="var(--radius-md)" />
        </div>
      </div>
    </AppShellSkeleton>
  );
}
