import { readFileSync } from "node:fs";

/**
 * Прод-ref проекта Supabase (см. .env.local). Пишущие e2e-спеки (signup,
 * smoke) создают реальных юзеров и attempt-строки через service-role — гейт
 * должен отказывать, даже если ALLOW_STATEFUL_E2E=1 выставлен по ошибке
 * поверх прод-конфига (двойная защита: флаг + не-прод БД).
 */
export const PROD_DB_REF = "oyecqbveatkolbqgfczq";

export type E2eEnv = Record<string, string | undefined>;

export const STATEFUL_E2E_BLOCKED_MESSAGE =
  "Stateful e2e blocked: set ALLOW_STATEFUL_E2E=1 and point at a non-prod DB";

// Playwright-процесс не подхватывает .env.local сам (это делает Next.js на
// билде) — читаем вручную, тот же формат/приоритет, что admin.ts.
function loadEnvLocalFile(): Record<string, string> {
  const out: Record<string, string> = {};
  let raw: string;
  try {
    raw = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  } catch {
    return out;
  }
  for (const line of raw.split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/** .env.local смёрженный с process.env (process.env приоритетнее) — то, что реально видят global-setup и спеки. */
export function loadE2eEnv(): E2eEnv {
  return { ...loadEnvLocalFile(), ...process.env };
}

function pointsAtProd(env: E2eEnv): boolean {
  return [env.DATABASE_URL, env.DIRECT_URL].some((url) => url?.includes(PROD_DB_REF) ?? false);
}

/**
 * Единый предикат гейта: пишущие e2e-спеки и их провижининг юзеров
 * (global-setup) разрешены ТОЛЬКО при явном opt-in И не-прод БД. Флаг сам по
 * себе недостаточен — гейт отказывает, даже если ALLOW_STATEFUL_E2E=1
 * выставлен, но DATABASE_URL/DIRECT_URL указывает на прод-ref.
 */
export function isStatefulE2eAllowed(env: E2eEnv): boolean {
  return env.ALLOW_STATEFUL_E2E === "1" && !pointsAtProd(env);
}
