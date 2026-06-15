import { AnalyticsIdentify } from "@/lib/analytics/identify";
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
  return (
    <>
      {user ? <AnalyticsIdentify userId={user.id} /> : null}
      {children}
    </>
  );
}
