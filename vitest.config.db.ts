import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// 0a-db: интеграционные тесты платёжных инвариантов на THROWAWAY нативном PG
// (TESTING_PLAN §4). Отдельный конфиг: `npm test` (vitest.config.ts) обязан
// остаться чисто-логическим без БД — include смотрит ТОЛЬКО в test/db/, который
// default-прогон не тянет. Запуск: `npm run test:db`; цель БД и guard'ы —
// test/db-target.ts, env-перехват — test/db-setup.ts (ДО импорта @/db).
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/db/**/*.test.ts"],
    // Одна общая БД: параллельные воркеры дрались бы за TRUNCATE между тестами.
    fileParallelism: false,
    globalSetup: ["./test/db-global-setup.ts"],
    setupFiles: ["./test/db-setup.ts"],
    // Конкурентные транзакции + полный migrateUp на чистой схеме.
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(
        new URL("./test/server-only-stub.ts", import.meta.url),
      ),
    },
  },
});
