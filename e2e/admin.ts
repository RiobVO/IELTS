import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// Playwright-тесты — отдельный Node-процесс, .env.local не подхватывается сам
// (это делает Next.js на билде). Парсим вручную — dotenv тянуть ради 2 строк
// не нужно, формат простой KEY=VALUE.
function loadEnvLocal(): Record<string, string> {
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

const env = { ...loadEnvLocal(), ...process.env };

/**
 * Провижининг тестового аккаунта в обход письма подтверждения: signup-форма
 * зависит от доставки почты (см. auth.ts — реальный signup на .test-домене
 * падает "Error sending confirmation email"), а логин-смоук не должен зависеть
 * от состояния почтового шлюза. Admin API создаёт пользователя сразу
 * confirmed — идемпотентно (существует → игнорируем "already been registered").
 */
export async function ensureSmokeUserConfirmed(email: string, password: string): Promise<void> {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing — check .env.local");
  }
  const admin = createClient(url, key, { auth: { persistSession: false } });
  const { error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error && !/already been registered|already exists/i.test(error.message)) {
    throw new Error(`admin.createUser failed for smoke account: ${error.message}`);
  }
}
