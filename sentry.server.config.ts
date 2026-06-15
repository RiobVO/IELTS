import * as Sentry from "@sentry/nextjs";
import { sentryConfig } from "@/env";
import { scrubEvent } from "@/lib/monitoring/scrub";

/**
 * Серверный init Sentry (BRIEF §11 — error-monitoring). Грузится из
 * instrumentation.register под nodejs-рантаймом. Без DSN (sentryConfig()===null)
 * init не вызывается — no-op (fail-open, как PostHog: телеметрия некритична).
 * tracesSampleRate 0 — нужны ТОЛЬКО ошибки, не performance-tracing.
 * sendDefaultPii:false + beforeSend (срез query) — приватность exam/auth.
 */
const cfg = sentryConfig();
if (cfg) {
  Sentry.init({
    dsn: cfg.dsn,
    environment: cfg.environment,
    tracesSampleRate: 0,
    sendDefaultPii: false,
    beforeSend: scrubEvent,
  });
}
