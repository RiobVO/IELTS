import { ensureSmokeUserConfirmed } from "./admin";
import { SMOKE_EMAIL, SMOKE_PASSWORD } from "./auth";
import { loadE2eEnv, statefulE2eBlockReason, STATEFUL_E2E_BLOCKED_MESSAGE } from "./stateful-gate";

// Один раз перед всем сьютом: гарантируем confirmed-аккаунт в обход почты
// (admin API), чтобы логин-смоук не зависел от состояния email-шлюза.
// Гейт — первым делом: ensureSmokeUserConfirmed реально создаёт юзера через
// service-role (SUPABASE_URL), а не только через DATABASE_URL/DIRECT_URL
// (prod-readiness аудит: без предохранителя штатный `npm run test:e2e` пишет
// в боевую базу). Конкретный reason — в сообщение, не только generic-текст.
export default async function globalSetup(): Promise<void> {
  const reason = statefulE2eBlockReason(loadE2eEnv());
  if (reason) {
    throw new Error(`${STATEFUL_E2E_BLOCKED_MESSAGE}: ${reason}`);
  }
  await ensureSmokeUserConfirmed(SMOKE_EMAIL, SMOKE_PASSWORD);
}
