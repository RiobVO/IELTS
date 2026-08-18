import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";

/** Минимум, который реально используется из auth-юзера по коду (`.id` / `.email`). */
export interface AuthUser {
  id: string;
  email?: string;
}

/**
 * The current authenticated user (or null). Request-memoized via React `cache()`:
 * layout + page (analytics identify + page's requireUser/getProfile) share ONE
 * resolve per request.
 *
 * Uses `getClaims()`, not `getUser()`: при асимметричных JWT signing-ключах токен
 * верифицируется ЛОКАЛЬНО (WebCrypto, без round-trip к Auth-серверу Frankfurt) —
 * срезает auth-RTT с КАЖДОЙ /app-страницы. При legacy HS256 `getClaims` сам падает
 * обратно на сетевой `getUser()` (auth-js), т.е. поведение идентично, без регрессии.
 * Отзыв токена проверяет middleware (там остаётся `getUser()` + refresh сессии) —
 * рендеру достаточно верифицированных claims.
 */
export const getUser = cache(async (): Promise<AuthUser | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) return null;
  return { id: claims.sub, email: typeof claims.email === "string" ? claims.email : undefined };
});

/**
 * The current user's profile row (or null). Read under RLS (own row only).
 * Request-memoized via React `cache()` — страница и общий каркас (AppShell)
 * делят один запрос profile вместо двух.
 */
export const getProfile = cache(async () => {
  // Переиспользуем кэшированный getUser() (тот же, что в requireUser) — иначе это
  // второй auth.getUser() round-trip к Supabase на каждой /app-странице.
  const user = await getUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("profile")
    .select("*")
    .eq("id", user.id)
    .single();
  return data;
});

/** Redirects to /auth if not signed in; otherwise returns the user. */
export async function requireUser() {
  const user = await getUser();
  if (!user) redirect("/auth");
  return user;
}

/** Redirects unless the signed-in user is an admin (BRIEF §4.5 / §6.1). */
export async function requireAdmin() {
  const profile = await getProfile();
  if (!profile) redirect("/auth");
  if (profile.role !== "admin") redirect("/app");
  return profile;
}

/**
 * Не-редиректящий предикат роли admin (F4 "Sit as student"). requireAdmin остаётся
 * источником правды для admin-ONLY страниц (редиректит не-админа); этот предикат —
 * для read-only байпас-веток внутри УЖЕ доступных студенту маршрутов (RSC-условие
 * в /app/exam, /app/reading; route-handler в /app/exam/[id]/runner, где redirect()
 * недоступен) — там нужен просто bool, не побочный эффект.
 */
export function isAdminProfile(profile: { role: string } | null | undefined): boolean {
  return profile?.role === "admin";
}
