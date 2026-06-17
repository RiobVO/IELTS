import { AnalyticsIdentify } from "@/lib/analytics/identify";
import { posthogConfig } from "@/env";
import { getUser } from "@/lib/auth";

/**
 * Layout аутентифицированной зоны /app. Назначение — только сшивка аналитики
 * (BRIEF §11): как только известен user.id, отдаём его в PostHog (identify), чтобы
 * дорегистрационные pageview склеились с аккаунтом. Аутентификацию страниц НЕ
 * дублируем — её делают сами страницы (requireUser); здесь user может быть null,
 * тогда identify не монтируется (no-op).
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getUser();
  // identify тянет posthog-js динамически — монтируем только при включённой
  // аналитике (ключ задан), иначе chunk грузился бы зря без ключа.
  const analyticsOn = posthogConfig() !== null;
  return (
    <>
      {user && analyticsOn ? <AnalyticsIdentify userId={user.id} /> : null}
      {children}
    </>
  );
}
