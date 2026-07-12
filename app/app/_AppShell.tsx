import { AppHeader, type ActivePage } from "@/components/app/AppHeader";
import { getHeaderData } from "@/lib/notifications/header-data";
import { markAllRead, markOneRead } from "@/lib/notifications/actions";
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

  // Server-only env (не NEXT_PUBLIC_*) — читаем здесь и пробрасываем в клиентский
  // AppHeader, как telegramChannelUrl в /app/practice. Пусто/не задано => пункт
  // «Report a problem» просто не рендерится (fail-off).
  const telegramChannelUrlRaw = process.env.TELEGRAM_CHANNEL_URL?.trim();
  const telegramChannelUrl = telegramChannelUrlRaw ? telegramChannelUrlRaw : null;

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
        markOneRead={markOneRead}
        signOut={signOut}
        telegramChannelUrl={telegramChannelUrl}
      />
      {/* overflow-x:clip на контейнере контента — страховка мобильного бургер-drawer.
          Drawer шапки — position:fixed;right:0 (AppHeader). Любой горизонтальный
          overflow контента расширяет initial containing block на телефоне, и right:0
          якорится к правому краю РАЗЪЕХАВШЕГОСЯ документа, а не вьюпорта — панель
          уезжает за правый край (кнопки Upgrade/Sign out срезаны). clip (не hidden и
          не auto) не создаёт scroll-container: sticky-шапка и body-scroll-lock drawer
          не ломаются, а overflow-y остаётся visible (страницу скроллит корень). main —
          сосед шапки и drawer, поэтому клип не задевает их fixed-позиционирование.
          Ограничено ≤1023px — диапазоном, где бургер/drawer видны; на десктопе drawer
          скрыт (display:none), клип там бесполезен и не должен менять overflow. */}
      <style>{"@media (max-width:1023px){#content{overflow-x:clip}}"}</style>
      <main id="content" style={{ flex: 1, minHeight: 0 }}>{children}</main>
    </div>
  );
}
