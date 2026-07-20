import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Run on everything except static assets, the public health probe, and the
  // server-to-server endpoints that carry no user session (payment webhooks +
  // the cron expiry job authenticate by their own signature/secret, §2D).
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/health|api/webhooks/|api/cron/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
