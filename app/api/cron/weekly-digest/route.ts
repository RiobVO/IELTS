import { NextResponse } from "next/server";
import { cronSecret } from "@/env";
import { isCronAuthorized } from "@/lib/cron-auth";
import { logError } from "@/lib/monitoring/log-error";
import { runWeeklyDigest } from "@/lib/email/weekly-digest";

/**
 * Cron weekly email digest (BRIEF §11/§12.1). Fail-closed cron-auth (401 без
 * валидного Bearer), как соседние cron-роуты. Делегирует всё оркестратору
 * runWeeklyDigest (env-gated no-op без ключей). Идемпотентность — ledger внутри
 * оркестратора, поэтому повторный вызов в ту же неделю безопасен.
 */
export const dynamic = "force-dynamic";

function authorized(request: Request): boolean {
  return isCronAuthorized(request.headers.get("authorization"), cronSecret());
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  try {
    const result = await runWeeklyDigest();
    return NextResponse.json({ ok: true, ...result }, { status: 200 });
  } catch (e) {
    await logError({
      source: "server",
      message: `weekly digest cron failed: ${e instanceof Error ? e.message : String(e)}`,
      stack: e instanceof Error ? e.stack : null,
      url: request.url,
      context: { route: "/api/cron/weekly-digest" },
    });
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

// Vercel Cron вызывает endpoints методом GET — поддерживаем оба.
export async function GET(request: Request): Promise<NextResponse> {
  return POST(request);
}
