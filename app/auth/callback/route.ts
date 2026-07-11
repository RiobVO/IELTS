import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { EventProperties } from "@/lib/analytics/events";
import { captureServer } from "@/lib/analytics/server";
import { sanitizeSource, SOURCE_COOKIE_NAME } from "@/lib/analytics/source";
import { linkOAuthReferral } from "@/lib/progress/referral";
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
  // ref — только используется для линковки в profile/referral (owner-path
  // Drizzle-запрос по referral_code внутри linkOAuthReferral), никуда не
  // редиректит и не рендерится — open-redirect guard тут не при чём.
  const ref = searchParams.get("ref");

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // OAuth-signup — авторитетное серверное событие воронки (§11). Тот же
      // callback обслуживает и signup, и login; нового пользователя детектим по
      // свежему created_at (returning имеет старый). best-effort — телеметрия не
      // должна ломать вход.
      const u = data.user;
      const provider = analyticsProvider(u?.app_metadata?.provider);
      const createdMs = u?.created_at ? new Date(u.created_at).getTime() : 0;
      // Считаем здесь ТОЛЬКО OAuth: email/password-регистрация уже засчитана в
      // signUp server action. Когда включён тумблер «Confirm email», ссылка
      // подтверждения приводит email-юзера в этот же callback — без guard'а быстро
      // (< окна) подтвердивший email считался бы дважды (signUp + callback).
      const ageMs = Date.now() - createdMs;
      // ageMs >= 0 — доверенное поле (created_at от Supabase), но защита от
      // рассинхронизации часов дешева: значение из будущего не должно проходить
      // окно независимо от того, насколько далеко оно в будущем (review finding).
      const isFreshOAuthSignup =
        !!u && provider !== "email" && createdMs > 0 && ageMs >= 0 && ageMs < FRESH_SIGNUP_WINDOW_MS;
      if (isFreshOAuthSignup) {
        // Метка канала (P5): cookie `bando_src` ставит middleware на посадочной,
        // до ухода в OAuth; re-sanitize при чтении (значение уходит в PostHog).
        const cookieStore = await cookies();
        const source = sanitizeSource(cookieStore.get(SOURCE_COOKIE_NAME)?.value);
        await captureServer("signup", u.id, {
          auth_provider: provider,
          has_ref: !!ref,
          ...(source ? { source, $set: { source } } : {}),
        });
        // Реферал через Google OAuth (ранее терялся — signUp-триггер получает от
        // Google метадату без ref_code, только email-форма его туда клала).
        // Тот же fresh-signup гейт: линковка нужна ровно один раз, на регистрации,
        // не на каждом повторном OAuth-логине по случайно сохранённой ссылке.
        if (ref) await linkOAuthReferral(u.id, ref);
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(
    `${origin}/auth?error=${encodeURIComponent("Could not complete sign-in.")}`,
  );
}
