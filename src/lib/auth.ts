import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";

/**
 * The current authenticated user (or null). Request-memoized via React `cache()`:
 * layout + page (e.g. the /app layout's analytics identify and the page's own
 * requireUser) share ONE auth round-trip per request instead of refetching.
 */
export const getUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

/**
 * The current user's profile row (or null). Read under RLS (own row only).
 * Request-memoized via React `cache()` — страница и общий каркас (AppShell)
 * делят один запрос profile вместо двух.
 */
export const getProfile = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
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
