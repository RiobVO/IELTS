import { defineConfig, devices } from "@playwright/test";

// Смоук гоняем против локального dev-сервера — он использует ТУ ЖЕ боевую
// Supabase/Postgres, что и прод (изолированного test-окружения нет, см.
// docs/RESTORE.md соседей по духу). webServer поднимает `npm run dev` сам,
// если целевой URL ещё не отвечает — повторный прогон не плодит второй сервер.
const baseURL = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false, // тесты используют один и тот же тестовый аккаунт — без гонки
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.SMOKE_BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        url: baseURL,
        reuseExistingServer: true,
        timeout: 60_000,
      },
});
