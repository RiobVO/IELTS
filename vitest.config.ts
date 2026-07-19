import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Чистая логика, окружение node, без DOM. Тесты co-located с модулями. Большинство
// импортируют relative, но writing-слой использует alias `@/` (`@/env`,
// `@/lib/writing/...`) — резолвим его здесь, иначе `vi.mock("@/env")` и бенчмарк
// не найдут модули. `scripts/*.test.ts` включён ради офлайн-бенчмарка writing-слоя;
// `app/**` — co-located тесты server-роутов/действий Writing Lab (evaluate route,
// create/poll actions), которые обязаны жить в app/ (Next.js routing); `e2e/**` —
// чистый предикат stateful-e2e гейта (e2e/stateful-gate.ts), тестируем без Playwright.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts", "app/**/*.test.ts", "e2e/**/*.test.ts"],
    // Coverage — ВИДИМОСТЬ, не гейт (TESTING_PLAN §5): thresholds намеренно нет.
    // include обязателен: без него vitest считает только импортированные файлы и
    // рисует ложную полноту. Включается флагом --coverage (CI); npm test не тянет.
    coverage: {
      provider: "v8",
      include: ["src/**", "app/**"],
      exclude: ["**/*.test.ts", "**/*.test.tsx", "**/*.d.ts"],
      reporter: ["text-summary"],
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` (Next.js RSC guard) has no plain-node build, so vitest can't resolve
      // it; stub it to a no-op (matches server semantics) so modules importing it are testable.
      "server-only": fileURLToPath(new URL("./test/server-only-stub.ts", import.meta.url)),
    },
  },
});
