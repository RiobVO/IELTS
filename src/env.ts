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
