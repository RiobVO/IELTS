import "server-only";
import { db } from "@/db";
import { errorLog } from "@/db/schema";

export type ErrorSource = "server" | "client";

export interface ErrorEntry {
  source: ErrorSource;
  message: string;
  stack?: string | null;
  url?: string | null;
  userId?: string | null;
  context?: Record<string, unknown> | null;
}

const MAX_MESSAGE = 2000;
const MAX_STACK = 8000;
const MAX_URL = 1000;

/** Срезает query-строку из URL (?ref=, OAuth ?code=, токены атрибуции) и обрезает по длине
 *  — тот же приватный фильтр, что scrubEvent для Sentry, но для нашего sink. */
export function stripQuery(url: string | null | undefined): string | null {
  if (!url) return null;
  const q = url.indexOf("?");
  const clean = q >= 0 ? url.slice(0, q) : url;
  return clean.slice(0, MAX_URL) || null;
}

/**
 * Свой error sink: структурный console.error (→ Vercel Runtime Logs, всегда) + строка в
 * error_log (owner-path, RLS-locked). Зовётся из nodejs-кода (client-error endpoint + явные
 * server catch), НЕ из instrumentation (тот бандлится под edge, где нет postgres). НИКОГДА
 * не бросает и не зацикливается — если запись в БД падает, пишем в консоль и выходим (иначе
 * вызывающий сам бы упал или ушёл в рекурсию логирования). Приватность: query-строка URL
 * срезается, поля обрезаются по длине. Без внешнего сервиса; Sentry остаётся опц. no-op.
 */
export async function logError(e: ErrorEntry): Promise<void> {
  const url = stripQuery(e.url);
  const message = (e.message || "unknown error").slice(0, MAX_MESSAGE);
  // console.error — это и есть проектный логгер (winston/pino в проекте нет); дублирует в
  // Vercel logs как гарантию на случай недоступной БД.
  console.error(`[error_log:${e.source}] ${message}`, { url, userId: e.userId ?? null });
  try {
    await db.insert(errorLog).values({
      source: e.source,
      message,
      stack: e.stack ? e.stack.slice(0, MAX_STACK) : null,
      url,
      userId: e.userId ?? null,
      context: e.context ?? null,
    });
  } catch (dbErr) {
    console.error("logError: failed to persist error_log row", dbErr);
  }
}
