"use server";

import { createHash } from "node:crypto";
import { and, eq, gte, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { signupThrottle } from "@/db/schema";
import { publicSiteUrl } from "@/env";
import { captureServer } from "@/lib/analytics/server";
import {
  AUTH_THROTTLE_LIMITS,
  type AuthThrottleScope,
  exceedsAuthThrottle,
  exceedsSignupRate,
  isHoneypotTripped,
  SIGNUP_THROTTLE_WINDOW_SECONDS,
} from "@/lib/anti-cheat";
import { verifyTurnstile } from "@/lib/anti-bot/turnstile";
import { isEmailNotConfirmed } from "@/lib/auth/email-confirm";
import { logError } from "@/lib/monitoring/log-error";
import { safeNextPath } from "@/lib/safe-next";
import { createClient } from "@/lib/supabase/server";

// На ошибке возвращаем в форму её режим + введённый email, чтобы восстановить ввод
// (пароль НИКОГДА не отражаем). `mode` решает, какая форма откроется после redirect.
function fail(message: string, extra?: Record<string, string>): never {
  const params = new URLSearchParams({ error: message, ...extra });
  redirect(`/auth?${params.toString()}`);
}

// Нейтральное сообщение о троттле (§11 anti-abuse): не раскрывает, существует ли
// аккаунт, не отличимо от обычной перегрузки.
const AUTH_THROTTLE_MESSAGE = "Too many attempts. Try again later.";

/**
 * IP/email-throttle для login/reset (§11 anti-abuse), переиспользующий signup-механизм:
 * та же таблица signup_throttle и тот же паттерн (COUNT в скользящем окне → insert
 * только если ещё не превышен), но без новой миграции под колонку scope — вместо
 * неё scope едет префиксом в самом хешируемом ключе (sha256(`${scope}:${identifier}`)),
 * поэтому счётчики login/reset/resetEmail/signup не пересекаются несмотря на общую
 * таблицу. `identifier` по умолчанию — IP звонящего; reset password дополнительно
 * зовёт с per-email identifier (см. requestPasswordReset) — общий IP за NAT (офис/
 * университет) не должен душить per-email лимит и наоборот. true → лимит исчерпан,
 * вызывающий отклоняет попытку.
 */
async function checkAuthThrottle(scope: AuthThrottleScope, identifier?: string): Promise<boolean> {
  const { windowSeconds } = AUTH_THROTTLE_LIMITS[scope];
  let key = identifier;
  if (!key) {
    const h = await headers();
    key = h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  }
  const ipHash = createHash("sha256").update(`${scope}:${key}`).digest("hex");
  const since = new Date(Date.now() - windowSeconds * 1000);
  // COUNT и INSERT атомарны под advisory-xact-lock (тот же паттерн, что trial-лейн
  // в src/lib/exam/access.ts ~274): без лока параллельный burst запросов все видят
  // один и тот же count < limit и все проходят — для scope "resetEmail" это
  // почтовая бомбардировка жертвы вместо реального капа. Лок снимается на
  // commit/rollback, не течёт через pgbouncer; ключ — ipHash (уже несёт префикс
  // scope), не raw identifier.
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${ipHash}))`);
    const [recent] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(signupThrottle)
      .where(and(eq(signupThrottle.ipHash, ipHash), gte(signupThrottle.createdAt, since)));
    const exceeded = exceedsAuthThrottle(scope, recent?.n ?? 0);
    if (!exceeded) await tx.insert(signupThrottle).values({ ipHash });
    return exceeded;
  });
}

export async function signIn(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  // `next` приходит из формы — нормализуем до внутреннего пути (open-redirect guard).
  const next = safeNextPath(formData.get("next") as string | null);

  // Порог щедрый (10/10мин) — не задевает живого юзера, перебирающего забытый
  // пароль; отсекает только автоматизированный brute-force с одного IP.
  if (await checkAuthThrottle("login")) {
    fail(AUTH_THROTTLE_MESSAGE, { mode: "login", email });
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    // Тумблер «Confirm email» ВКЛ + почта не подтверждена → Supabase отдаёт
    // «Email not confirmed». Вместо сырой ошибки в форме уводим на экран
    // подтверждения с кнопкой resend. При ВЫКЛ тумблере эта ошибка не возникает —
    // ветка мёртвая, вход работает как прежде.
    if (isEmailNotConfirmed(error.message)) {
      redirect(`/auth/check-email?email=${encodeURIComponent(email)}`);
    }
    fail(error.message, { mode: "login", email });
  }

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
  const h = await headers();
  const ipRaw = h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
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
  // Куда вести браузер после клика по ссылке подтверждения (актуально ТОЛЬКО когда
  // тумблер «Confirm email» в Supabase ВКЛ; при ВЫКЛ письмо не шлётся и опция
  // инертна). Тот же callback, что обслуживает OAuth и reset-пароль: он обменяет
  // code на сессию и уведёт в /app (safeNextPath по умолчанию). Origin — ТОЛЬКО
  // доверенный NEXT_PUBLIC_SITE_URL: fallback на Origin/Host-заголовок дал бы
  // attacker-controllable ссылку подтверждения (спуф Host → кража PKCE-кода). Нет
  // env → не передаём emailRedirectTo, Supabase берёт Site URL из дашборда (safe).
  const origin = publicSiteUrl();

  // The inviter's referral_code rides in auth user metadata under "ref_code".
  // The on_auth_user_created trigger reads it (NEW.raw_user_meta_data ->>
  // 'ref_code') to set profile.referred_by and insert the referral row.
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      ...(origin ? { emailRedirectTo: `${origin}/auth/callback` } : {}),
      ...(ref ? { data: { ref_code: ref } } : {}),
    },
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

  // Confirm-email seam (fail-open, БЕЗ env-флага — авто-адаптация под тумблер
  // Supabase «Confirm email»). Исход различаем по наличию сессии в ответе signUp:
  if (data.session) {
    // Тумблер ВЫКЛ (текущий прод): signUp вернул сессию — пользователь уже вошёл,
    // cookies выставлены server-клиентом. Поведение БЕЗ ИЗМЕНЕНИЙ — тот же
    // success-редирект, что и раньше.
    redirect(
      `/auth?message=${encodeURIComponent("A confirmation email has been sent to your inbox.")}`,
    );
  }
  // Тумблер ВКЛ: сессии нет — письмо с подтверждением ушло (или это анти-энумерация
  // Supabase для уже существующего email: тот же экран, наличие аккаунта не палим).
  // Ведём на «Check your email» с адресом; sent=1 → resend стартует с cooldown.
  redirect(
    `/auth/check-email?email=${encodeURIComponent(email)}&sent=1`,
  );
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/auth");
}

/**
 * Запрос ссылки сброса пароля (app/auth/reset). Раньше форма звала
 * supabase.auth.resetPasswordForEmail напрямую из браузера — здесь у неё не было
 * доступа ни к IP, ни к троттлингу. Перенесено на сервер ИМЕННО чтобы навесить
 * throttle. Двойной ключ (NAT-фикс: общий IP офиса/университета не должен банить
 * легитимных юзеров четвёртым запросом):
 *  - per-IP (scope "reset") — щедрый порог вровень с login, отсекает только
 *    автоматизированный спам с одного адреса;
 *  - per-email (scope "resetEmail") — строгий 3/10мин, тот же живой-юзер-жмёт-once
 *    довод, что раньше был на IP, но не размывается общим IP за NAT.
 * Вызывается напрямую как функция (не через <form action>) — страница держит
 * своё sending/sent-состояние, это не рвёт её флоу. redirectTo — ТОЛЬКО через
 * доверенный publicSiteUrl() (не location.origin/Host) — та же анти-спуф причина,
 * что у emailRedirectTo в signUp выше. Supabase сам анти-энумерирует несуществующий
 * email (error обычно null) — мы это поведение не трогаем.
 */
export async function requestPasswordReset(email: string): Promise<{ error: string | null }> {
  const normalizedEmail = email.toLowerCase().trim();
  // Последовательно, НЕ Promise.all: IP-лимит первым. Уже исчерпанный IP отклоняем,
  // не трогая per-email счётчик — иначе атакующий с забаненного IP выжигает
  // per-email бюджет жертвы вторым чеком, который запускался параллельно и всё
  // равно списывал попытку.
  if (await checkAuthThrottle("reset")) {
    return { error: AUTH_THROTTLE_MESSAGE };
  }
  if (await checkAuthThrottle("resetEmail", normalizedEmail)) {
    return { error: AUTH_THROTTLE_MESSAGE };
  }

  const supabase = await createClient();
  const origin = publicSiteUrl();
  if (!origin) {
    // Без доверенного origin redirectTo не передаётся — ссылка из письма приземлится
    // на дефолтный Supabase Site URL, мимо /auth/callback, и сброс не доработает.
    // Fallback-поведение (как у signUp) оставляем, но фиксируем инцидент в логах.
    await logError({
      source: "server",
      message:
        "requestPasswordReset: NEXT_PUBLIC_SITE_URL is not set, reset link will land on Supabase Site URL root",
    });
  }
  const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
    ...(origin ? { redirectTo: `${origin}/auth/callback?next=/auth/update-password` } : {}),
  });
  return { error: error ? error.message : null };
}
