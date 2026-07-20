import { ensureSmokeUserConfirmed } from "./admin";
import { SMOKE_EMAIL, SMOKE_PASSWORD } from "./auth";
import { seedStatefulE2e } from "./seed";
import { loadE2eEnv, statefulE2eBlockReason, STATEFUL_E2E_BLOCKED_MESSAGE } from "./stateful-gate";

// Один раз перед всем сьютом: гарантируем confirmed-аккаунт в обход почты
// (admin API), чтобы логин-смоук не зависел от состояния email-шлюза.
// Гейт — первым делом: ensureSmokeUserConfirmed реально создаёт юзера через
// service-role (SUPABASE_URL), а не только через DATABASE_URL/DIRECT_URL
// (prod-readiness аудит: без предохранителя штатный `npm run test:e2e` пишет
// в боевую базу). Конкретный reason — в сообщение, не только generic-текст.
//
// env резолвится РОВНО ОДИН РАЗ и прокидывается дальше во все потребители
// кредов (ensureSmokeUserConfirmed, seedStatefulE2e) — гейт и провижининг
// обязаны судить по одному и тому же снапшоту .env-каскада (внешний ревью,
// находка A). Второй вызов loadE2eEnv() здесь читал бы файлы заново и в
// теории мог бы разойтись с уже проверенным объектом.
export default async function globalSetup(): Promise<void> {
  const env = loadE2eEnv();
  const reason = statefulE2eBlockReason(env);
  if (reason) {
    throw new Error(`${STATEFUL_E2E_BLOCKED_MESSAGE}: ${reason}`);
  }
  await ensureSmokeUserConfirmed(SMOKE_EMAIL, SMOKE_PASSWORD, env);
  // Гейт выше уже бросил при непройденном контракте — сид идёт только на
  // проверенном тест-таргете (обычный `npm run test:e2e` без ALLOW_STATEFUL_E2E
  // падает на throw выше и до сида не доходит, поведение прежнее).
  await seedStatefulE2e(env);
}
