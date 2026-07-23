"use client";

import { useEffect } from "react";
import { loadPosthog } from "./client";

/**
 * Привязывает анонимную PostHog-сессию к Supabase user.id (BRIEF §11, сшивка
 * воронки): после `identify` дорегистрационные `$pageview` склеиваются с
 * аккаунтом. No-op, если PostHog не инициализирован. `posthog-js` грузится
 * динамически (`./client`); компонент монтируется только при включённой аналитике
 * (см. app/app/layout), поэтому без ключа chunk не тянется. Только id, без PII.
 */
export function AnalyticsIdentify({ userId }: { userId: string }) {
  useEffect(() => {
    void loadPosthog().then((posthog) => {
      if (!posthog.__loaded) return;
      posthog.identify(userId);
    });
  }, [userId]);
  return null;
}
