"use server";

import { createHash } from "node:crypto";
import { and, eq, gte, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { signupThrottle } from "@/db/schema";
import { captureServer } from "@/lib/analytics/server";
import {
  exceedsSignupRate,
  isHoneypotTripped,
  SIGNUP_THROTTLE_WINDOW_SECONDS,
} from "@/lib/anti-cheat";
import { verifyTurnstile } from "@/lib/anti-bot/turnstile";
import { safeNextPath } from "@/lib/safe-next";
import { createClient } from "@/lib/supabase/server";

// На ошибке возвращаем в форму её режим + введённый email, чтобы восстановить ввод
// (пароль НИКОГДА не отражаем). `mode` решает, какая форма откроется после redirect.
function fail(message: string, extra?: Record<string, string>): never {
  const params = new URLSearchParams({ error: message, ...extra });
  redirect(`/auth?${params.toString()}`);
}

export async function signIn(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  // `next` приходит из формы — нормализуем до внутреннего пути (open-redirect guard).
  const next = safeNextPath(formData.get("next") as string | null);

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) fail(error.message, { mode: "login", email });

  revalidatePath("/", "layout");
  redirect(next);
}

export async function signUp(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const ref = String(formData.get("ref") ?? "").trim();

  // Honeypot (§11 anti-bot, без внешних зависимостей): скрытое поле-приманка,
  // невидимое живому пользователю. Заполнено → это бот: молча имитируем успех
  // (аккаунт НЕ создаём, БД не трогаем, ловушку не палим). Первым — дешевле captcha
  // и throttle, отсекает примитивных ботов до любой работы.
  if (isHoneypotTripped(formData.get("website"))) {
    redirect(
      `/auth?message=${encodeURIComponent("A confirmation email has been sent to your inbox.")}`,
    );
  }

  // Anti-bot gate (§11). No-op when Turnstile keys aren't configured (fail-open),
  // so signup is unaffected until the keys are added. The token rides in the
  // Cloudflare-injected hidden field.
  const captcha = String(formData.get("cf-turnstile-response") ?? "") || null;
  if (!(await verifyTurnstile(captcha))) {
    fail("Could not verify you're human. Please try again.", { mode: "signup", email });
  }

  // Signup velocity-cap (§11 anti-abuse): ограничиваем регистрации с одного IP в
  // окне — поверх captcha (fail-open без ключей). IP из x-forwarded-for (на Vercel
  // ставит платформа); для rate-limit достаточно — defense-in-depth, не
  // security-граница. Храним sha256(ip), не сам адрес.
  const ipRaw =
    (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const ipHash = createHash("sha256").update(ipRaw).digest("hex");
  const since = new Date(Date.now() - SIGNUP_THROTTLE_WINDOW_SECONDS * 1000);
  const [recent] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(signupThrottle)
    .where(
      and(eq(signupThrottle.ipHash, ipHash), gte(signupThrottle.createdAt, since)),
    );
  if (exceedsSignupRate(recent?.n ?? 0)) {
    fail("Too many sign-ups from your network. Please try again later.", { mode: "signup", email });
  }
  await db.insert(signupThrottle).values({ ipHash });

  const supabase = await createClient();
  // The inviter's referral_code rides in auth user metadata under "ref_code".
  // The on_auth_user_created trigger reads it (NEW.raw_user_meta_data ->>
  // 'ref_code') to set profile.referred_by and insert the referral row.
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: ref ? { data: { ref_code: ref } } : undefined,
  });
  if (error) fail(error.message, { mode: "signup", email });

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
    `/auth?message=${encodeURIComponent("A confirmation email has been sent to your inbox.")}`,
  );
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/auth");
}
