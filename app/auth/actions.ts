"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { captureServer } from "@/lib/analytics/server";
import { createClient } from "@/lib/supabase/server";

function fail(message: string): never {
  redirect(`/auth?error=${encodeURIComponent(message)}`);
}

export async function signIn(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/app") || "/app";

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) fail(error.message);

  revalidatePath("/", "layout");
  redirect(next);
}

export async function signUp(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const ref = String(formData.get("ref") ?? "").trim();

  const supabase = await createClient();
  // The inviter's referral_code rides in auth user metadata under "ref_code".
  // The on_auth_user_created trigger reads it (NEW.raw_user_meta_data ->>
  // 'ref_code') to set profile.referred_by and insert the referral row.
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: ref ? { data: { ref_code: ref } } : undefined,
  });
  if (error) fail(error.message);

  // Регистрация — авторитетное серверное событие воронки (§11), РОВНО раз на нового
  // пользователя. При включённом email-подтверждении Supabase на повторную
  // регистрацию существующего email отдаёт error=null и ФЕЙКОВЫЙ data.user с новым
  // случайным id и пустым identities (анти-энумерация) — такие не считаем, иначе
  // накрутка счётчика + неверный distinctId. Признак реально нового — непустой
  // identities. ref-код намеренно НЕ кладём (ни в свойства, ни в URL) — это токен
  // атрибуции; в метрику идёт только has_ref. best-effort.
  const isNewUser = (data.user?.identities?.length ?? 0) > 0;
  if (data.user && isNewUser) {
    await captureServer("signup", data.user.id, {
      auth_provider: "email",
      has_ref: ref !== "",
    });
  }

  // profile row is created server-side by the on_auth_user_created trigger
  // (migrations/0002_auth) — no client write needed.
  redirect(
    `/auth?message=${encodeURIComponent("Письмо для подтверждения отправлено на почту.")}`,
  );
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/auth");
}
