import { AppHeader, type ActivePage } from "@/components/app/AppHeader";
import { getHeaderData } from "@/lib/notifications/header-data";
import { markAllRead } from "@/lib/notifications/actions";
import { signOut } from "../auth/actions";

function computeInitials(name: string, email?: string | null): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const fromName = parts.slice(0, 2).map((s) => s[0]).join("");
  return (fromName || email?.[0] || "U").toUpperCase();
}

/**
 * Общий каркас аутентифицированной зоны /app: липкий bando-хедер + скролл-контейнер.
 * Сам тянет данные шапки (profile + непрочитанные уведомления), поэтому экраны
 * оборачивают контент одной строкой. Раннеры (экзамен/listening) — полноэкранный
 * focused-режим, его НЕ оборачивают.
 */
export async function AppShell({
  active,
  children,
}: {
  active: ActivePage;
  children: React.ReactNode;
}) {
  // Данные шапки (profile + непрочитанные + recent) — через общий cache()'d
  // getHeaderData(): страница уже запустила его конкурентно со своим телом, тут
  // кэш-хит (см. header-data.ts — иначе это был бы trailing round-trip после тела).
  const { profile, unread, recent } = await getHeaderData();

  const initials = computeInitials(
    (profile?.display_name ?? profile?.email ?? "") as string,
    profile?.email,
  );

  return (
    <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", background: "var(--bg-base)" }}>
      <a href="#content" className="skip-link">Skip to content</a>
      <AppHeader
        active={active}
        streak={profile?.current_streak ?? 0}
        xp={profile?.xp ?? 0}
        initials={initials}
        unread={unread}
        recent={recent}
        markAllRead={markAllRead}
        signOut={signOut}
      />
      <main id="content" style={{ flex: 1, minHeight: 0 }}>{children}</main>
    </div>
  );
}
