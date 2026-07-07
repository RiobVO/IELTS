import { test, expect } from "@playwright/test";
import { ensureLoggedIn } from "./auth";

// Смоук пишет реальные строки в боевую БД (нет staging-окружения, продукт ещё
// без живых клиентов — осознанное решение владельца). Тестовый аккаунт
// переиспользуется (см. e2e/auth.ts), submit практики создаёт одну строку
// attempt на прогон — приемлемо на этой стадии, но не гонять в цикле без пауз
// (signupThrottle бюджет 10/час, см. auth.ts).

test.describe("smoke", () => {
  test("login lands on the authenticated app", async ({ page }) => {
    await ensureLoggedIn(page);
    await expect(page).toHaveURL(/\/app(\/|$|\?)/);
    // Свежий admin-provisioned аккаунт без пройденного онбординга landит на
    // /app-онбординг (не на AppShell-дашборд с #content) — оба реальные
    // /app-экраны залогиненной зоны. Проверяем общий сигнал "реальный контент
    // отрендерился", а не конкретный дашборд-скелет.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("start a reading practice test, submit, see a result", async ({ page }) => {
    await ensureLoggedIn(page);

    await page.goto("/app/practice?skill=reading");
    // Прод-факт (проверено запросом к content_item, 2026-07-08): 100%
    // опубликованного Reading/Listening-контента (12+8) сейчас идёт через
    // mock/runner (has_runner=true) — атомизированных (/app/reading/[id] без
    // раннера) тестов в каталоге просто нет. Единственный golden path,
    // который реально существует сегодня, — mock: /app/exam/[id].
    const firstTest = page.locator('a.pc-row[href^="/app/exam/"]').first();
    await expect(firstTest).toBeVisible({ timeout: 10_000 });
    await firstTest.click();

    await page.waitForURL(/\/app\/exam\/[0-9a-f-]{36}(\?|$)/, { timeout: 15_000 });

    // /app/exam/[id] сам по себе — экран выбора режима (ModeStart), раннер ещё
    // не создан. "Start practice" (untimed, "Never affects your rating or
    // daily limit") безопаснее для смоука, чем mock — не трогает реальную
    // рейтинговую попытку пользователя. Живой прогон показал: mode=practice
    // рендерит ТОТ ЖЕ атомизированный ExamRunner, что и /app/reading/[id]
    // (видно по UI — Session goal/Target pace/обычная кнопка Submit в DOM),
    // а не sandboxed iframe — тот зарезервирован строго за mode=mock.
    // Иерархия P0-изоляции (CLAUDE.md) относится к mock-режиму, здесь не
    // применима.
    // Аккаунт переиспользуется между прогонами (см. auth.ts) — если предыдущий
    // прогон оставил attempt в статусе in_progress (например, упал раньше
    // Submit), клик по той же карточке РЕЗЮМИРУЕТ его и уводит сразу в раннер,
    // минуя ModeStart. Толерантны к обоим исходам вместо жёсткого ожидания
    // ModeStart.
    // isVisible() — точечная проверка БЕЗ ожидания рендера (в отличие от
    // waitFor/expect().toBeVisible()) — на переходной странице сразу после
    // навигации она ловит момент до рендера и молча возвращает false. Нужна
    // честная гонка: ждём, какое из двух состояний реально появится первым.
    const startPracticeLink = page.getByRole("link", { name: "Start practice" });
    const submitButton = page.getByRole("button", { name: "Submit" });
    const state = await Promise.race([
      startPracticeLink.waitFor({ state: "visible", timeout: 15_000 }).then(() => "modestart" as const),
      submitButton.waitFor({ state: "visible", timeout: 15_000 }).then(() => "runner" as const),
    ]);
    if (state === "modestart") {
      await startPracticeLink.click();
      await page.waitForURL(/\/app\/exam\/[0-9a-f-]{36}\?mode=practice/, { timeout: 15_000 });
      await submitButton.waitFor({ state: "visible", timeout: 15_000 });
    }

    // Submit не требует ответов на все вопросы (частичный сабмит — легитимный
    // продуктовый путь) — кликаем сразу, это и есть минимальный golden path.
    await submitButton.click();

    // submitAttempt — общий server action (не привязан к раннеру), редиректит
    // результат-экран, что и у атомизированного пути.
    await page.waitForURL(/\/app\/reading\/[0-9a-f-]{36}\/result(\?|$)/, { timeout: 15_000 });
    await expect(page.locator("#content")).toBeVisible();
  });

  test("upgrade page opens without initiating a real charge", async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto("/app/upgrade");
    await expect(page).toHaveURL(/\/app\/upgrade/);
    await expect(page.locator("#content")).toBeVisible();
    // Только открытие страницы — платёж (SimulatePayment) намеренно не трогаем.
  });
});
