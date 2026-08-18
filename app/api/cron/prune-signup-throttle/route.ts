import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { signupThrottle } from "@/db/schema";
import { cronSecret } from "@/env";
import { isCronAuthorized } from "@/lib/cron-auth";
import { logError } from "@/lib/monitoring/log-error";

/**
 * Cron-чистка signup_throttle (anti-abuse, миграция 0022). Строка пишется на
 * КАЖДУЮ попытку signup/login/reset (app/auth/actions.ts) и никогда не
 * чистилась. Окно счёта троттлинга — 1 час (SIGNUP_THROTTLE_WINDOW_SECONDS,
 * src/lib/anti-cheat.ts) — 48ч запас на порядок больше окна, троттлинг не
 * задет, строки старше просто балласт. Аутентификация — как у соседних
 * cron-роутов (Bearer CRON_SECRET, fail-closed).
 */
export const dynamic = "force-dynamic";

function authorized(request: Request): boolean {
  return isCronAuthorized(request.headers.get("authorization"), cronSecret());
}

/** now() считает Postgres, не Node: Date-параметр в raw sql`` крашит прод
 *  (pgbouncer, prepare:false) — см. гочу в CLAUDE.md. */
async function pruneSignupThrottle(): Promise<number> {
  const rows = await db
    .delete(signupThrottle)
    .where(sql`${signupThrottle.createdAt} < now() - interval '48 hours'`)
    .returning({ id: signupThrottle.id });
  return rows.length;
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  try {
    const deleted = await pruneSignupThrottle();
    return NextResponse.json({ ok: true, deleted }, { status: 200 });
  } catch (e) {
    await logError({
      source: "server",
      message: `prune signup_throttle cron failed: ${e instanceof Error ? e.message : String(e)}`,
      stack: e instanceof Error ? e.stack : null,
      url: request.url,
      context: { route: "/api/cron/prune-signup-throttle" },
    });
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

// Vercel Cron вызывает endpoints методом GET — поддерживаем оба.
export async function GET(request: Request): Promise<NextResponse> {
  return POST(request);
}
