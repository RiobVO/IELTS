import { NextResponse } from "next/server";
import type { EventProperties } from "@/lib/analytics/events";
import { captureServer } from "@/lib/analytics/server";
import { safeNextPath } from "@/lib/safe-next";
import { createClient } from "@/lib/supabase/server";

/**
 * Exchanges the code from an email-confirmation / OAuth redirect for a session,
 * then forwards to the app. (BRIEF §4.5 — email + OAuth sign-in.)
 */

/** Окно «только что создан» — отличает OAuth-signup от login (returning-юзер
 *  имеет старый created_at). С запасом на латентность callback. */
const FRESH_SIGNUP_WINDOW_MS = 60_000;

/** Провайдер из auth metadata → закреплённый контракт воронки (clamp как в триггере). */
function analyticsProvider(
  raw: unknown,
): EventProperties["signup"]["auth_provider"] {
  return raw === "apple" || raw === "facebook" || raw === "google"
    ? raw
    : "email";
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // `next` из query — нормализуем до внутреннего пути (open-redirect guard).
  const next = safeNextPath(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // OAuth-signup — авторитетное серверное событие воронки (§11). Тот же
      // callback обслуживает и signup, и login; нового пользователя детектим по
      // свежему created_at (returning имеет старый). best-effort — телеметрия не
      // должна ломать вход. has_ref=false: OAuth-поток пока не переносит ref_code
      // (referral через OAuth — отдельный, ещё не подключённый gap).
      const u = data.user;
      const createdMs = u?.created_at ? new Date(u.created_at).getTime() : 0;
      if (u && createdMs > 0 && Date.now() - createdMs < FRESH_SIGNUP_WINDOW_MS) {
        await captureServer("signup", u.id, {
          auth_provider: analyticsProvider(u.app_metadata?.provider),
          has_ref: false,
        });
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(
    `${origin}/auth?error=${encodeURIComponent("Could not complete sign-in.")}`,
  );
}
