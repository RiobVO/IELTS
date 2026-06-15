import * as Sentry from "@sentry/nextjs";
import { sentryConfig } from "@/env";
import { scrubEvent } from "@/lib/monitoring/scrub";

/**
 * Edge-init Sentry (BRIEF §11). Грузится из instrumentation.register под
 * edge-рантаймом (middleware, edge route-хендлеры). Та же политика, что в
 * sentry.server.config: без DSN — no-op; только ошибки (traces 0); без PII;
 * срез query из URL.
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
