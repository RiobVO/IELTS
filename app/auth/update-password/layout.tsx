import type { Metadata } from "next";

// page.tsx здесь "use client" — export const metadata в клиентском компоненте
// не поддерживается Next.js, поэтому заголовок вкладки задаём отдельным
// server-компонентом layout.tsx.
export const metadata: Metadata = { title: "Update password | bando" };

export default function UpdatePasswordLayout({ children }: { children: React.ReactNode }) {
  return children;
}
