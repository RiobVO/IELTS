import { NextResponse } from "next/server";
import { gte } from "drizzle-orm";
import { db } from "@/db";
import { errorLog } from "@/db/schema";
import { cronSecret, telegramConfig } from "@/env";
import { isCronAuthorized } from "@/lib/cron-auth";
import { logError } from "@/lib/monitoring/log-error";
import { sendMessage } from "@/lib/telegram/client";

/**
 * Ежедневная сводка error_log владельцу в Telegram (F5). Читает error_log за
 * последние 24ч owner-path (Drizzle, bypass RLS — та же таблица, что /admin/errors),
 * шлёт итог каждому TELEGRAM_ADMIN_IDS через sendMessage (best-effort, сам не
 * бросает). Тишина при 0 ошибках — не шлём пустое «всё ок» каждый день. Fail-off:
 * без TELEGRAM_BOT_TOKEN/adminIds — 200 skipped, ничего не читаем и не шлём.
 * Auth: Bearer <CRON_SECRET>, fail-closed (по образцу weekly-digest).
 */
export const dynamic = "force-dynamic";

const WINDOW_MS = 24 * 60 * 60 * 1000;
const TOP_N = 5;
// Обрезка message до группировки — детали вроде id/timestamp в хвосте не должны
// дробить одну и ту же ошибку на разные строки топа.
const MESSAGE_PREFIX_LEN = 120;

function authorized(request: Request): boolean {
  return isCronAuthorized(request.headers.get("authorization"), cronSecret());
}

/** total + разбивка по source + топ-N повторяющихся сообщений (по префиксу).
 *  Тексты message в топ-строках — ТОЛЬКО из source='server' (наши собственные
 *  op-сообщения): публичный /api/monitoring/client-error пишет произвольный
 *  клиентский текст, и PII/мусор от анонима не должен уезжать владельцу в
 *  Telegram. Клиентские ошибки представлены только счётчиком «M client». */
function buildDigestText(rows: { source: string; message: string }[]): string {
  const serverRows = rows.filter((r) => r.source === "server");
  const clientCount = rows.filter((r) => r.source === "client").length;

  const counts = new Map<string, number>();
  for (const r of serverRows) {
    const key = r.message.slice(0, MESSAGE_PREFIX_LEN);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP_N);

  const lines = [`bando errors 24h: ${serverRows.length} server / ${clientCount} client`];
  for (const [message, count] of top) {
    lines.push(`${count}x ${message}`);
  }
  return lines.join("\n");
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const cfg = telegramConfig();
  if (!cfg || cfg.adminIds.length === 0) {
    return NextResponse.json({ ok: true, skipped: true }, { status: 200 });
  }
  try {
    const since = new Date(Date.now() - WINDOW_MS);
    const rows = await db
      .select({ source: errorLog.source, message: errorLog.message })
      .from(errorLog)
      .where(gte(errorLog.createdAt, since));

    if (rows.length === 0) {
      return NextResponse.json({ ok: true, total: 0 }, { status: 200 });
    }

    const text = buildDigestText(rows);
    await Promise.all(cfg.adminIds.map((chatId) => sendMessage(chatId, text)));
    return NextResponse.json({ ok: true, total: rows.length }, { status: 200 });
  } catch (e) {
    await logError({
      source: "server",
      message: `error digest cron failed: ${e instanceof Error ? e.message : String(e)}`,
      stack: e instanceof Error ? e.stack : null,
      url: request.url,
      context: { route: "/api/cron/error-digest" },
    });
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

// Vercel Cron вызывает endpoints методом GET — поддерживаем оба.
export async function GET(request: Request): Promise<NextResponse> {
  return POST(request);
}
