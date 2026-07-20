import { test, expect } from "@playwright/test";
import { ensureLoggedIn } from "./auth";
import { isStatefulE2eAllowed, loadE2eEnv, STATEFUL_E2E_BLOCKED_MESSAGE } from "./stateful-gate";

// Session-protection + real sign-out против hosted тест-стенда (волна 3a, TESTING_PLAN §9).
// Пишет только сессию smoke-аккаунта (переиспользуемого между спеками, см. auth.ts) —
// БД не трогает, поэтому без cleanup-хелперов из seed.ts.

test.describe("auth", () => {
  test.beforeEach(() => {
    test.skip(!isStatefulE2eAllowed(loadE2eEnv()), STATEFUL_E2E_BLOCKED_MESSAGE);
  });

  test("unauthenticated /app redirects to the auth screen", async ({ page }) => {
    // Чистый контекст (Playwright даёт новый browser context на каждый test) —
    // без cookies сессии middleware (src/lib/supabase/middleware.ts) обязан
    // увести с /app на /auth?next=/app до какого-либо app-рендера.
    await page.goto("/app");
    await page.waitForURL(/\/auth(\?|$)/, { timeout: 10_000 });
    await expect(page).toHaveURL(/\/auth(\?|$)/);

    // /auth без ?mode=login по умолчанию рендерит SIGNUP-форму (app/auth/page.tsx:
    // initialMode = sp.mode === "login" ? "login" : "signup") — middleware редиректит
    // БЕЗ mode=, только next=. Логин-форма при этом реально на странице (просто
    // idle: opacity 0 + pointer-events none, не unmounted) и достижима десктопным
    // тогглом на violet-панели ("Log in") без повторной навигации. Кликаем его и
    // проверяем, что форма логина реально становится видимой и рабочей — это и есть
    // требуемый "видимая форма логина" сигнал, а не просто URL.
    await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.locator("#login-email")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  });

  // Login + sign-out объединены в один тест (одна форма-логин вместо двух) — оба
  // сценария живут на общем smoke-аккаунте, а login/10мин-throttle (§11, 10 попыток
  // с одного IP, см. app/auth/actions.ts checkAuthThrottle) — общий на ВЕСЬ hosted
  // тест-стенд, его делят все stateful-спеки (smoke/reading/mock-iframe и т.д.).
  // Каждый лишний вызов ensureLoggedIn — минус одна попытка из шеринного бюджета.
  test("login with the real form reaches /app, sign out via the real UI clears the session", async ({
    page,
  }) => {
    await ensureLoggedIn(page);
    await expect(page).toHaveURL(/\/app(\/|$|\?)/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    // ensureLoggedIn лишь ждёт /app(/|$|?) — свежий/ещё-не-онбордингнутый smoke-
    // аккаунт landit на /app/onboarding (см. smoke.spec.ts), которая рендерится БЕЗ
    // AppShell/AppHeader (живой прогон это подтвердил — там нет кнопки Sign out
    // вовсе). Явный переход на /app/practice гарантирует authed-экран с хедером
    // независимо от онбординг-состояния переиспользуемого аккаунта.
    await page.goto("/app/practice");

    // Desktop-хедер (playwright.config.ts — Desktop Chrome device, >=1024px): кнопка
    // выхода — иконка с aria-label "Sign out" внутри <form action={signOut}>
    // (AppHeader.tsx). Мобильный drawer-дубликат с тем же текстом не примонтирован
    // (рендерится только пока open===true) — конфликта strict-mode не будет.
    await page.getByRole("button", { name: "Sign out" }).click();

    // signOut() (app/auth/actions.ts) редиректит на /auth (без next=) после
    // supabase.auth.signOut() — сессия снята server-side.
    await page.waitForURL(/\/auth(\?|$)/, { timeout: 10_000 });
    await expect(page).toHaveURL(/\/auth(\?|$)/);

    // Повторный заход на защищённый путь без сессии обязан снова упереться в
    // middleware-редирект — доказывает, что sign-out не просто сменил экран, а
    // реально снял cookie-сессию (иначе /app осталась бы доступна).
    await page.goto("/app");
    await page.waitForURL(/\/auth(\?|$)/, { timeout: 10_000 });
    await expect(page).toHaveURL(/\/auth(\?|$)/);
  });
});
