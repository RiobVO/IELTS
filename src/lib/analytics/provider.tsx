"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { loadPosthog } from "./client";

type Config = { key: string; host: string };

/**
 * Клиентский PostHog: ленивая инициализация + ручной `$pageview` на смену
 * маршрута (App Router — SPA-переходы не ловятся автоматически, поэтому
 * `capture_pageview: false` + ручной трекер ниже).
 *
 * `posthog-js` грузится ДИНАМИЧЕСКИ (`./client`), поэтому его ~40 КБ не лежат в
 * основном клиентском бандле, а тянутся отдельным chunk-ом — и только здесь, где
 * провайдер смонтирован (root layout монтирует его лишь при заданном ключе).
 * Контекст `posthog-js/react` убран: identify и pageview зовут инстанс напрямую,
 * хука `usePostHog` в проекте нет. Ключ/host приходят пропсами из server-
 * компонента, а не импортом `@/env` (тот валидирует серверные секреты).
 *
 * Приватность (exam/auth — чувствительные страницы): autocapture выключен, session
 * replay выключен, а before_send срезает query со всех URL-свойств (?ref=<code>,
 * OAuth ?code= и токены атрибуции не утекают). `key`/`host` стабильны → init один раз.
 */
export function PostHogProvider({
  config,
  children,
}: {
  config: Config;
  children: React.ReactNode;
}) {
  useEffect(() => {
    let cancelled = false;
    void loadPosthog().then((posthog) => {
      if (cancelled || posthog.__loaded) return;
      posthog.init(config.key, {
        api_host: config.host,
        capture_pageview: false,
        capture_pageleave: true,
        autocapture: false,
        disable_session_recording: true,
        before_send: (cr) => {
          // Срезаем query с URL-свойств: реф-код/OAuth-код/токены не идут в PostHog
          // (покрывает и ручной $pageview, и авто $pageleave/$current_url).
          if (cr) {
            for (const k of ["$current_url", "$referrer"] as const) {
              const v = cr.properties[k];
              if (typeof v === "string" && v.includes("?")) {
                cr.properties[k] = v.slice(0, v.indexOf("?"));
              }
            }
          }
          return cr;
        },
      });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <PageviewTracker />
      {children}
    </>
  );
}

/**
 * Ручной pageview на каждое изменение pathname. Намеренно НЕ используем
 * useSearchParams — он в Next 15 требует Suspense и роняет страницу в CSR.
 * Шлём URL без query (origin + pathname): реф-код/OAuth-код в метрику не нужны
 * (before_send это тоже подстрахует).
 */
function PageviewTracker() {
  const pathname = usePathname();
  useEffect(() => {
    void loadPosthog().then((posthog) => {
      if (!posthog.__loaded) return;
      posthog.capture("$pageview", {
        $current_url: window.location.origin + window.location.pathname,
      });
    });
  }, [pathname]);
  return null;
}
