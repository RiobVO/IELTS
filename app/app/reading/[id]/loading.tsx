import type * as React from "react";
import { Skeleton } from "@/components/core/Skeleton";

/**
 * Exam runner — focused full-screen режим (без шапки). Скелет зеркалит reading-
 * layout (топбар + passage-пейн слева, навигатор+вопросы справа); Listening
 * показывает тот же каркас.
 */
export default function Loading() {
  return (
    <div style={S.shell}>
      {/* Скелет зеркалит exam-раннер: на мобиле показываем один пейн (без 460px-overflow). */}
      <style>{`.exam-skel-q{display:none}@media(min-width:1024px){.exam-skel-q{display:flex}}`}</style>
      <div style={S.top}>
        <Skeleton w={38} h={38} r="var(--radius-md)" />
        <div>
          <Skeleton w={180} h={16} style={{ marginBottom: 6 }} />
          <Skeleton w={120} h={12} />
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 14 }}>
          <Skeleton w={120} h={40} r="var(--radius-md)" />
          <Skeleton w={110} h={40} r="var(--radius-md)" />
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <div style={S.passagePane}>
          <div style={S.passageHead}>
            <Skeleton w={140} h={14} />
          </div>
          <div style={{ padding: "26px 32px", maxWidth: "62ch", margin: "0 auto", width: "100%" }}>
            {Array.from({ length: 12 }).map((_, i) => (
              <Skeleton key={i} w={i % 4 === 3 ? "62%" : "100%"} h={14} style={{ marginBottom: 14 }} />
            ))}
          </div>
        </div>

        <div className="exam-skel-q" style={S.qPane}>
          <div style={S.navHead}>
            <Skeleton w={150} h={16} style={{ marginBottom: 12 }} />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(10, 1fr)", gap: 6 }}>
              {Array.from({ length: 20 }).map((_, i) => (
                <Skeleton key={i} h={28} r="9px" />
              ))}
            </div>
          </div>
          <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} style={S.qCard}>
                <Skeleton w="70%" h={16} style={{ marginBottom: 14 }} />
                <Skeleton w="100%" h={44} r="var(--radius-md)" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  shell: { height: "100dvh", display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--bg-base)" },
  top: { display: "flex", alignItems: "center", gap: 14, padding: "12px 20px", borderBottom: "1px solid var(--border)", background: "var(--bg-raised)", flex: "none" },
  passagePane: { flex: "1.15", minWidth: 0, display: "flex", flexDirection: "column", background: "var(--reading-surface)", borderRight: "1px solid var(--border)" },
  passageHead: { display: "flex", alignItems: "center", gap: 8, padding: "12px 22px", borderBottom: "1px solid var(--reading-rule)", flex: "none" },
  qPane: { width: 460, flex: "none", flexDirection: "column", background: "var(--bg-base)" },
  navHead: { padding: "14px 20px", borderBottom: "1px solid var(--border)", flex: "none" },
  qCard: { background: "var(--surface)", border: "2px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "var(--space-4)", boxShadow: "var(--shadow-solid)" },
};
