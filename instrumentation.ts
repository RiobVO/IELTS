import * as Sentry from "@sentry/nextjs";

/**
 * Next.js instrumentation hook (BRIEF §11 — error-monitoring). Грузит серверный
 * или edge init Sentry по текущему рантайму. onRequestError ловит необработанные
 * ошибки server-компонентов и route-хендлеров (Next 15). Без DSN init — no-op.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// onRequestError идёт в Sentry (no-op без DSN). НЕ пишем отсюда в свой error_log: этот
// модуль бандлится и под edge-рантайм, где нет `net` — импорт @/db (postgres) через
// logError уронил бы весь инстанс (health 500). Server-ошибки и так видны в Vercel Runtime
// Logs (console.error); наш self-hosted sink наполняют client-краши (client-error endpoint)
// и явные logError-вызовы из nodejs-кода (server actions / route handlers).
export const onRequestError = Sentry.captureRequestError;
