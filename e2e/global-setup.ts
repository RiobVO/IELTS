import { ensureSmokeUserConfirmed } from "./admin";
import { SMOKE_EMAIL, SMOKE_PASSWORD } from "./auth";
import { isStatefulE2eAllowed, loadE2eEnv, STATEFUL_E2E_BLOCKED_MESSAGE } from "./stateful-gate";

// Один раз перед всем сьютом: гарантируем confirmed-аккаунт в обход почты
// (admin API), чтобы логин-смоук не зависел от состояния email-шлюза.
// Гейт — первым делом: ensureSmokeUserConfirmed реально создаёт юзера через
// service-role в БД, на которую указывает DATABASE_URL/DIRECT_URL (prod-readiness
// аудит: без предохранителя штатный `npm run test:e2e` пишет в боевую базу).
export default async function globalSetup(): Promise<void> {
  if (!isStatefulE2eAllowed(loadE2eEnv())) {
    throw new Error(STATEFUL_E2E_BLOCKED_MESSAGE);
  }
  await ensureSmokeUserConfirmed(SMOKE_EMAIL, SMOKE_PASSWORD);
}
