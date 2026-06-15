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

export const onRequestError = Sentry.captureRequestError;
