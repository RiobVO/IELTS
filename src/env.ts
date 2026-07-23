/**
 * Centralised, fail-fast env access. Importing this module throws immediately
 * if any required variable is missing — no silent fallbacks, no hardcoded
 * secrets (BRIEF §6.1: secrets live in env).
 */
const REQUIRED = [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "DATABASE_URL",
] as const;

type RequiredKey = (typeof REQUIRED)[number];

function load(): Record<RequiredKey, string> {
  const missing = REQUIRED.filter(
    (k) => !process.env[k] || process.env[k]!.trim() === "",
  );
  if (missing.length > 0) {
    throw new Error(
      `Missing required env var(s): ${missing.join(", ")}. ` +
        `Copy .env.example to .env.local and fill them in.`,
    );
  }
  return Object.fromEntries(
    REQUIRED.map((k) => [k, process.env[k]!]),
  ) as Record<RequiredKey, string>;
}

export const env = load();

/**
 * Optional payment-provider secrets (BRIEF §4.8). Unlike the core vars above
 * these are NOT required to boot — merchant keys may be absent before onboarding
 * (§10). When a provider's key is null the webhook runs in stub/dev mode
 * (signature check skipped + logged) so the lifecycle is testable without real
 * credentials. Never throws.
 */
const PAYMENT_KEYS = {
  payme: "PAYME_MERCHANT_KEY",
  click: "CLICK_SECRET_KEY",
  uzum: "UZUM_SECRET_KEY",
} as const;

export type PaymentProviderKey = keyof typeof PAYMENT_KEYS;

/** The configured secret for a provider, or null if not onboarded yet. */
export function paymentSecret(provider: PaymentProviderKey): string | null {
  const v = process.env[PAYMENT_KEYS[provider]];
  return v && v.trim() !== "" ? v : null;
}

/**
 * Shared secret guarding the cron expiry endpoint (§11 downgrade job). Absent =>
 * the endpoint must refuse all calls (fail closed), never run unauthenticated.
 */
export function cronSecret(): string | null {
  const v = process.env.CRON_SECRET;
  return v && v.trim() !== "" ? v : null;
}

/**
 * Опциональная конфигурация PostHog (продуктовая аналитика, BRIEF §11). Как и
 * платёжные ключи — НЕ обязательна для старта: без ключа аналитика работает
 * no-op (fail-open — телеметрия некритична, в отличие от платежей). Один
 * project-ключ обслуживает и браузер, и серверный capture; host по умолчанию —
 * US-облако PostHog, переопределяется через env. Ключ публичный (NEXT_PUBLIC_,
 * ingest-only) — безопасен в браузере. SERVER-ONLY-чтение здесь; клиентский
 * провайдер получает эти значения пропсами из server-компонента, а не импортом
 * этого модуля (он валидирует серверные секреты при загрузке).
 */
export function posthogConfig(): { key: string; host: string } | null {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key || key.trim() === "") return null;
  const host =
    process.env.NEXT_PUBLIC_POSTHOG_HOST?.trim() || "https://us.i.posthog.com";
  return { key, host };
}

/**
 * Опциональная конфигурация Sentry (error-monitoring, BRIEF §11). Как и PostHog —
 * НЕ обязательна для старта: без DSN мониторинг работает no-op (fail-open). DSN
 * публичный (NEXT_PUBLIC_, ingest-only) — безопасен в браузере; один DSN
 * обслуживает server/edge/browser. SERVER/EDGE-чтение здесь (sentry.*.config);
 * клиентский init читает process.env напрямую, не импортируя этот модуль (он
 * валидирует серверные секреты при загрузке). Source-map upload (читаемые
 * стектрейсы) требует auth-token — отложен до запуска; ошибки ловятся и без него.
 */
export function sentryConfig(): { dsn: string; environment: string } | null {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn || dsn.trim() === "") return null;
  const environment =
    process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT?.trim() ||
    process.env.NODE_ENV ||
    "development";
  return { dsn, environment };
}

/**
 * Опциональная конфигурация Telegram-бота импорта контента (admin-канал загрузки
 * тестов). Без TELEGRAM_BOT_TOKEN бот выключен — его webhook отвечает no-op.
 * SERVER-ONLY секреты. adminIds — whitelist Telegram user_id, которым разрешён
 * импорт: бот пишет в БД owner-путём (в обход RLS), не из пользовательской сессии,
 * поэтому круг отправителей и есть граница безопасности. webhookSecret сверяется с
 * заголовком X-Telegram-Bot-Api-Secret-Token (его же передаём в setWebhook).
 */
export function telegramConfig(): {
  token: string;
  adminIds: number[];
  webhookSecret: string | null;
} | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token.trim() === "") return null;
  const adminIds = (process.env.TELEGRAM_ADMIN_IDS ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim() || null;
  return { token, adminIds, webhookSecret };
}
