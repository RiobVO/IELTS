"use client";

/**
 * Best-effort клиентский репорт в серверный error_log — тот же endpoint и форма
 * payload, что app/global-error.tsx (message/stack/url), только с префиксом
 * контекста в message (эндпоинт не знает отдельного поля context). Fire-and-forget:
 * сам fetch обёрнут в try/catch — сбой репорта не должен ломать вызывающий UX
 * (используется в catch-блоках fire-and-forget practice-экшенов ExamRunner).
 */
export function reportClientError(err: unknown, context: string): void {
  try {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    void fetch("/api/monitoring/client-error", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: `${context}: ${message}`,
        stack,
        url: typeof location !== "undefined" ? location.href : undefined,
      }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* мониторинг best-effort — не мешаем вызывающему коду */
  }
}
