import { createClient } from "@supabase/supabase-js";
import type { E2eEnv } from "./stateful-gate";

/**
 * Провижининг тестового аккаунта в обход письма подтверждения: signup-форма
 * зависит от доставки почты (см. auth.ts — реальный signup на .test-домене
 * падает "Error sending confirmation email"), а логин-смоук не должен зависеть
 * от состояния почтового шлюза. Admin API создаёт пользователя сразу
 * confirmed — идемпотентно (существует → игнорируем "already been registered").
 *
 * `env` обязан быть ТЕМ ЖЕ resolved-объектом, что прошёл гейт в global-setup
 * (loadE2eEnv() — полный каскад .env.development.local > .env.local >
 * .env.development > .env, как реально резолвит Next.js). Раньше этот модуль
 * читал СВОЙ собственный .env.local-only срез — при прод-.env.local +
 * тест-.env.development.local гейт проходил по dev.local (тест-таргет), а
 * этот клиент брал SUPABASE_URL из .env.local (прод) и создавал юзера в
 * боевой базе (внешний ревью, находка A).
 */
export async function ensureSmokeUserConfirmed(
  email: string,
  password: string,
  env: E2eEnv,
): Promise<void> {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing — check the resolved e2e env");
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
