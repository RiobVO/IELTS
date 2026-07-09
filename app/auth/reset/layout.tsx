import type { Metadata } from "next";

// page.tsx здесь "use client" — export const metadata в клиентском компоненте
// не поддерживается Next.js, поэтому заголовок вкладки задаём отдельным
// server-компонентом layout.tsx.
export const metadata: Metadata = { title: "Reset password | bando" };

export default function ResetLayout({ children }: { children: React.ReactNode }) {
  return children;
}
