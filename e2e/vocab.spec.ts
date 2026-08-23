import { test, expect } from "@playwright/test";
import { ensureLoggedIn } from "./auth";
import {
  deleteAllSavedWordsForSmoke,
  SEED_VOCAB_DECK_TITLE,
  seedSavedWordForSmoke,
  seedVocabDueForSmoke,
} from "./seed";
import { isStatefulE2eAllowed, loadE2eEnv, STATEFUL_E2E_BLOCKED_MESSAGE } from "./stateful-gate";

// Vocabulary review-session + saved words против hosted тест-стенда (волна 3b,
// TESTING_PLAN §9). Дек/карты сидятся идемпотентно в global-setup (e2e/seed.ts
// seedVocabDeck); «due сейчас» и saved_word — здесь, в самом тесте, через
// seedVocabDueForSmoke/seedSavedWordForSmoke (те же по духу, что preloadPracticeStarts
// в cap.spec.ts — состояние, зависящее от «сейчас», пересобирается перед КАЖДЫМ
// прогоном, а не один раз в global-setup). SMOKE_EMAIL — premium (см. seed.ts
// ensureUser), поэтому дневной лимит новых карт (VOCAB_DAILY_NEW_LIMIT, только для
// basic) сюда не задет.

test.describe("vocabulary review + saved words", () => {
  test.beforeEach(() => {
    test.skip(!isStatefulE2eAllowed(loadE2eEnv()), STATEFUL_E2E_BLOCKED_MESSAGE);
  });

  test.afterAll(async () => {
    // Не оставляем "1 saved" на следующий прогон/сторонний спек, использующий того же
    // переиспользуемого smoke-юзера (внешнее ревью: глобальный счётчик хрупок к остаткам).
    await deleteAllSavedWordsForSmoke();
  });

  test("due cards are reviewed through the deck session; saved word shows in My words", async ({ page }) => {
    await seedVocabDueForSmoke(3);
    await seedSavedWordForSmoke();

    await ensureLoggedIn(page);
    await page.goto("/app/vocabulary");

    // Дек-карточка (DeckCard, /app/vocabulary/page.tsx) несёт бейдж "N to review",
    // когда dueCount > 0 (см. deck.dueCount > 0 ветку в DeckCard).
    const deckCard = page.locator(".vc-card", { hasText: SEED_VOCAB_DECK_TITLE });
    await expect(deckCard).toBeVisible({ timeout: 15_000 });
    await expect(deckCard.getByText("3 to review")).toBeVisible();

    // SavedWordsCard — счётчик личного словаря на той же странице.
    await expect(page.getByText(/1 saved.*1 due/)).toBeVisible();

    // Footer-ссылка "Review" (не "Browse") ведёт в /app/vocabulary/[deckId].
    await deckCard.getByRole("link", { name: "Review", exact: true }).click();
    await page.waitForURL(/\/app\/vocabulary\/[0-9a-f-]{36}(\?|$)/, { timeout: 15_000 });

    // ReviewSession (ReviewSession.tsx): headStats несёт "N due" из серверного dueCount.
    await expect(page.getByText("3 due")).toBeVisible();

    // Flashcards — дефолтный режим: флип "Show answer" → грейд "Good" на каждой из
    // 3 due-карт. Again/Easy здесь не нужны — карты не новые (seedVocabDueForSmoke
    // ставит lastReviewedAt в прошлом), детерминированный путь "все верно с первого раза".
    for (let i = 0; i < 3; i++) {
      await page.getByRole("button", { name: "Show answer" }).click();
      await page.getByRole("button", { name: "Good" }).click();
    }

    // Итоговый экран сессии (finished === true в ReviewSession).
    await expect(page.getByText("Session complete")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/You reviewed 3 cards/)).toBeVisible();

    // "My words" (P11) — сохранённое слово видно в списке со своим контекстом.
    // exact:true — getByText делает case-insensitive substring match по умолчанию,
    // и "PERSEVERANCE" иначе матчит и слово-заголовок, и context-строку ниже (там же
    // "perseverance" строчными) — strict-mode violation.
    await page.goto("/app/vocabulary/my-words");
    await expect(page.getByText("PERSEVERANCE", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByText("Success on this exam requires perseverance and daily practice."),
    ).toBeVisible();
  });
});
