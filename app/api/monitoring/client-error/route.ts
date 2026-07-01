import { NextResponse } from "next/server";
import { and, count, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import { errorLog } from "@/db/schema";
import { getUser } from "@/lib/auth";
import { logError } from "@/lib/monitoring/log-error";

export const dynamic = "force-dynamic";

// Публичный endpoint (клиентский краш случается и до auth), поэтому — анти-флуд:
// глобальный backstop-cap на записи client-ошибок в окне (не по IP: monitoring — не
// security-граница, грубого общего лимита достаточно, чтобы бот не раздул error_log).
// Реальные клиентские краши редки и в лимит укладываются; сверх лимита молча дропаем.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 120;
const MAX_BODY_BYTES = 16_000;

interface ClientErrorBody {
  message?: string;
  stack?: string;
  url?: string;
  digest?: string;
  componentStack?: string;
}

export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ ok: false }, { status: 413 });

  let body: ClientErrorBody;
  try {
    body = JSON.parse(raw) as ClientErrorBody;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  if (!body?.message || typeof body.message !== "string") {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  // Backstop: если поток client-ошибок за окно достиг потолка — тихо дропаем (204),
  // чтобы публичный endpoint не стал вектором раздувания таблицы.
  const since = new Date(Date.now() - WINDOW_MS);
  const [recent] = await db
    .select({ n: count() })
    .from(errorLog)
    .where(and(eq(errorLog.source, "client"), gte(errorLog.createdAt, since)));
  if ((recent?.n ?? 0) >= MAX_PER_WINDOW) return new NextResponse(null, { status: 204 });

  // Кто (если залогинен) — best-effort; краш мог случиться и у анонима.
  const user = await getUser().catch(() => null);
  await logError({
    source: "client",
    message: body.message,
    stack: body.stack ?? null,
    url: body.url ?? null,
    userId: user?.id ?? null,
    context: {
      digest: body.digest ?? null,
      componentStack: body.componentStack ? body.componentStack.slice(0, 2000) : null,
    },
  });
  return NextResponse.json({ ok: true });
}
