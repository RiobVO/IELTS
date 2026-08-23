import { test, expect } from "@playwright/test";
import { loginAs } from "./auth";
import {
  CAP_EMAIL,
  CAP_PASSWORD,
  deleteAllAttemptsByEmail,
  preloadPracticeStarts,
  SEED_ATOMIZED_READING_ID,
} from "./seed";
import { isStatefulE2eAllowed, loadE2eEnv, STATEFUL_E2E_BLOCKED_MESSAGE } from "./stateful-gate";
import { BASIC_PRACTICE_DAILY_LIMIT } from "../src/lib/tiers";

// Basic-кап на границе — дневной practice-лимит (§4.8, src/lib/exam/access.ts
// enforceAccess/startAttempt), волна 3a (TESTING_PLAN §9). CAP_EMAIL — tier='basic',
// сидится в e2e/seed.ts. Кап считает ВСЕ attempt-строки юзера с mode='practice' и
// startedAt в сегодняшнем UTC-окне, ЛЮБОГО статуса (не только submitted) — поэтому
// preloadPracticeStarts вставляет submitted-строки напрямую, без прохода через UI, а
// счётчик перед каждым тестом обнуляется deleteAllAttemptsByEmail (переиспользуемый
// аккаунт, общий с прошлыми прогонами).

test.describe("basic practice daily cap", () => {
  test.beforeEach(() => {
    test.skip(!isStatefulE2eAllowed(loadE2eEnv()), STATEFUL_E2E_BLOCKED_MESSAGE);
  });

  test.afterAll(async () => {
    // Belt-and-braces: следующий прогон (или другой спек, переиспользующий CAP_EMAIL)
    // не должен унаследовать исчерпанный кап. global-setup всё равно не трогает
    // CAP_EMAIL между прогонами (только ensureUser держит tier='basic'), так что без
    // этого cleanup кап оставался бы исчерпанным до следующего deleteAllAttemptsByEmail.
    await deleteAllAttemptsByEmail(CAP_EMAIL);
  });

  test("start is blocked once the daily limit is already used up", async ({ page }) => {
    await deleteAllAttemptsByEmail(CAP_EMAIL);
    await preloadPracticeStarts(CAP_EMAIL, BASIC_PRACTICE_DAILY_LIMIT);

    await loginAs(page, CAP_EMAIL, CAP_PASSWORD);
    await page.goto(`/app/reading/${SEED_ATOMIZED_READING_ID}?mode=practice`);

    // enforceAccess's soft check (access.ts ~193) redirects BEFORE the runner ever
    // renders — no attempt row created for this blocked request.
    //
    // Живой прогон вскрыл гонку: _PracticeCatalog.tsx синхронизирует URL с
    // фильтр-стейтом через history.replaceState на mount (skill/types/cats/sort) и
    // при этом стирает ЛЮБЫЕ прочие query-параметры, включая limit= — за миллисекунды
    // после редиректа querystring может уже пропасть к моменту, когда Playwright
    // опрашивает URL, так что ждать сам querystring (?limit=practice) в waitForURL —
    // флаки-гонка, а не только в повторном ассерте после него. Ждём предикатом
    // по pathname (стабилен, клиент его не переписывает) — сервер-редирект уже
    // доказан самим фактом ухода с /app/reading/...; конкретно limit=practice
    // подтверждает видимый баннер ниже (server-resolved prop, не URL).
    await page.waitForURL((url) => url.pathname === "/app/practice", { timeout: 15_000 });

    // Видимый юзеру сигнал, не только URL — CatalogNotice (src/components/app/
    // CatalogNotice.tsx) рендерит точный текст с числом капа из той же константы.
    // Баннер держится на server-resolved prop из ПЕРВОНАЧАЛЬНОГО searchParams, не
    // на текущем URL — переписанный клиентом querystring его не гасит.
    await expect(
      page.getByText(`That's your ${BASIC_PRACTICE_DAILY_LIMIT} practice starts for today`),
    ).toBeVisible();
  });

  test("one slot under the limit still starts; the boundary then blocks the next start", async ({
    page,
  }) => {
    await deleteAllAttemptsByEmail(CAP_EMAIL);
    // Один слот свободен — контроль границы (доказывает, что блок именно НА границе,
    // не капом-по-умолчанию).
    await preloadPracticeStarts(CAP_EMAIL, BASIC_PRACTICE_DAILY_LIMIT - 1);

    await loginAs(page, CAP_EMAIL, CAP_PASSWORD);
    await page.goto(`/app/reading/${SEED_ATOMIZED_READING_ID}?mode=practice`);

    // Проходит: window-счёт (preloaded) < лимита → startAttempt открывает НОВУЮ
    // in_progress-попытку. Именно этот UI-старт (не ещё один preload) добивает окно
    // до лимита — арифметика: preloaded (limit-1) + этот старт = limit.
    const submitButton = page.getByRole("button", { name: "Submit" });
    await expect(submitButton).toBeVisible({ timeout: 15_000 });

    // Сабмит переводит попытку в submitted — она перестаёт быть "in_progress"
    // (findInProgressAttempt.existing больше не находит её), но продолжает
    // считаться в дневном окне (count() в enforceAccess не фильтрует по статусу).
    // Без этого шага повторный goto ниже просто резюмировал бы ту же попытку
    // (mode=null в enforceAccess — резюм не гейтится капом) вместо честной проверки
    // отказа на НОВОМ старте.
    await submitButton.click();
    await page.waitForURL(
      new RegExp(`/app/reading/${SEED_ATOMIZED_READING_ID}/result(\\?|$)`),
      { timeout: 15_000 },
    );

    // Теперь окно = ровно лимит, in_progress-попытки на этом item нет — следующий
    // заход обязан быть НОВЫМ стартом и упереться в границу.
    await page.goto(`/app/reading/${SEED_ATOMIZED_READING_ID}?mode=practice`);
    // Тот же race, что в первом тесте (client-side history.replaceState в
    // _PracticeCatalog.tsx может стереть querystring до того, как Playwright
    // опросит URL) — ждём по pathname, limit=practice подтверждает баннер ниже.
    await page.waitForURL((url) => url.pathname === "/app/practice", { timeout: 15_000 });
    await expect(
      page.getByText(`That's your ${BASIC_PRACTICE_DAILY_LIMIT} practice starts for today`),
    ).toBeVisible();
  });
});
