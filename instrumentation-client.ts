import * as Sentry from "@sentry/nextjs";
import { scrubEvent } from "@/lib/monitoring/scrub";

/**
 * Клиентский init Sentry (BRIEF §11). DSN читаем НАПРЯМУЮ из process.env
 * (NEXT_PUBLIC_ инлайнится в бандл): импортировать @/env в браузере нельзя — он
 * валидирует серверные секреты и упал бы (тот же приём, что в PostHog-provider).
 * Без DSN init не вызывается — мониторинг выключен (fail-open).
 *
 * Приватность (exam/auth чувствительны): session-replay НЕ включаем (писал бы
 * ввод — email/пароль/ответы), tracesSampleRate 0 (нужны только ошибки, §11 —
 * error-monitoring), sendDefaultPii:false, beforeSend срезает query из URL.
 */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn && dsn.trim() !== "") {
  Sentry.init({
    dsn,
    environment:
      process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT?.trim() || process.env.NODE_ENV,
    tracesSampleRate: 0,
    sendDefaultPii: false,
    beforeSend: scrubEvent,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
