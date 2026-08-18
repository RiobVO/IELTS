/**
 * Детект `redirect()`/`permanentRedirect()` из Next.js App Router по несущей
 * ошибке. Next НЕ экспортирует `isRedirectError` из публичного `next/navigation`
 * (только из внутреннего `next/dist/...`, который мы не импортируем — приватный
 * путь ломается между минорными версиями). Поведение стабильно документировано:
 * `redirect()` бросает объект с `digest`, начинающимся на `"NEXT_REDIRECT"`
 * (см. next/dist/client/components/redirect-error.js — REDIRECT_ERROR_CODE).
 *
 * Нужен там, где серверный экшен (submitAttempt) оборачивается в try/catch ради
 * обработки РЕАЛЬНЫХ сбоев (сеть/БД): успешный сабмит завершается `redirect()`,
 * который для вызывающего клиента — тоже брошенная ошибка. Без этой проверки
 * catch-блок принял бы успешный редирект за провал сабмита.
 */
export function isNextRedirectError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("digest" in error)) return false;
  const digest = (error as { digest?: unknown }).digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}
