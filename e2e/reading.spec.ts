import { test, expect } from "@playwright/test";
import { ensureLoggedIn } from "./auth";
import { SEED_ATOMIZED_READING_ID } from "./seed";
import { isStatefulE2eAllowed, loadE2eEnv, STATEFUL_E2E_BLOCKED_MESSAGE } from "./stateful-gate";

// Golden path атомизированного practice против hosted тест-стенда (волна 3a,
// TESTING_PLAN §9). Работает с seed-item SEED_ATOMIZED_READING_ID — без runner_html,
// поэтому каталог маршрутит его на /app/reading/[id], т.е. атомизированный ExamRunner
// (не iframe). 5 вопросов разных типов заданы в e2e/seed.ts.
//
// Чистый вход БЕЗ in-spec-очистки — осознанно. global-setup пере-сеет контент каждый
// прогон, а seedOneContent DELETE'ит content_item по source-ключу с FK-cascade на
// attempt (e2e/seed.ts) → на старте сьюта у seed-item НОЛЬ попыток, только сам тест
// создаёт здесь attempt. User-scoped deleteInProgressAttemptsByEmail НЕ зовём намеренно:
// он снёс бы in_progress mock-спека (общий smoke-аккаунт), а Playwright крутит файлы в
// разных воркерах (fullyParallel:false воркеры к одному не сводит).

test.describe("atomized reading practice", () => {
  test.beforeEach(() => {
    test.skip(!isStatefulE2eAllowed(loadE2eEnv()), STATEFUL_E2E_BLOCKED_MESSAGE);
  });

  test("answer, autosave, reload restores answers, submit shows the score", async ({ page }) => {
    await ensureLoggedIn(page);

    // ?mode=practice минует ModeStart: страница берёт режим из query (page.tsx modeParam)
    // и сразу открывает атомизированный раннер со свежей практис-попыткой (smoke-юзер
    // premium → дневной practice-кап неприменим, старт всегда проходит).
    await page.goto(`/app/reading/${SEED_ATOMIZED_READING_ID}?mode=practice`);

    // MCQ скоупим по radiogroup: "Option B" присутствует и в Q2, и в Q5 (одинаковый
    // набор опций) — без скоупа getByRole("radio") нарвался бы на strict-mode дубль.
    const q2 = page.getByRole("radiogroup", { name: "Answer for question 2" });
    const q3 = page.getByRole("textbox", { name: "Answer for question 3" });
    const q4 = page.getByRole("textbox", { name: "Answer for question 4" });

    await expect(q3).toBeVisible({ timeout: 15_000 });

    // Три разных типа контрола реальными взаимодействиями: MCQ-radio (Q2, accept "B"),
    // inline-gap текст (Q3 sentence_completion — поле встроено в пропуск промпта,
    // accept "CLIMATE"), обычный текст-инпут снизу (Q4 short_answer, accept WATER/H2O).
    // Все три верны, Q1/Q5 оставляем пустыми → детерминированный счёт 3/5.
    await q2.getByRole("radio", { name: "Option B" }).click();
    await q3.fill("CLIMATE");
    await q4.fill("WATER");

    // Детерминированный сигнал автосейва вместо слепого sleep: saveProgress — Next
    // server action, т.е. POST на URL текущей страницы. Debounce ExamRunner = 1500ms,
    // сбрасывается на каждый ввод и стреляет один раз после последнего изменения.
    // Листенер вешаем сразу после последнего fill (микросекунды << 1500ms) → ловим
    // именно финальный POST, в котором лежат все три ответа (answers-стейт накопительный).
    const saveResp = await page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        r.url().includes(SEED_ATOMIZED_READING_ID) &&
        r.status() === 200,
      { timeout: 15_000 },
    );
    expect(saveResp.ok()).toBeTruthy();

    // Reload → resume той же in_progress-попытки (page.tsx: existing.mode="practice"),
    // initialAnswers = сохранённые ответы. Проверяем ТОЧНЫЕ значения в тех же контролах,
    // а не факт «страница открылась».
    await page.reload();
    await expect(q3).toHaveValue("CLIMATE");
    await expect(q4).toHaveValue("WATER");
    await expect(q2.getByRole("radio", { name: "Option B" })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    // Submit → общий submitAttempt → redirect на /result. Практис-хиро показывает
    // "raw / total correct" (ResultCoach .rc-vd-score, рендерится под гейтом isPractice).
    await page.getByRole("button", { name: "Submit" }).click();
    await page.waitForURL(
      new RegExp(`/app/reading/${SEED_ATOMIZED_READING_ID}/result(\\?|$)`),
      { timeout: 15_000 },
    );
    // 3 верных из 5 — балл, согласованный ровно с данными ответами.
    await expect(page.locator(".rc-vd-score")).toContainText("3 / 5 correct");
  });
});
