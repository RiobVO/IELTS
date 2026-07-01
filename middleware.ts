import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Run on everything except static assets, the public health probe, and the
  // server-to-server endpoints that carry no user session (payment webhooks, the
  // cron expiry job, the Telegram import bot, and the internal Writing/Speaking Lab
  // evaluate routes authenticate by their own signature/secret, §2D). Excluding the
  // latter lets the server→route fetch through without the user-session redirect; the
  // routes are still secret-gated (writing/speakingInternalSecret, fail-closed) — this
  // only drops auth.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/health|api/webhooks/|api/cron/|api/telegram/|api/writing/evaluate|api/speaking/evaluate|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
