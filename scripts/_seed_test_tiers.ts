/**
 * Throwaway-seed: создаёт два тестовых аккаунта (Premium + Ultra) и выдаёт им
 * comp-грант тарифа, чтобы оператор вручную проверил тарифное гейтирование на
 * живом сайте.
 *
 * Это НЕ боевой путь грантов — единственный боевой путь выдачи тарифа — это
 * webhook оплаты (src/lib/payments/index.ts). Здесь грант ставится напрямую,
 * зеркаля только запись профиля из боевого пути: profile.tier = premium|ultra,
 * profile.premium_until = NULL. effectiveTier() трактует null на non-basic как
 * «без срока» (см. src/lib/tiers.ts), поэтому comp-грант не истекает.
 *
 * Идемпотентно: повторный запуск переиспользует существующие аккаунты и
 * переустанавливает тариф — не плодит дубли и не падает.
 *
 * Запуск (ОПЕРАТОР, против прод-Supabase — не автоматизирован здесь):
 *   SEED_PREMIUM_EMAIL=... SEED_PREMIUM_PASSWORD=... \
 *   SEED_ULTRA_EMAIL=...   SEED_ULTRA_PASSWORD=...   \
 *   npx tsx scripts/_seed_test_tiers.ts
 * SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL (или NEXT_PUBLIC_SUPABASE_URL) и
 * DIRECT_URL (или DATABASE_URL) берутся из .env.local. Креды НЕ печатаются.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { profile } from "../src/db/schema";
import { effectiveTier, type Tier } from "../src/lib/tiers";

const HERE = dirname(fileURLToPath(import.meta.url));
// Грузим .env.local так же, как migrate.ts (единый источник кред/ключей).
config({ path: join(HERE, "..", ".env.local") });

/** Тариф, который выдаёт скрипт (basic не выдаём — он дефолт). */
type GrantTier = "premium" | "ultra";

interface SeedAccount {
  tier: GrantTier;
  email: string;
  password: string;
}

/** Drizzle-инстанс над нашим owner-подключением (только таблица profile). */
type Db = PostgresJsDatabase<{ profile: typeof profile }>;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Прочитать конфигурацию из ENV. Собирает ВСЕ отсутствующие переменные (а не
 * падает на первой), печатает один `[FAIL] missing env:` и возвращает null —
 * вызывающий код завершит процесс с кодом 1. Данные из ENV — это данные, не
 * команды: используем их только как строки подключения/креды.
 */
function resolveConfig(): {
  accounts: SeedAccount[];
  supabaseUrl: string;
  serviceRoleKey: string;
  dbUrl: string;
} | null {
  const missing: string[] = [];

  const req = (name: string): string => {
    const v = process.env[name];
    if (!v || v.trim() === "") {
      missing.push(name);
      return "";
    }
    return v;
  };
  // Пары с фолбэком: достаточно одной из двух (зеркалит .env.example / migrate.ts).
  const oneOf = (primary: string, fallback: string): string => {
    const v = process.env[primary] ?? process.env[fallback];
    if (!v || v.trim() === "") {
      missing.push(`${primary} (or ${fallback})`);
      return "";
    }
    return v;
  };

  const premiumEmail = req("SEED_PREMIUM_EMAIL");
  const premiumPassword = req("SEED_PREMIUM_PASSWORD");
  const ultraEmail = req("SEED_ULTRA_EMAIL");
  const ultraPassword = req("SEED_ULTRA_PASSWORD");
  const serviceRoleKey = req("SUPABASE_SERVICE_ROLE_KEY");
  const supabaseUrl = oneOf("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL");
  const dbUrl = oneOf("DIRECT_URL", "DATABASE_URL");

  if (missing.length > 0) {
    console.log(`[FAIL] missing env: ${missing.join(", ")}`);
    return null;
  }

  return {
    accounts: [
      { tier: "premium", email: premiumEmail, password: premiumPassword },
      { tier: "ultra", email: ultraEmail, password: ultraPassword },
    ],
    supabaseUrl,
    serviceRoleKey,
    dbUrl,
  };
}

/**
 * Признак «такой email уже зарегистрирован» в ответе admin.createUser. Сверяем по
 * стабильному коду ошибки + текстовому фолбэку; прочие 422 (напр. weak_password)
 * сюда НЕ попадают — они уйдут в общий [FAIL] с сообщением провайдера.
 */
function isAlreadyExists(error: { code?: string; message?: string }): boolean {
  const code = (error.code ?? "").toLowerCase();
  const msg = (error.message ?? "").toLowerCase();
  return code === "email_exists" || msg.includes("already");
}

/** Найти существующего пользователя по email (admin.listUsers, постранично). */
async function findUserByEmail(
  admin: SupabaseClient,
  email: string,
): Promise<{ id: string } | null> {
  const target = email.trim().toLowerCase();
  const perPage = 1000;
  // Жёсткий потолок страниц — backstop от бесконечного цикла, не реальный лимит.
  for (let page = 1; page <= 100; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    const found = data.users.find((u) => u.email?.toLowerCase() === target);
    if (found) return { id: found.id };
    if (data.users.length < perPage) return null; // последняя страница
  }
  return null;
}

/**
 * Создать пользователя через Supabase Admin API (service role) с подтверждённым
 * email. Уже существует -> переиспользовать (найти по email). Не падает на
 * повторном запуске.
 */
async function ensureUser(
  admin: SupabaseClient,
  acct: SeedAccount,
): Promise<{ id: string; status: "created" | "reused" }> {
  const { data, error } = await admin.auth.admin.createUser({
    email: acct.email,
    password: acct.password,
    email_confirm: true,
  });
  if (!error && data.user) {
    return { id: data.user.id, status: "created" };
  }
  if (error && isAlreadyExists(error)) {
    const existing = await findUserByEmail(admin, acct.email);
    if (!existing) {
      throw new Error(
        "createUser reported the account exists, but it wasn't found via listUsers",
      );
    }
    return { id: existing.id, status: "reused" };
  }
  throw new Error(`createUser failed: ${error?.message ?? "no user returned"}`);
}

/**
 * Дождаться, что триггер on_auth_user_created поднял public.profile. Для свежего
 * аккаунта триггер обычно отрабатывает синхронно, но даём короткий ретрай-поллинг
 * на лаг репликации. Для reused-аккаунта профиль уже есть — первый запрос попадает.
 */
async function waitForProfile(db: Db, userId: string): Promise<boolean> {
  for (let attempt = 0; attempt < 12; attempt++) {
    const rows = await db
      .select({ id: profile.id })
      .from(profile)
      .where(eq(profile.id, userId))
      .limit(1);
    if (rows.length > 0) return true;
    await sleep(400);
  }
  return false;
}

/**
 * Comp-грант: profile.tier = <premium|ultra>, premium_until = NULL (без срока).
 * Drizzle owner-путём (обходит RLS), зеркаля запись из applyCompletedPayment, но
 * без срока/payment-строки. 0 затронутых строк -> id не совпал -> ошибка.
 */
async function grantTier(
  db: Db,
  userId: string,
  tier: GrantTier,
): Promise<{ tier: Tier; premium_until: Date | null }> {
  const updated = await db
    .update(profile)
    .set({ tier, premiumUntil: null })
    .where(eq(profile.id, userId))
    .returning({ tier: profile.tier, premiumUntil: profile.premiumUntil });
  if (updated.length === 0) {
    throw new Error(`UPDATE matched 0 rows (profile ${userId} not found)`);
  }
  return { tier: updated[0].tier, premium_until: updated[0].premiumUntil };
}

async function main(): Promise<boolean> {
  const cfg = resolveConfig();
  if (!cfg) return false; // [FAIL] missing env уже напечатан -> exit 1

  const admin = createClient(cfg.supabaseUrl, cfg.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Owner-подключение как в migrate.ts (DIRECT_URL предпочтительнее пула).
  const sql = postgres(cfg.dbUrl, { max: 1, prepare: false, onnotice: () => {} });
  const db: Db = drizzle(sql, { schema: { profile } });

  try {
    let ok = 0;
    const lines: string[] = [];

    for (const acct of cfg.accounts) {
      try {
        const { id, status } = await ensureUser(admin, acct);
        const profileReady = await waitForProfile(db, id);
        if (!profileReady) {
          lines.push(
            `[FAIL] ${acct.email}: profile row not created by trigger after retries`,
          );
          continue;
        }
        const granted = await grantTier(db, id, acct.tier);
        const eff = effectiveTier({
          tier: granted.tier,
          premium_until: granted.premium_until,
        });
        lines.push(
          `[OK] ${acct.email} -> tier=${granted.tier} effectiveTier=${eff} (${status})`,
        );
        ok++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        lines.push(`[FAIL] ${acct.email}: ${msg}`);
      }
    }

    for (const line of lines) console.log(line);

    // Контекст для оператора — в stderr, чтобы stdout остался чистым контрактом
    // (строки аккаунтов + итог последней строкой). В терминале оператор всё видит.
    console.error("");
    console.error(
      "NOTE: Ultra ≈ Premium по поведению — единственное отличие AI (Phase 3, заморожен).",
    );
    console.error("NOTE: проверять реально включённые различия тарифов:");
    console.error(
      "NOTE:   • Basic daily-limit (BASIC_DAILY_LIMIT=25) vs unlimited у premium/ultra;",
    );
    console.error("NOTE:   • замки каталога / старта теста / ревью результата;");
    console.error("NOTE:   • состояние /app/upgrade и бейдж тарифа в /app/profile.");
    console.error("NOTE: логиниться этими аккаунтами на сайте заданными SEED_*-кредами.");
    console.error("");

    const allOk = ok === cfg.accounts.length;
    if (allOk) {
      console.log(`[OK] ${ok}/${cfg.accounts.length} accounts ready`);
    } else {
      console.log(`[FAIL] ${ok}/${cfg.accounts.length}`);
    }
    return allOk;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main()
  .then((allOk) => process.exit(allOk ? 0 : 1))
  .catch((e) => {
    // Любой непойманный сбой: контекст + ненулевой выход, не глотаем.
    console.log(`[FAIL] ${e instanceof Error ? e.message : String(e)}`);
    console.error(e);
    process.exit(1);
  });
