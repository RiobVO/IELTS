import { defineConfig, devices } from "@playwright/test";
import { isStatefulE2eAllowed, loadE2eEnv } from "./e2e/stateful-gate";

// Смоук гоняем против локального dev-сервера — он использует ТУ ЖЕ боевую
// Supabase/Postgres, что и прод (изолированного test-окружения нет, см.
// docs/RESTORE.md соседей по духу). webServer поднимает `npm run dev` сам,
// если целевой URL ещё не отвечает — повторный прогон не плодит второй сервер.
const baseURL = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  // В e2e/ лежит и vitest-файл (stateful-gate.test.ts) — Playwright по умолчанию
  // собирает *.test.ts тоже и падает на vi.mock. Playwright-сьют = только *.spec.ts.
  testMatch: "**/*.spec.ts",
  globalSetup: "./e2e/global-setup.ts",
  // 60с, не 30: сьют бегает против dev-сервера (пер-прогон cold compile) с
  // hosted тест-БД в eu-central — хвост латентности стриминга RSC-каталога
  // стабильно пробивал 30с в самом тяжёлом тесте (login+каталог+экзамен+submit).
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // Тесты делят один smoke-аккаунт: fullyParallel:false выключает параллель ВНУТРИ
  // файла, но раздельные spec-файлы Playwright гонит отдельными воркерами — два
  // одновременных логина одним аккаунтом ловят login-throttle (fail-closed ветка
  // конкурентного лока). workers:1 сериализует и файлы тоже.
  fullyParallel: false,
  workers: 1,
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
        // Для stateful-прогона (ALLOW_STATEFUL_E2E=1 + проверенная четвёрка env)
        // переиспользованный сервер мог стартовать с прод-.env.local —
        // Playwright обязан поднять свой процесс с проверенным окружением;
        // для read-only смоука поведение прежнее (переиспользуем dev-сервер).
        reuseExistingServer: !isStatefulE2eAllowed(loadE2eEnv()),
        timeout: 60_000,
      },
});
