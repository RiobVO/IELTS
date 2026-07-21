import "server-only";
import { captureException } from "@sentry/nextjs";

/**
 * Ручная отправка пойманной серверной ошибки в Sentry из fail-open catch
 * (вебхуки, cron, grading) — где ошибку нельзя пробросить, но терять из
 * мониторинга нельзя. No-op без DSN (init не вызывался). Дополняет авто-перехват
 * необработанных ошибок (instrumentation / onRequestError), не заменяет его.
 */
export function captureError(
  error: unknown,
  context?: Record<string, unknown>,
): void {
  captureException(error, context ? { extra: context } : undefined);
}
