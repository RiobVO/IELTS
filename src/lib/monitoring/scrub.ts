import type { ErrorEvent } from "@sentry/nextjs";

/**
 * Срезает query-строку из URL в событии Sentry — тот же приватный фильтр, что
 * `before_send` в PostHog-provider: ?ref=<code>, OAuth ?code= и токены атрибуции
 * не должны утекать в мониторинг. `sendDefaultPii:false` уже не шлёт
 * cookies/headers/ip; здесь добиваем именно URL запроса. Общая для
 * server/edge/client init (чистая функция — безопасна и в браузерном бандле).
 */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  const req = event.request;
  if (req) {
    if (typeof req.url === "string" && req.url.includes("?")) {
      req.url = req.url.slice(0, req.url.indexOf("?"));
    }
    if (req.query_string) delete req.query_string;
  }
  return event;
}
