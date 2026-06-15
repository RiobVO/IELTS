"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import posthog from "posthog-js";
import { PostHogProvider as PHProvider } from "posthog-js/react";

type Config = { key: string; host: string };

/**
 * Клиентский PostHog: инициализация + ручной capture `$pageview` на смену
 * маршрута (App Router — SPA-переходы не ловятся автоматически, поэтому
 * `capture_pageview: false` + ручной трекер ниже).
 *
 * Монтируется в корневом layout, но ТОЛЬКО когда сервер передал `config` (ключ
 * задан) — без ключа init не вызывается (аналитика выключена, fail-open). NB: сам
 * `posthog-js` всё равно попадает в клиентский бандл (статический импорт) —
 * выключается лишь инициализация, не вес; в проде ключ есть, так что это ожидаемо.
 * Ключ/host приходят пропсами из server-компонента, а не импортом `@/env` (тот
 * валидирует серверные секреты при загрузке и в браузере упал бы).
 *
 * Приватность (exam/auth — чувствительные страницы): autocapture выключен (воронка
 * идёт авторитетно с сервера, клик-автозахват не нужен), session replay выключен
 * (чтобы случайное включение из дашборда не начало писать ввод — email/пароль/
 * ответы), а before_send срезает query со всех URL-свойств (?ref=<code>, OAuth
 * ?code= и токены атрибуции не утекают). `key`/`host` стабильны → init один раз.
 */
export function PostHogProvider({
  config,
  children,
}: {
  config: Config;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (posthog.__loaded) return;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <PHProvider client={posthog}>
      <PageviewTracker />
      {children}
    </PHProvider>
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
    if (!posthog.__loaded) return;
    posthog.capture("$pageview", {
      $current_url: window.location.origin + window.location.pathname,
    });
  }, [pathname]);
  return null;
}
