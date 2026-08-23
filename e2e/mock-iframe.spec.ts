import { test, expect } from "@playwright/test";
import { ensureLoggedIn } from "./auth";
import { SEED_RUNNER_MOCK_ID } from "./seed";
import { isStatefulE2eAllowed, loadE2eEnv, STATEFUL_E2E_BLOCKED_MESSAGE } from "./stateful-gate";

// Bridge/sandbox/CSP mock-раннера против hosted тест-стенда (волна 3a, TESTING_PLAN §9).
// SEED_RUNNER_MOCK_ID несёт синтетический runner_html → каталог маршрутит на
// /app/exam/[id]; ?mode=mock открывает iframe-раннер (practice ушёл бы редиректом на
// атомизированный /app/reading — см. exam page practiceServable).
//
// ?mode=mock детерминированно минует ModeStart (page.tsx берёт режим из query), поэтому
// повторный заход даже с уже submitted-попыткой всегда даёт свежий iframe: existing=null
// → mode=mock → ExamFrame (ModeStart не рендерится, Promise.race как в smoke не нужен).
// Пере-сев в global-setup дополнительно обнуляет попытки seed-item каждый прогон (cascade).

test.describe("mock iframe bridge", () => {
  test.beforeEach(() => {
    test.skip(!isStatefulE2eAllowed(loadE2eEnv()), STATEFUL_E2E_BLOCKED_MESSAGE);
  });

  test("iframe isolation, runner CSP, submit bridge grades 2/2", async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto(`/app/exam/${SEED_RUNNER_MOCK_ID}?mode=mock`);

    // (a) Изоляция iframe: sandbox РОВНО "allow-scripts allow-modals", без
    // allow-same-origin (opaque origin — P0-изоляция мока, ExamFrame.tsx). toHaveAttribute
    // с точной строкой заодно доказывает отсутствие allow-same-origin.
    const frame = page.locator("iframe.exam-frame");
    await expect(frame).toHaveAttribute("sandbox", "allow-scripts allow-modals", {
      timeout: 15_000,
    });

    // (b) Security-заголовки runner-роута. page.request шарит куки контекста →
    // авторизованный GET. CSP deny-by-default (default-src 'none') + connect-src 'none'
    // (главный анти-эксфил-винт) + отсутствие 'unsafe-eval' — сверка с route.ts.
    const runnerResp = await page.request.get(`/app/exam/${SEED_RUNNER_MOCK_ID}/runner`);
    expect(runnerResp.status()).toBe(200);
    const csp = runnerResp.headers()["content-security-policy"] ?? "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).not.toContain("unsafe-eval");

    // (c) Внутри iframe: у синтетического runner_html полей ввода НЕТ — ответы
    // ALPHA/BETA зашиты в обработчик Submit (seed.ts RUNNER_MOCK_HTML шлёт
    // parent.postMessage({type:"ielts-submit", answers:{"1":"ALPHA","2":"BETA"}})).
    // Клика по Submit достаточно, чтобы прогнать мост целиком. frameLocator ходит в
    // opaque-origin фрейм через CDP — sandbox без allow-same-origin ему не помеха.
    await page.frameLocator("iframe.exam-frame").locator("#submit").click();

    // (d) Parent принял postMessage (ExamFrame валидирует e.source===contentWindow) →
    // submitAttempt → redirect на /app/reading/<id>/result. Грейд 2/2 (ключи ALPHA/BETA
    // exact) → non-banded mock-хиро рисует 100% в диале (ResultCoach .rc-verdict).
    await page.waitForURL(
      new RegExp(`/app/reading/${SEED_RUNNER_MOCK_ID}/result(\\?|$)`),
      { timeout: 15_000 },
    );
    await expect(page.locator(".rc-verdict")).toContainText("100%");
  });
});
