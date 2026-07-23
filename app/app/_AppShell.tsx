import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppHeader, type ActivePage } from "@/components/app/AppHeader";
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
  // Профиль и счётчик непрочитанных независимы → один Promise.all вместо водопада.
  const supabase = await createClient();
  const [profile, notif] = await Promise.all([
    getProfile(),
    supabase
      .from("notification")
      .select("id", { count: "exact", head: true })
      .is("read_at", null),
  ]);
  const count = notif.count;

  const initials = computeInitials(
    (profile?.display_name ?? profile?.email ?? "") as string,
    profile?.email,
  );

  return (
    <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", background: "var(--bg-base)" }}>
      <AppHeader
        active={active}
        streak={profile?.current_streak ?? 0}
        xp={profile?.xp ?? 0}
        initials={initials}
        unread={count ?? 0}
        signOut={signOut}
      />
      <div style={{ flex: 1, minHeight: 0 }}>{children}</div>
    </div>
  );
}
