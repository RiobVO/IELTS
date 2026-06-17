import type { PostHog } from "posthog-js";

/**
 * Ленивая загрузка posthog-js. Динамический import выносит ~40 КБ ядра из
 * основного клиентского бандла в отдельный chunk, который тянется только когда
 * аналитика реально используется (provider смонтирован при заданном ключе).
 * Промис кэшируется — все вызовы делят один singleton-инстанс.
 */
let phPromise: Promise<PostHog> | null = null;

export function loadPosthog(): Promise<PostHog> {
  if (!phPromise) {
    phPromise = import("posthog-js").then((m) => m.default);
  }
  return phPromise;
}
