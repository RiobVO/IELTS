import { test, expect } from "@playwright/test";
import { SMOKE_PASSWORD } from "./auth";
import { isStatefulE2eAllowed, loadE2eEnv, STATEFUL_E2E_BLOCKED_MESSAGE } from "./stateful-gate";

// Отдельно от smoke.spec.ts: тут проверяем РЕАЛЬНУЮ форму регистрации, а не
// провижининг тестового аккаунта (тот идёт в обход почты — global-setup.ts).
// Уникальный email на каждый прогон (signUp с уже существующим email — это
// fail-open anti-enumeration ветка, не годится для проверки "создание нового
// юзера реально работает"). Домен — реально доставляемый (Gmail +alias),
// НЕ .test/.local: IANA-резервные TLD любой SMTP отбивает на отправке, это
// артефакт фикстуры, а не сигнал о состоянии почтового шлюза (см. auth.ts).
// Тест толерантен к обеим веткам confirm-email (вкл/выкл на проекте) — не
// предполагает, какая сейчас активна.
test("signup form creates a new account (tolerant of email-confirm on/off)", async ({ page }) => {
  // Пишущий тест — создаёт реального юзера. global-setup.ts уже бросает
  // ошибку раньше при непройденном гейте; этот skip — защита на случай
  // прогона файла в обход global-setup (напр. --global-setup="").
  test.skip(!isStatefulE2eAllowed(loadE2eEnv()), STATEFUL_E2E_BLOCKED_MESSAGE);

  const email = `e2e-smoke+${Date.now()}@gmail.com`;

  await page.goto("/auth?mode=signup");
  await page.locator("#signup-name").fill("E2E Smoke");
  await page.locator("#signup-email").fill(email);
  await page.locator("#signup-password").fill(SMOKE_PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();

  // Стартовый URL — /auth?mode=signup, без error/message — предикат ждёт
  // РЕАЛЬНОГО редиректа, а не совпадения с текущим (см. auth.ts).
  await page.waitForURL(
    (url) => url.searchParams.has("message") || url.searchParams.has("error") || url.pathname.includes("check-email"),
    { timeout: 15_000 },
  );

  const url = page.url();
  if (url.includes("error=")) {
    throw new Error(`signup form rejected a fresh, valid email/password: ${url}`);
  }
  if (url.includes("check-email")) {
    // Confirm-email ВКЛ: письмо отправлено, сессии ещё нет — это ожидаемый
    // успешный исход этой ветки, дальше (клик по ссылке в письме) вне скоупа UI-теста.
    await expect(page.getByText(/check.*email/i).first()).toBeVisible();
    return;
  }
  // Confirm-email ВЫКЛ: signUp сразу выставил cookies сессии — идём на /app.
  await page.goto("/app");
  await expect(page).toHaveURL(/\/app(\/|$|\?)/);
});
