import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { and, lt, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { profile } from "@/db/schema";
import { cronSecret } from "@/env";

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
  const secret = cronSecret();
  if (secret === null) return false; // ключ не настроен -> fail closed
  // Сравнение постоянного времени (паритет с verifyWebhook), чтобы не утекать
  // секрет по таймингу побайтового ===.
  const got = Buffer.from(request.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  if (got.length !== want.length) return false;
  return timingSafeEqual(got, want);
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
  const downgraded = await downgradeExpired();
  return NextResponse.json({ ok: true, downgraded }, { status: 200 });
}

// Vercel Cron вызывает endpoints методом GET — поддерживаем оба.
export async function GET(request: Request) {
  return POST(request);
}
