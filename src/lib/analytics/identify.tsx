"use client";

import { useEffect } from "react";
import posthog from "posthog-js";

/**
 * Привязывает анонимную PostHog-сессию к Supabase user.id (BRIEF §11, сшивка
 * воронки): после `identify` дорегистрационные `$pageview` склеиваются с
 * аккаунтом. No-op, если PostHog не инициализирован (ключ не задан) — fail-open.
 * Передаём ТОЛЬКО id, без PII.
 */
export function AnalyticsIdentify({ userId }: { userId: string }) {
  useEffect(() => {
    if (!posthog.__loaded) return;
    posthog.identify(userId);
  }, [userId]);
  return null;
}
