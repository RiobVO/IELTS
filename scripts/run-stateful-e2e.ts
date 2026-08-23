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
import { randomUUID } from "node:crypto";
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

// --- Writing/Speaking env для 3b-спек (детерминизм + анти-утечка на прод) ------
// Дилемма: writingFeatureEnabled()/speakingFeatureEnabled() (src/env.ts) требуют
// ОДНОВРЕМЕННО model+key, internal-secret И publicSiteUrl() — без любого из них
// экраны W/S редиректят на /app/practice. Но triggerEvaluate (store.ts) стреляет
// fetch'ом РОВНО когда есть publicSiteUrl()+secret — те же условия. Значит нельзя
// «включить фичу, но погасить триггер» через null. Триггер выполнится; наша задача —
// чтобы он (а) не долетел до прод-origin и (б) не позвал Gemini, оставив submission
// в pending (что и наблюдают спеки перед инъекцией готового фидбека напрямую в БД).
//
// РАНЬШЕ здесь стоял override NEXT_PUBLIC_SITE_URL на неслушаемый loopback-порт —
// внешнее ревью нашло два бага: порт не гарантированно закрыт (локальный
// сервис/прокси мог принять запрос) И это ОБЩИЙ origin приложения (ломает
// signup-редирект: emailRedirectTo уходил на 127.0.0.1/auth/callback).
//
// Убрать override совсем (наследовать .env.local) не вышло: локальный .env.local
// НЕ содержит NEXT_PUBLIC_SITE_URL вовсе (он живёт только в Vercel — см. CLAUDE.md
// «NEXT_PUBLIC_* must NOT be marked Sensitive»), поэтому publicSiteUrl() был бы null
// и writingFeatureEnabled()/speakingFeatureEnabled() гасили бы всю фичу (проверено:
// без override writing/speaking-спеки редиректило на /app/practice). Вместо этого
// origin указываем на baseURL ЭТОГО ЖЕ прогона — http://localhost:3000
// (playwright.config.ts: SMOKE_BASE_URL удалён строкой выше, поэтому его дефолт
// фиксирован). Это одновременно чинит оба бага ревью: порт РЕАЛЬНО слушает (это наш
// же dev-сервер, не безадресный discard-порт) и origin для signup корректен (ссылка
// подтверждения ведёт на тот же сервер, что тестирует Playwright), а не на мусор.
// Барьер против реального похода на /api/{writing,speaking}/evaluate — НЕ в origin
// (тот теперь валиден), а в scripts/e2e-undici-resilience.mjs: он матчит путь на
// глобальном undici-диспетчере и обрывает запрос синхронно, до DNS/сокета, независимо
// от того, какой origin в fetch — submission гарантированно остаётся pending. Ниже —
// второй, уже избыточный барьер:
//   - фейковый (случайный) GEMINI_API_KEY + модели → даже если бы роут исполнился (он не
//     исполнится, undici-перехватчик не пускает fetch), реального ключа у него нет;
//   - internal-секреты (writing + cron/speaking) → эфемерные случайные, чтобы
//     writingInternalSecret()/speakingInternalSecret() были non-null и фича включилась.
// Секреты генерируем через randomUUID (не хардкодим): их роль — быть непустыми, реальной
// аутентификации они не проходят (роут не запускается). Инвариант «no Gemini / no prod»
// держится на КОДЕ (path-блокировка в преloaде + отсутствующий реальный ключ), не на origin.
const ephemeral = () => `e2e-${randomUUID()}`;
process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
process.env.GEMINI_API_KEY = ephemeral();
process.env.WRITING_EVAL_MODEL = "e2e-fake-model";
process.env.SPEAKING_EVAL_MODEL = "e2e-fake-model";
process.env.WRITING_INTERNAL_SECRET = ephemeral();
process.env.CRON_SECRET = ephemeral();
process.stderr.write(
  "[stateful-e2e] W/S features ENABLED; NEXT_PUBLIC_SITE_URL=http://localhost:3000 (real, own server, " +
    "not a discard port) — eval-trigger fetch is blocked by path in the undici preload regardless of " +
    "origin, Gemini never called (submissions stay pending until DB-injected)\n",
);

// Undici-preload во всю цепочку процессов (см. комментарий в самом файле): лечит
// ECONNRESET на протухших keep-alive сокетах fetch'а (supabase-js Auth) И блокирует
// по пути серверный eval-fetch на /api/{writing,speaking}/evaluate (см. блок выше).
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
