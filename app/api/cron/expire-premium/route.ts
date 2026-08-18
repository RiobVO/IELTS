import { NextResponse } from "next/server";
import { and, lt, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { profile } from "@/db/schema";
import { cronSecret } from "@/env";
import { isCronAuthorized } from "@/lib/cron-auth";
import { logError } from "@/lib/monitoring/log-error";

/**
 * Cron-даунгрейд просроченных подписок (BRIEF §11). Профили, у которых
 * premium_until уже прошёл, но tier ещё не 'basic', опускаются в 'basic'.
 * Гейтинг и так не доверяет устаревшему tier (effectiveTier в src/lib/tiers.ts),
 * но этот джоб приводит хранимое состояние в порядок и снимает фантомные тарифы.
 *
 * Аутентификация: заголовок Authorization: "Bearer <CRON_SECRET>". Если
 * cronSecret() === null (ключ не настроен) ИЛИ заголовок не совпал -> 401
 * (fail-closed: никогда не выполняем даунгрейд по неаутентифицированному вызову).
 * Middleware исключает /api/cron из auth-сессии. Vercel Cron шлёт этот заголовок.
 */
export const dynamic = "force-dynamic";

function authorized(request: Request): boolean {
  // Чистая проверка вынесена в src/lib/cron-auth.ts (тестируется без Request).
  return isCronAuthorized(
    request.headers.get("authorization"),
    cronSecret(),
  );
}

async function downgradeExpired(): Promise<number> {
  // Даунгрейдим тех, у кого срок прошёл И тариф ещё не basic. premium_until=NULL
  // (бессрочный/comped грант) под lt(..., now()) не попадает — такие не трогаем.
  const rows = await db
    .update(profile)
    .set({ tier: "basic" })
    .where(
      and(lt(profile.premiumUntil, sql`now()`), ne(profile.tier, "basic")),
    )
    .returning({ id: profile.id });
  return rows.length;
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  try {
    const downgraded = await downgradeExpired();
    return NextResponse.json({ ok: true, downgraded }, { status: 200 });
  } catch (e) {
    await logError({
      source: "server",
      message: `expire-premium cron failed: ${e instanceof Error ? e.message : String(e)}`,
      stack: e instanceof Error ? e.stack : null,
      url: request.url,
      context: { route: "/api/cron/expire-premium" },
    });
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

// Vercel Cron вызывает endpoints методом GET — поддерживаем оба.
export async function GET(request: Request) {
  return POST(request);
}
