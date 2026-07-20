import type { Page } from "@playwright/test";

// Персистентный тестовый аккаунт: provisioning идёт в обход UI/почты через
// admin API (global-setup.ts → ensureSmokeUserConfirmed), сам смоук только
// логинится реальной формой. Так login-тест не зависит от состояния
// email-шлюза (см. signup.spec.ts — там наоборот, форма регистрации
// проверяется по-настоящему, включая обе ветки confirm-email).
export const SMOKE_EMAIL = process.env.SMOKE_EMAIL ?? "e2e-smoke@bando-test.local";
export const SMOKE_PASSWORD = process.env.SMOKE_PASSWORD ?? "smoke-test-password-1";

/**
 * Логинит произвольный аккаунт реальной формой и оставляет page на /app.
 * Вынесена из ensureLoggedIn (было хардкод SMOKE_EMAIL/SMOKE_PASSWORD) — cap-спеку
 * (e2e/cap.spec.ts) нужен логин cap-юзером (basic tier), тем же реальным путём.
 */
export async function loginAs(page: Page, email: string, password: string): Promise<void> {
  // Перед каждым логином чистим IP-бюджет auth-троттла (см. purgeAuthThrottle):
  // сьют делает ~13 логинов при лимите 10/10мин — иначе хвост сьюта детерминированно
  // красный. Динамический import рвёт статический цикл auth.ts ↔ seed.ts (seed
  // импортирует SMOKE_* константы отсюда).
  const { purgeAuthThrottle } = await import("./seed");
  await purgeAuthThrottle();

  await page.goto("/auth?mode=login");
  // AuthScreen рендерит ОБЕ формы одновременно (idle-форма скрыта opacity+pointer-
  // events, не display:none) — getByLabel("Email") матчил бы оба #signup-email и
  // #login-email разом. Берём по id, он уникален для активной формы.
  await page.locator("#login-email").fill(email);
  await page.locator("#login-password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();

  // waitForURL резолвится НЕМЕДЛЕННО, если текущий URL уже матчит паттерн — а
  // мы стартуем именно с /auth?mode=login. Ждём предикат, истинный ТОЛЬКО
  // после реального редиректа: успех уводит с /auth (next="/app" по
  // умолчанию), провал добавляет error= (см. actions.ts fail()).
  await page.waitForURL(
    (url) => !url.pathname.startsWith("/auth") || url.searchParams.has("error"),
    { timeout: 10_000 },
  );
  if (page.url().includes("error=")) {
    throw new Error(`login failed for ${email}: ${page.url()}`);
  }
  await page.waitForURL(/\/app(\/|$|\?)/, { timeout: 10_000 });
}

/** Логинит тестовый smoke-аккаунт реальной формой и оставляет page на /app. */
export async function ensureLoggedIn(page: Page): Promise<void> {
  await loginAs(page, SMOKE_EMAIL, SMOKE_PASSWORD);
}
