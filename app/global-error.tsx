"use client";

import { useEffect } from "react";
import { captureException } from "@sentry/nextjs";

/**
 * Глобальный error-boundary App Router (BRIEF §11): ловит необработанный краш
 * клиентского дерева (server-ошибки берёт onRequestError в instrumentation).
 * captureException — no-op без DSN. Должен сам рендерить <html>/<body> — этот
 * boundary заменяет корневой layout при краше.
 */
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <h2>Something went wrong</h2>
      </body>
    </html>
  );
}
