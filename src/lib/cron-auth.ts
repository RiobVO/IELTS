import { timingSafeEqual } from "node:crypto";

/**
 * Чистая проверка авторизации cron-эндпоинтов (BRIEF §11). Сверяет значение
 * заголовка Authorization с ожидаемым `Bearer <secret>`. Вынесена из
 * app/api/cron/expire-premium/route.ts, чтобы тестировать без Request-объекта.
 *
 * Fail-closed: secret === null (ключ не настроен) -> false, неаутентифицированный
 * вызов никогда не проходит. Сравнение — timingSafeEqual постоянного времени
 * (паритет с verifyWebhook), чтобы не утекать секрет по таймингу побайтового ===.
 *
 * @param headerValue значение заголовка `authorization` (null, если отсутствует)
 * @param secret      настроенный CRON_SECRET или null, если ключ не задан
 */
export function isCronAuthorized(
  headerValue: string | null,
  secret: string | null,
): boolean {
  if (secret === null) return false; // ключ не настроен -> fail closed
  const got = Buffer.from(headerValue ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  if (got.length !== want.length) return false;
  return timingSafeEqual(got, want);
}
