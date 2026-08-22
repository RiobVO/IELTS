import { resolveDbTestTarget } from "./db-target.ts";

/**
 * setupFiles для test:db — выполняется В ВОРКЕРЕ до импорта тест-файла, а значит
 * до импорта `@/db` (тот читает env.DATABASE_URL при загрузке модуля) и `@/env`
 * (fail-fast валидация наличия). САМОЕ ОПАСНОЕ место харнесса: без перехвата
 * DATABASE_URL из .env.local тесты ушли бы в прод.
 *
 *  - DATABASE_URL → VERIFY_DATABASE_URL (throwaway, local-only guard внутри);
 *  - SUPABASE_* / NEXT_PUBLIC_* → фиктивные: env.ts требует наличия, платёжный
 *    путь их не использует, случайный вызов Supabase упадёт громко, а не уйдёт
 *    в реальный проект;
 *  - PostHog/Sentry-ключи удаляются → captureServer/captureError = no-op,
 *    телеметрия из тестов не долетает до реальных проектов;
 *  - merchant-ключи удаляются → stub/real-режим детерминирован per-test
 *    (vi.stubEnv), а не содержимым .env.local.
 */
const url = resolveDbTestTarget();
process.env.DATABASE_URL = url;
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_ANON_KEY = "test-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
delete process.env.NEXT_PUBLIC_SENTRY_DSN;
delete process.env.PAYME_MERCHANT_KEY;
delete process.env.CLICK_SECRET_KEY;
delete process.env.UZUM_SECRET_KEY;
