import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Чистая логика, окружение node, без DOM. Тесты co-located с модулями. Большинство
// импортируют relative, но writing-слой использует alias `@/` (`@/env`,
// `@/lib/writing/...`) — резолвим его здесь, иначе `vi.mock("@/env")` и бенчмарк
// не найдут модули. `scripts/*.test.ts` включён ради офлайн-бенчмарка writing-слоя.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
