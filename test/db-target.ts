import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { isLocalHost } from "../scripts/migrate.ts";

/**
 * Единственная точка выбора БД для `npm run test:db` (TESTING_PLAN §4, 0a-db).
 * Используется и globalSetup'ом (main-процесс), и setupFiles (воркеры) — у них
 * разные process.env, поэтому dotenv загружается в обоих.
 *
 * Fail-fast, НЕ skip: молчаливый пропуск db-сьюта = «зелёное массовым скипом»
 * (анти-паттерн из §5). test:db — отдельная opt-in команда, чистый `npm test`
 * её не тянет, так что жёсткий отказ никому не мешает.
 *
 * Local-only guard БЕЗУСЛОВНЫЙ, без remote-override (Codex-ревью 0a, blocker):
 * verify.ts держит VERIFY_ALLOW_REMOTE как осознанный разовый рычаг, но test:db
 * — рутинная команда, и залежавшийся `VERIFY_ALLOW_REMOTE=1` в .env.local дал бы
 * DROP SCHEMA public на удалённой БД. Легитимного remote-сценария у test:db нет:
 * CI (волна 1) поднимает PG service-контейнер на localhost.
 */
export function resolveDbTestTarget(): string {
  loadEnv({
    path: join(dirname(fileURLToPath(import.meta.url)), "..", ".env.local"),
  });
  const url = process.env.VERIFY_DATABASE_URL;
  if (!url || url.trim() === "") {
    throw new Error(
      "test:db requires VERIFY_DATABASE_URL (throwaway local Postgres). " +
        "Set it in .env.local — see the verify-gate section of CLAUDE.md.",
    );
  }
  if (!isLocalHost(url)) {
    throw new Error(
      "test:db refuses a non-local database host unconditionally: the harness " +
        "drops/recreates the public schema. Point VERIFY_DATABASE_URL at a " +
        "local throwaway Postgres (there is no remote override for test:db).",
    );
  }
  return url;
}
