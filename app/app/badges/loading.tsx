import type * as React from "react";
import { AppShellSkeleton } from "@/components/app/Skeletons";
import { Skeleton } from "@/components/core/Skeleton";

/** Зеркалит реальный лейаут badges: header → hero-spotlight → 2 колонки
 * (4 трек-строки + 3 сайдбар-карточки), чтобы при загрузке не было layout shift. */
export default function Loading() {
  return (
    <AppShellSkeleton active="badges">
      <style>{`
.bdl-wrap{padding:22px 16px 48px}
.bdl-cols{display:grid;grid-template-columns:1fr;gap:14px}
.bdl-rail{display:flex;justify-content:space-between;padding:0 6px}
@media(min-width:900px){.bdl-wrap{padding:30px 28px 56px}.bdl-cols{grid-template-columns:1.65fr 1fr;align-items:start}}
`}</style>
      <div className="bdl-wrap" style={S.wrap}>
        {/* header */}
        <div style={S.head}>
          <div style={{ flex: 1 }}>
            <Skeleton w={120} h={28} style={{ marginBottom: 8 }} />
            <Skeleton w={300} h={14} />
          </div>
          <Skeleton w={64} h={64} r="50%" />
        </div>

        {/* hero spotlight */}
        <Skeleton w="100%" h={132} r="var(--radius-2xl)" style={{ marginBottom: 26 }} />

        <div className="bdl-cols">
          {/* tracks */}
          <div>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} style={S.track}>
                <div style={S.trackHead}>
                  <Skeleton w={30} h={30} r={9} />
                  <Skeleton w={110} h={16} />
                  <Skeleton w={36} h={12} style={{ marginLeft: "auto" }} />
                </div>
                <div className="bdl-rail">
                  {Array.from({ length: 3 }).map((_, j) => (
                    <div key={j} style={S.node}>
                      <Skeleton w={62} h={62} r="50%" style={{ marginBottom: 8 }} />
                      <Skeleton w={56} h={12} style={{ marginBottom: 6 }} />
                      <Skeleton w={40} h={10} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* motivational sidebar */}
          <div style={S.side}>
            <Skeleton w="100%" h={188} r="var(--radius-xl)" />
            <Skeleton w="100%" h={150} r="var(--radius-xl)" />
            <Skeleton w="100%" h={120} r="var(--radius-xl)" />
          </div>
        </div>
      </div>
    </AppShellSkeleton>
  );
}

const S: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 1080, margin: "0 auto" },
  head: { display: "flex", alignItems: "flex-end", gap: 16, marginBottom: 22 },
  track: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-xl)", padding: "18px 22px", marginBottom: 14, boxShadow: "var(--shadow-sm)" },
  trackHead: { display: "flex", alignItems: "center", gap: 10, marginBottom: 20 },
  node: { display: "flex", flexDirection: "column", alignItems: "center", width: "33%" },
  side: { display: "flex", flexDirection: "column", gap: 14 },
};
