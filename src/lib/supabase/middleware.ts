import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the Supabase session on every request and guards the
 * authenticated areas. /app and /admin require a logged-in user; the per-role
 * /admin check is enforced again in the page (requireAdmin) since middleware
 * only sees the session, not the profile role.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // IMPORTANT: do not run logic between createServerClient and the auth call.
  // getClaims() still refreshes the session (it calls getSession() internally,
  // which rotates an expiring token and writes the new cookies via setAll), so
  // session lifetime is unchanged — but with the project's asymmetric ES256
  // signing key it verifies the JWT LOCALLY (WebCrypto + cached JWKS) instead of
  // a round-trip to the Auth server on every request (getUser cost ~200ms/req to
  // Frankfurt). Matches lib/auth.ts, which already gates pages off getClaims.
  // Tradeoff: a revoked token is accepted until its exp (~1h) — already the case
  // at the RLS/data layer and for the page guards, so middleware adds no new gap.
  const { data } = await supabase.auth.getClaims();
  const authed = Boolean(data?.claims?.sub);

  const path = request.nextUrl.pathname;
  if (!authed && (path.startsWith("/app") || path.startsWith("/admin"))) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  return response;
}
