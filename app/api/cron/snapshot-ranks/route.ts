import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { leaderboardEntry, leaderboardSnapshot } from "@/db/schema";
import { cronSecret } from "@/env";

/**
 * Cron-снапшот рангов лидерборда для движения ▲/▼ (League). `leaderboard_entry`
 * полностью пересоздаётся на каждой рейтинговой попытке, поэтому «прошлый ранг»
 * хранить негде; этот джоб периодически копирует текущие ранги в
 * `leaderboard_snapshot`, а чтение лиги считает delta = snapshot.rank − live.rank.
 *
 * Аутентификация — как в expire-premium: Authorization: "Bearer <CRON_SECRET>",
 * постоянное время сравнения, fail-closed (нет ключа / не совпал → 401).
 * Middleware исключает /api/cron из auth-сессии. Идемпотентен: полный replace.
 */
export const dynamic = "force-dynamic";

const INSERT_CHUNK = 500;

function authorized(request: Request): boolean {
  const secret = cronSecret();
  if (secret === null) return false; // ключ не настроен → fail closed
  const got = Buffer.from(request.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  if (got.length !== want.length) return false;
  return timingSafeEqual(got, want);
}

/** Заменяет снапшот текущими рангами из leaderboard_entry (один транзакционный
 *  replace). Следующее чтение лиги сравнивает live-ранги с этой базой → ▲/▼. */
async function snapshotRanks(): Promise<number> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({
        userId: leaderboardEntry.userId,
        period: leaderboardEntry.period,
        scope: leaderboardEntry.scope,
        rank: leaderboardEntry.rank,
      })
      .from(leaderboardEntry);
    const values = rows
      .filter((r) => r.rank != null)
      .map((r) => ({ userId: r.userId, period: r.period, scope: r.scope, rank: r.rank as number }));
    await tx.delete(leaderboardSnapshot);
    for (let i = 0; i < values.length; i += INSERT_CHUNK) {
      await tx.insert(leaderboardSnapshot).values(values.slice(i, i + INSERT_CHUNK));
    }
    return values.length;
  });
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const snapshotted = await snapshotRanks();
  // Weekly digest раньше ехал отсюда piggyback'ом; теперь у него собственный cron
  // (/api/cron/weekly-digest в vercel.json) — снапшот и рассылка независимы.
  return NextResponse.json({ ok: true, snapshotted }, { status: 200 });
}

// Vercel Cron вызывает endpoints методом GET — поддерживаем оба.
export async function GET(request: Request) {
  return POST(request);
}
