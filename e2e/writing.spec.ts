import { test, expect } from "@playwright/test";
import { ensureLoggedIn } from "./auth";
import {
  SEED_WRITING_TASK_ID,
  SMOKE_EMAIL,
  deleteWritingSubmissionsByEmail,
  injectCompletedWritingFeedback,
} from "./seed";
import { isStatefulE2eAllowed, loadE2eEnv, STATEFUL_E2E_BLOCKED_MESSAGE } from "./stateful-gate";

// Writing Lab golden path против hosted тест-стенда (волна 3b, TESTING_PLAN §9):
// store → pending/polling-UI → инъекция готового фидбека В БД → result рендерит band+фидбек.
//
// НИ ОДНОГО реального Gemini-вызова и НИ ОДНОГО запроса на прод: раннер
// (scripts/run-stateful-e2e.ts) держит W/S-фичу ВКЛючённой, но NEXT_PUBLIC_SITE_URL
// указан на неслушаемый loopback-порт — серверный triggerEvaluate-fetch падает
// ECONNREFUSED, submission остаётся pending. Готовый фидбек пишем напрямую в
// writing_feedback (injectCompletedWritingFeedback), зеркаля persistFeedback без модели.
//
// SMOKE_EMAIL = premium (seed.ts) → per-task тир-гейт проходит (seed-задание
// tier_required='premium'), preview-лок не задевается. writing_feedback_debug НЕ трогаем
// (hard-lock; result его не читает).

test.describe("writing store → polling → injected feedback → result", () => {
  test.beforeEach(() => {
    test.skip(!isStatefulE2eAllowed(loadE2eEnv()), STATEFUL_E2E_BLOCKED_MESSAGE);
  });

  test.afterAll(async () => {
    // Не оставляем completed-строку на следующий прогон (история/preview-счётчик).
    await deleteWritingSubmissionsByEmail(SMOKE_EMAIL);
  });

  test("store shows the queue, injected feedback lands the result with band + blocker", async ({
    page,
  }) => {
    // Идемпотентный старт: снести прежние сабмишны smoke-юзера (иначе in-flight остаток
    // упёрся бы в one-active index 0024 → createWritingSubmission вернул бы in_progress).
    await deleteWritingSubmissionsByEmail(SMOKE_EMAIL);

    await ensureLoggedIn(page);
    await page.goto(`/app/writing/attempt/${SEED_WRITING_TASK_ID}`);

    const essay = page.getByRole("textbox", { name: "Your essay" });
    await expect(essay).toBeVisible({ timeout: 15_000 });

    // ≥20 слов (MIN_WORDS) → wordCountState.canSubmit=true → кнопка активна. Контент
    // не важен (эвал не запускается); важно перевалить порог.
    await essay.fill(
      "Modern technology has changed the way people work, study and communicate every single day. " +
        "Some tasks are faster now, yet others feel far more complicated than they used to be. " +
        "This essay weighs both sides before reaching a clear and balanced final position.",
    );

    const submit = page.getByRole("button", { name: "Get my feedback" });
    await expect(submit).toBeEnabled({ timeout: 10_000 });
    await submit.click();

    // Pending/polling-UI виден ДО инъекции — доказывает, что эвал не завершился сам
    // (иначе моментально ушли бы на result). Ждём queue-экран (FlowScreen phase="queued").
    await expect(page.getByText(/in the queue/i)).toBeVisible({ timeout: 15_000 });

    // Инъекция «завершённого эвала»: находит pending-сабмишн smoke-юзера, пишет
    // writing_feedback, флипает статус в completed. Клиентский поллинг (2.5с) подхватит
    // completed → router.push на /result/<id>.
    const submissionId = await injectCompletedWritingFeedback(SMOKE_EMAIL);

    await page.waitForURL(`**/app/writing/result/${submissionId}`, { timeout: 20_000 });

    // Result рендерит инъектированные данные: BandHero-оверлайн (структура band) +
    // mainIssue заведомо-слабейшего критерия (task_response 5.0–5.5) как blockerNote.
    await expect(page.getByText("Estimated band")).toBeVisible({ timeout: 15_000 });
    // Маркер рендерится и как blockerNote (BandHero <p>), и как mainIssue строки
    // CriteriaPlot (<span>) — оба доказывают, что инъектированный фидбек на экране;
    // .first() снимает strict-mode дубль.
    await expect(page.getByText(/E2E_WRITING_BLOCKER/).first()).toBeVisible();
  });
});
