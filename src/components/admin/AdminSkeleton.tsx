import type { CSSProperties } from "react";
import { Skeleton } from "@/components/core/Skeleton";

/**
 * Общий skeleton тела админ-страницы (title + sub + карточка формы + список).
 * До этого skeleton был только у /admin, суб-страницы мигали пустотой. Фон/шапку
 * даёт layout (AdminNav), поэтому здесь только контент во wrap'е.
 */
export function AdminSkeleton({ rows = 4, form = true }: { rows?: number; form?: boolean }) {
  return (
    <div style={S.wrap}>
      <Skeleton w={140} h={28} style={{ marginBottom: 8 }} />
      <Skeleton w={240} h={14} style={{ marginBottom: 22 }} />

      {form && (
        <div style={S.card}>
          <Skeleton w={170} h={16} style={{ marginBottom: 10 }} />
          <Skeleton w="90%" h={14} style={{ marginBottom: 16 }} />
          <Skeleton w={200} h={44} r="var(--radius-md)" />
        </div>
      )}

      <Skeleton w={120} h={16} style={{ margin: form ? "28px 0 12px" : "0 0 12px" }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} w="100%" h={68} r="var(--radius-md)" />
        ))}
      </div>
    </div>
  );
}

const S: Record<string, CSSProperties> = {
  wrap: { maxWidth: 760, margin: "0 auto", padding: "2.5rem 1.5rem 4rem" },
  card: { background: "var(--surface)", border: "2px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-solid)", padding: 20 },
};
