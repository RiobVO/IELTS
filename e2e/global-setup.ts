import { ensureSmokeUserConfirmed } from "./admin";
import { SMOKE_EMAIL, SMOKE_PASSWORD } from "./auth";

// Один раз перед всем сьютом: гарантируем confirmed-аккаунт в обход почты
// (admin API), чтобы логин-смоук не зависел от состояния email-шлюза.
export default async function globalSetup(): Promise<void> {
  await ensureSmokeUserConfirmed(SMOKE_EMAIL, SMOKE_PASSWORD);
}
