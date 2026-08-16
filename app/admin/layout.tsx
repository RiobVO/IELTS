import type { ReactNode } from "react";
import { AdminNav } from "@/components/admin/AdminNav";

/**
 * Общий каркас админки: sticky таб-бар (wayfinding между пятью роутами) + контент.
 * Фон и min-height живут здесь — страницы больше не дублируют их в своих S.page.
 * requireAdmin остаётся на каждой странице (layout сам по себе не гейт).
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div style={{ minHeight: "100dvh", background: "var(--bg-base)", display: "flex", flexDirection: "column" }}>
      <AdminNav />
      <div style={{ flex: 1, minHeight: 0 }}>{children}</div>
    </div>
  );
}
