import { NextResponse } from "next/server";
import { safeNextPath } from "@/lib/safe-next";
import { createClient } from "@/lib/supabase/server";

/**
 * Exchanges the code from an email-confirmation / OAuth redirect for a session,
 * then forwards to the app. (BRIEF §4.5 — email + OAuth sign-in.)
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // `next` из query — нормализуем до внутреннего пути (open-redirect guard).
  const next = safeNextPath(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }

  return NextResponse.redirect(
    `${origin}/auth?error=${encodeURIComponent("Could not complete sign-in.")}`,
  );
}
