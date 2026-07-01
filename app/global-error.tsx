"use client";

import { useEffect } from "react";
import { captureException } from "@sentry/nextjs";

/**
 * Глобальный error-boundary App Router (BRIEF §11): ловит необработанный краш
 * клиентского дерева (server-ошибки берёт onRequestError в instrumentation).
 * Шлём в ОБА sink-а: Sentry captureException (no-op без DSN) и наш self-hosted
 * error_log через internal endpoint (виден в /admin/errors без внешнего сервиса).
 * Отправка best-effort (keepalive + проглоченный catch) — не мешает error-экрану.
 * Должен сам рендерить <html>/<body> — этот boundary заменяет корневой layout.
 */
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    captureException(error);
    try {
      void fetch("/api/monitoring/client-error", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: error.message,
          stack: error.stack,
          digest: error.digest,
          url: typeof location !== "undefined" ? location.href : undefined,
        }),
        keepalive: true,
      }).catch(() => {});
    } catch {
      /* мониторинг best-effort — не мешаем показу error-экрана */
    }
  }, [error]);

  return (
    <html lang="en">
      <body>
        <h2>Something went wrong</h2>
      </body>
    </html>
  );
}
