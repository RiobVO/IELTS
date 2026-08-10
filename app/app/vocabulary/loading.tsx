import { AppShellSkeleton } from "@/components/app/Skeletons";
import { Skeleton } from "@/components/core/Skeleton";

/** Скелетон каталога Vocabulary — зеркалит header + план-панель + grid деков
 *  (page.tsx), чтобы свап на контент не давал layout-shift. Брейкпоинты — в классе,
 *  панель складывается на flex-wrap (как в page.tsx). */
export default function Loading() {
  return (
    <AppShellSkeleton active="vocabulary">
      <div className="vls-wrap">
        <style>{`
          .vls-wrap{max-width:1160px;margin:0 auto;padding:24px 16px 56px;display:flex;flex-direction:column;gap:26px}
          .vls-grid{display:grid;grid-template-columns:1fr;gap:16px}
          @media(min-width:640px){.vls-grid{grid-template-columns:repeat(2,1fr)}}
          @media(min-width:768px){.vls-wrap{padding:32px 28px 72px}}
          @media(min-width:1024px){.vls-grid{grid-template-columns:repeat(3,1fr)}}
        `}</style>

        <div>
          <Skeleton w={110} h={14} style={{ marginBottom: 14 }} />
          <Skeleton w="60%" h={40} style={{ marginBottom: 12 }} />
          <Skeleton w="85%" h={16} style={{ marginBottom: 6 }} />
          <Skeleton w="50%" h={16} />
        </div>

        {/* план-панель: main-строка со stat-цифрами + CTA, foot со спарком + банком */}
        <div
          style={{
            background: "var(--surface)",
            border: "2px solid var(--border)",
            borderRadius: 18,
            boxShadow: "var(--shadow-solid)",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 22, padding: "18px 20px" }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 80 }}>
                <Skeleton w={46} h={26} />
                <Skeleton w={72} h={11} />
              </div>
            ))}
            <div style={{ marginLeft: "auto" }}>
              <Skeleton w={150} h={50} r="var(--radius-md)" />
            </div>
          </div>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 26,
              borderTop: "1px solid var(--border-subtle)",
              background: "var(--surface-inset)",
              padding: "14px 20px",
            }}
          >
            <Skeleton w={150} h={44} />
            <Skeleton w={220} h={16} />
          </div>
        </div>

        <div className="vls-grid">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              style={{
                background: "var(--surface)",
                border: "2px solid var(--border)",
                borderRadius: 18,
                padding: 20,
                boxShadow: "var(--shadow-solid)",
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              <div style={{ display: "flex", gap: 8 }}>
                <Skeleton w={54} h={22} r="var(--radius-full)" />
                <Skeleton w={70} h={22} r="var(--radius-full)" />
              </div>
              <Skeleton w="65%" h={20} />
              <Skeleton w="90%" h={12} />
              <Skeleton w="100%" h={7} r="var(--radius-full)" style={{ marginTop: 8 }} />
              <Skeleton w={90} h={12} />
            </div>
          ))}
        </div>
      </div>
    </AppShellSkeleton>
  );
}
