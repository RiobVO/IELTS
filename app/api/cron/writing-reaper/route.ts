import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { cronSecret } from "@/env";
import { failStaleSubmissions } from "@/lib/writing/store";
import { WRITING_STALE_MS } from "@/lib/writing/lifecycle";

/**
 * Cron sweeper for stuck Writing submissions (#1). The lazy reaper in
 * getSubmissionStatus only runs while the client polls with a submissionId; a user
 * who leaves the page after a lost trigger / dead eval would stay blocked behind the
 * one-active index (0024) forever. This fails any pending|evaluating row past the
 * stale window so the slot frees up. Mirrors speaking-reaper's stuck-row pass (Writing
 * has no audio/retention). Auth: Bearer <CRON_SECRET>, fail-closed via cronSecret().
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isCronAuthorized(request.headers.get("authorization"), cronSecret())) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const failed = await failStaleSubmissions(new Date(Date.now() - WRITING_STALE_MS));
  return NextResponse.json({ ok: true, failed }, { status: 200 });
}
