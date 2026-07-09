"use client";

import { useEffect } from "react";
import { captureException } from "@sentry/nextjs";
import { Button } from "@/components/core/Button";

/**
 * Route-level error boundary App Router (BRIEF §11): ловит краш клиентского
 * дерева внутри обычного layout (в отличие от global-error.tsx — этот НЕ
 * заменяет корневой layout, html/body уже есть выше). Тот же двойной sink,
 * что и в global-error: Sentry captureException (no-op без DSN) + наш
 * self-hosted error_log через internal endpoint (виден в /admin/errors).
 * Отправка best-effort (keepalive + проглоченный catch) — не мешает экрану.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
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
    <div
      style={{
        minHeight: "60vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        padding: "48px 24px",
        textAlign: "center",
      }}
    >
      <h1
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: "var(--text-2xl)",
          fontWeight: "var(--weight-extrabold)",
          color: "var(--text-primary)",
          margin: 0,
        }}
      >
        Something went wrong
      </h1>
      <p
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: "var(--text-md)",
          color: "var(--text-secondary)",
          margin: 0,
          maxWidth: 420,
        }}
      >
        The error has been reported. You can try again or head back to practice.
      </p>
      <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
        <Button variant="primary" onClick={reset}>
          Try again
        </Button>
        <Button variant="secondary" href="/app/practice">
          Back to practice
        </Button>
      </div>
    </div>
  );
}
