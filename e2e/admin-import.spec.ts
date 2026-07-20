import { test, expect } from "@playwright/test";
import { loginAs, SMOKE_EMAIL, SMOKE_PASSWORD } from "./auth";
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  resetAdminDraftItem,
  SEED_ADMIN_DRAFT_ID,
  SEED_ADMIN_DRAFT_TITLE,
} from "./seed";
import { isStatefulE2eAllowed, loadE2eEnv, STATEFUL_E2E_BLOCKED_MESSAGE } from "./stateful-gate";

// Admin review→publish против hosted тест-стенда (волна 3b, TESTING_PLAN §9). Реальный
// импорт (CLI/telegram) здесь НЕ гоняем — SEED_ADMIN_DRAFT_ID сидится напрямую в
// канонических формах persist.ts (e2e/seed.ts, тот же приём, что ATOMIZED_READING), но
// status='draft' + reviewed_at=null, чтобы этот тест проходил approve→publish через
// РЕАЛЬНЫЙ /admin UI (app/admin/actions.ts markReviewed → setStatus, оба публикуют
// через общий гейт publishReviewedContentItem — src/lib/content/publish.ts). Global-setup
// пере-сеет этот item в draft на каждый прогон; afterAll ниже — belt-and-braces того же
// образца, что cap.spec.ts afterAll (на случай будущего второго теста в этом файле).
//
// После ассерта в /app/practice тест ТАКЖЕ откатывает publish через реальную кнопку
// «Unpublish» (тот же setStatus, что publish — admin/page.tsx строка it.status==="published"),
// а не только через resetAdminDraftItem: внешнее ревью нашло, что DB-only откат не трогает
// кэш каталога (getPublishedTests, тег content_item, TTL 300с) — опубликованный клон
// оставался бы виден ещё до 5 минут. Реальный клик прогоняет revalidateTag синхронно,
// тем же путём, что publish. resetAdminDraftItem() в afterAll остаётся аварийным fallback
// (и обнуляет reviewed_at — Unpublish его не трогает) на случай, если шаг с кликом не
// дойдёт (тест упал раньше).

test.describe("admin review and publish", () => {
  test.beforeEach(() => {
    test.skip(!isStatefulE2eAllowed(loadE2eEnv()), STATEFUL_E2E_BLOCKED_MESSAGE);
  });

  test.afterAll(async () => {
    await resetAdminDraftItem();
  });

  test("admin approves and publishes a draft; it appears in the practice catalog", async ({ page }) => {
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto("/admin");

    // li id-якорь (id={it.id} в app/admin/page.tsx) — CSS id-селектор с ведущей цифрой
    // невалиден без экранирования, атрибутный селектор его обходит.
    const row = page.locator(`li[id="${SEED_ADMIN_DRAFT_ID}"]`);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row.getByText("draft", { exact: true })).toBeVisible();
    await expect(row.getByText("needs review", { exact: true })).toBeVisible();

    // Approve (markReviewed) — обычный SubmitButton, без confirm-диалога. Редиректит на
    // /admin#<id> через Server Action-навигацию — hash-таргет там ненадёжен для waitForURL
    // (fragment-only navigation не всегда всплывает как отдельное framenavigated-событие),
    // поэтому ждём результат напрямую по перерендеренному badge (expect сам ретраит).
    await row.getByRole("button", { name: "Approve" }).click();
    await expect(row.getByText("reviewed", { exact: true })).toBeVisible({ timeout: 15_000 });

    // Publish (setStatus → publishReviewedContentItem) — ConfirmButton, требует
    // нативный window.confirm; регистрируем accept ДО клика (Playwright по умолчанию
    // отклоняет диалоги без явного listener'а).
    page.once("dialog", (dialog) => dialog.accept());
    await row.getByRole("button", { name: "Publish" }).click();
    await expect(row.getByText("published", { exact: true })).toBeVisible({ timeout: 15_000 });

    // Каталог (getPublishedTests, тег content_item) — setStatus ревалидирует тег синхронно
    // с publish, поэтому свежая /app/practice уже должна видеть тест без доп. ожидания.
    await page.goto("/app/practice");
    await page.getByRole("textbox", { name: "Search tests by title" }).fill(SEED_ADMIN_DRAFT_TITLE);
    await expect(page.getByText(SEED_ADMIN_DRAFT_TITLE, { exact: true })).toBeVisible({ timeout: 15_000 });

    // Реальный unpublish через штатный UI-гейт (setStatus → status="draft"), а не
    // DB-reset: revalidateTag("content_item")/revalidateTag(contentTag(id)) выполняются
    // здесь синхронно, тем же кодовым путём, что publish — иначе кэш каталога (getPublishedTests,
    // TTL 300с) остался бы с опубликованным клоном до истечения окна, что и нашло внешнее
    // ревью для DB-only отката. resetAdminDraftItem() в afterAll — только аварийный fallback
    // (например если этот шаг сам упадёт до клика), не основной путь очистки.
    await page.goto("/admin");
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.getByRole("button", { name: "Unpublish" }).click();
    await expect(row.getByText("draft", { exact: true })).toBeVisible({ timeout: 15_000 });

    // Доказываем, что revalidate реально сработал (не просто DB откатилась): каталог
    // синхронно перестаёт отдавать тест по тому же поисковому запросу.
    await page.goto("/app/practice");
    await page.getByRole("textbox", { name: "Search tests by title" }).fill(SEED_ADMIN_DRAFT_TITLE);
    await expect(page.getByText(SEED_ADMIN_DRAFT_TITLE, { exact: true })).not.toBeVisible({ timeout: 15_000 });
  });

  test("a non-admin user is redirected away from /admin", async ({ page }) => {
    // SMOKE_EMAIL — role='student' (default), tier='premium' (е2e/seed.ts) — премиум-тир
    // не влияет на requireAdmin: гейт судит только по profile.role (src/lib/auth.ts).
    await loginAs(page, SMOKE_EMAIL, SMOKE_PASSWORD);
    await page.goto("/admin");
    // requireAdmin шлёт на голый /app; если у SMOKE_EMAIL ещё не пройден онбординг
    // (профиль без onboarded_at — реальная возможность переиспользуемого аккаунта,
    // см. тот же кейс в smoke.spec.ts), /app/page.tsx редиректит дальше на
    // /app/onboarding. Оба landing — валидный "redirected away from /admin";
    // жёсткий pathname === "/app" ловил флак на втором хопе. Матчим тем же
    // паттерном, что и остальной сьют.
    await page.waitForURL(/\/app(\/|$|\?)/, { timeout: 15_000 });
  });
});
