import { Literata } from "next/font/google";
import { AnalyticsIdentify } from "@/lib/analytics/identify";
import { posthogConfig } from "@/env";
import { getUser } from "@/lib/auth";

// Serif для пассажей/результатов (--font-reading в typography.css). Объявлен ЗДЕСЬ,
// а не в корневом layout, чтобы 6 woff2-файлов грузились только в /app — все
// потребители var(--font-reading) живут в этом сегменте, публичным страницам serif
// не нужен. ВАЖНО: var() внутри custom property подставляется на элементе
// объявления, поэтому :root-токен НЕ может ссылаться на --font-literata (её там
// нет) — класс .app-serif на этой же обёртке переобъявляет --font-reading рядом
// с literata.variable, где подстановка валидна (см. typography.css).
const literata = Literata({
  subsets: ["latin"], weight: ["400", "500", "600"], style: ["normal", "italic"], variable: "--font-literata", display: "swap",
});

/**
 * Layout аутентифицированной зоны /app. Назначение — сшивка аналитики (BRIEF §11:
 * как только известен user.id, отдаём его в PostHog identify, чтобы
 * дорегистрационные pageview склеились с аккаунтом) + сегментная загрузка Literata.
 * Аутентификацию страниц НЕ дублируем — её делают сами страницы (requireUser);
 * здесь user может быть null, тогда identify не монтируется (no-op).
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
    <div className={`app-serif ${literata.variable}`}>
      {user && analyticsOn ? <AnalyticsIdentify userId={user.id} /> : null}
      {children}
    </div>
  );
}
