import type * as SentryModule from "@sentry/nextjs";
import { scrubEvent } from "@/lib/monitoring/scrub";

/**
 * Клиентский init Sentry (BRIEF §11). DSN читаем НАПРЯМУЮ из process.env
 * (NEXT_PUBLIC_ инлайнится в бандл): импортировать @/env в браузере нельзя — он
 * валидирует серверные секреты и упал бы (тот же приём, что в PostHog-provider).
 * Без DSN init не вызывается — мониторинг выключен (fail-open).
 *
 * SDK грузится ДИНАМИЧЕСКИ и только при заданном DSN: статический импорт держал
 * ~80 kB gzip @sentry/nextjs в First-Load-бандле КАЖДОЙ страницы (замер A/B-сборкой:
 * shared JS 184 → 104 kB), будучи no-op без DSN. При пустом DSN условие инлайнится
 * в false на build — sentry-чанк не запрашивается вовсе; при заданном — подгружается
 * асинхронно после старта. Ошибки первых мгновений до загрузки SDK теряются —
 * приемлемо для error-monitoring (тот же класс, что «SDK ещё не инициализирован»).
 *
 * Приватность (exam/auth чувствительны): session-replay НЕ включаем (писал бы
 * ввод — email/пароль/ответы), tracesSampleRate 0 (нужны только ошибки, §11 —
 * error-monitoring), sendDefaultPii:false, beforeSend срезает query из URL.
 */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

// Ссылка на загруженный SDK — до загрузки (и всегда без DSN) роутер-хук no-op.
let sentry: typeof SentryModule | null = null;

if (dsn && dsn.trim() !== "") {
  void import("@sentry/nextjs")
    .then((Sentry) => {
      Sentry.init({
        dsn,
        environment:
          process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT?.trim() || process.env.NODE_ENV,
        tracesSampleRate: 0,
        sendDefaultPii: false,
        beforeSend: scrubEvent,
      });
      sentry = Sentry;
    })
    // Мониторинг fail-open: сорвавшаяся загрузка SDK не должна ронять страницу.
    .catch(() => {});
}

export const onRouterTransitionStart: typeof SentryModule.captureRouterTransitionStart = (
  ...args
) => {
  sentry?.captureRouterTransitionStart(...args);
};
