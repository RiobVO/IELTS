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
