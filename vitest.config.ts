import { defineConfig } from "vitest/config";

// Только волна 1 — чистая логика, окружение node, без DOM. Тесты co-located
// с модулями (relative import), поэтому alias `@/` здесь НЕ нужен; добавим
// `resolve.alias` отдельно, когда тест парсера реально его потребует (волна 2).
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
