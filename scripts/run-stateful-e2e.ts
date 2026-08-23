/**
 * Раннер stateful e2e против hosted тест-стенда Supabase (волна 3a,
 * TESTING_PLAN §9). Отличие от `npm run test:e2e`: env для Playwright берётся
 * из `.env.test.local` через loadTestTargetEnv (единственная разрешённая
 * точка входа к тест-стенду — fail-fast на прод-ref), и явно выставляется
 * ALLOW_STATEFUL_E2E=1 — без него e2e/stateful-gate.ts блокирует пишущие
 * спеки. SMOKE_BASE_URL обязан отсутствовать: гейт не может поручиться за
 * внешне запущенный сервер, playwright.config.ts должен поднять свой процесс
 * с уже проверенным окружением (reuseExistingServer:false).
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadTestTargetEnv } from "./lib/test-target-env.ts";

const target = loadTestTargetEnv();
process.env.ALLOW_STATEFUL_E2E = "1";
delete process.env.SMOKE_BASE_URL;

// Прямое подключение (db.<ref>, мимо Supavisor) ВМЕСТО пулеров — только для
// e2e. Оба пулера на длинном линке «локальный dev → eu-central» непригодны:
// transaction (:6543) периодически стопорится посреди протокола
// (Client/ClientRead до 300s; диагностика волны 3a — 11/15 зависонов
// /app/practice против 0 без него), session (:5432) упирается в pool_size=15
// (app-клиент max:10 + HMR-дубль поколения = EMAXCONNSESSION). Прямой хост
// IPv6-only, но без клиентского лимита (max_connections=60). Прод остаётся на
// :6543 — там serverless и один регион, этих патологий нет. Креды у прямого
// подключения те же, что у session-пула (user `postgres` вместо
// `postgres.<ref>`); гейт признаёт db.<ref>-формат и сверит ref.
const pooler = new URL(target.directUrl);
process.env.DATABASE_URL = `postgresql://postgres:${pooler.password}@db.${target.ref}.supabase.co:5432${pooler.pathname || "/postgres"}`;

// Undici-preload во всю цепочку процессов (см. комментарий в самом файле):
// лечит ECONNRESET на протухших keep-alive сокетах fetch'а (supabase-js Auth).
const preloadUrl = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "e2e-undici-resilience.mjs")).href;
process.env.NODE_OPTIONS = [process.env.NODE_OPTIONS, `--import ${preloadUrl}`].filter(Boolean).join(" ");

// Через @playwright/test/cli.js напрямую, а не `npx playwright` — тот же
// приём, что в verify.ts для next: на Windows spawn .cmd-шима требует
// shell:true, а прямой путь к JS-точке входа через process.execPath
// запускается без shell на любой ОС.
const require = createRequire(import.meta.url);
const cliPath = require.resolve("@playwright/test/cli");

const result = spawnSync(process.execPath, [cliPath, "test", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env,
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
