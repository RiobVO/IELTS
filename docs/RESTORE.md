# Restore drill — репетиция восстановления прод-бэкапа

Единственный бэкап прод-БД (Supabase Free) — ежедневный `pg_dump` через
`.github/workflows/db-backup.yml`: `pg_dump --no-owner --no-privileges | gzip`,
plain-SQL артефакт `db-backup-YYYYMMDD-HHMMSS.sql.gz`, retention 30 дней, cron
`17 2 * * *` (02:17 UTC). Эта репетиция раз в квартал доказывает, что из
артефакта реально поднимается рабочая БД.

## Prerequisites

- PostgreSQL client 18.x — `C:\Program Files\PostgreSQL\18\bin\psql.exe`
  (нативный PG на `localhost:5432`; Docker для этого не нужен).
- `gh` CLI, авторизован в репозитории.
- `.env.local` с `VERIFY_DATABASE_URL` (локальный throwaway PG; пароль оттуда же
  идёт в `PGPASSWORD`). Ключи/пароли из репозитория не берём.
- БД восстанавливаем в throwaway `ielts_restore_test` — НЕ в `ielts_verify`
  (её занимает verify-гейт) и НЕ в Supabase.

## Шаги

1. Скачать артефакт последнего УСПЕШНОГО рана:
   `gh run list --workflow=db-backup.yml --status success -L 5`, взять верхний,
   `gh run download <id> -D <scratchdir>`. Из метаданных рана взять `createdAt`
   (дата бэкапа) — она же аргумент валидатора. Если артефакт старше 48ч —
   зафиксировать находку (workflow, возможно, падает), но репетицию продолжить.
2. Пересоздать БД: `DROP DATABASE IF EXISTS ielts_restore_test WITH (FORCE);`
   `CREATE DATABASE ielts_restore_test;` (psql к базе `postgres`).
3. Прогнать `scripts/bootstrap-supabase-local.sql` в `ielts_restore_test`
   (роли anon/authenticated/service_role, схема auth, auth.uid, стаб auth.users).
   Локально-безопасно; НИКОГДА не гнать против Supabase.
4. Restore: `gunzip -c <dump>.sql.gz > dump.sql` → `psql -f dump.sql`
   **без** `ON_ERROR_STOP` (ошибки ролей/auth/extensions ожидаемы), stderr в лог.
5. Валидировать: `npx tsx scripts/_restore-drill.ts <createdAt>` — печатает
   `[OK]`/`[FAIL]`, exit 0 при полном успехе. Скрипт standalone (см. Appendix
   ниже — полный исходник), проверяет: 34 таблицы public
   (фильтр `!~ '^_'`), row count > 0 для profile/attempt/answer_key/content_item,
   freshness: новейшая строка не старше 30 дней от даты бэкапа.
6. Cleanup (ОБЯЗАТЕЛЬНО — в дампе прод-PII): `DROP DATABASE ielts_restore_test`,
   удалить `.sql.gz`, `dump.sql`, лог ошибок и `scripts/_restore-drill.ts`.

## Ожидаемый вывод валидатора

    [OK] public table count — 34 (expected 34)
    [OK] row count — profile has N row(s)
    [OK] row count — attempt has N row(s)
    [OK] row count — answer_key has N row(s)
    [OK] row count — content_item has N row(s)
    [OK] freshness — newest row <ISO> is <X.X>d before backup (<= 30d)
    exit 0

## Ожидаемые (игнорируемые) ошибки restore

`schema "auth" already exists`; `role "…" already exists`; `CREATE EXTENSION`
для supabase-расширений; провал FK `profile → auth.users` (стаб auth.users пуст).
Стаб `auth.users` минимален (не полная Supabase-схема) — из-за этого `COPY`
реальных строк `auth.users`/`auth.webauthn_challenges`/`vault.secrets` тоже
падает (несовпадение колонок), а следом за упавшим `COPY` psql в restricted-
режиме (pg_dump 17 оборачивает дамп в `\restrict`/`\unrestrict`) сыплет
`backslash commands are restricted` на каждую строку данных до `\.` — тоже
ожидаемо, схема `auth`/`vault`, не `public`.
Подозрительно и требует разбора: любая ошибка `COPY`/`CREATE TABLE` для таблицы
из `public`.

## Журнал

- 2026-07-08 — first drill: exposed 5 days of empty backups (pg_dump 16 vs server 17, silent pipe); fixed in ae913bd, drill re-run green.
- Last successful drill: 2026-07-08
- Рекомендуемая периодичность: **раз в квартал** и после любой правки
  `db-backup.yml` или схемы миграций.

## Appendix: scripts/_restore-drill.ts

Скрипт после каждой репетиции удаляется (прод-PII гигиена), поэтому его
исходник хранится здесь — этот runbook самодостаточен.

```ts
/**
 * Repetition-drill: валидация восстановленного прод-бэкапа в throwaway-БД
 * `ielts_restore_test`. Standalone — НЕ импортирует модули приложения
 * (src/env.ts валидирует env при загрузке, server-only ломает tsx). Ходит в БД
 * пакетом `postgres` напрямую, беря креды из VERIFY_DATABASE_URL и подменяя имя БД.
 *
 * Запуск:  npx tsx scripts/_restore-drill.ts <backup-date-ISO>
 *   напр.  npx tsx scripts/_restore-drill.ts 2026-07-08T02:17:00Z
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import postgres from "postgres";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
loadEnv({ path: join(ROOT, ".env.local") });

const backupArg = process.argv[2];
if (!backupArg) {
  console.error("Usage: npx tsx scripts/_restore-drill.ts <backup-date-ISO>");
  process.exit(1);
}
const backupDate = new Date(backupArg);
if (Number.isNaN(backupDate.getTime())) {
  console.error(`Invalid backup date: ${backupArg}`);
  process.exit(1);
}

const verifyUrl = process.env.VERIFY_DATABASE_URL;
if (!verifyUrl) {
  console.error("VERIFY_DATABASE_URL missing in .env.local — cannot derive the restore-target connection.");
  process.exit(1);
}
const target = new URL(verifyUrl);
target.pathname = "/ielts_restore_test";
if (!["localhost", "127.0.0.1", "::1"].includes(target.hostname)) {
  // Скрипт читает данные и не мутирует, но всё равно держим его строго локальным.
  console.error(`Refusing to run against a non-local host: ${target.hostname}`);
  process.exit(1);
}

// Совпадает с verify.ts APP_TABLE_COUNT: public BASE TABLE без `_`-префикса
// (исключает _migrations). Включает легаси `topic` (schema.ts типизирует 33; +topic = 34).
const EXPECTED_TABLE_COUNT = 34;

// Новейшая строка не старше 30 дней ОТ ДАТЫ БЭКАПА: тихий период не даёт ложный
// FAIL, протухший/замороженный дамп ловится.
const FRESHNESS_MAX_AGE_DAYS = 30;

const sql = postgres(target.toString(), { max: 1, onnotice: () => {} });

let failures = 0;
const ok = (m: string) => console.log(`[OK] ${m}`);
const fail = (m: string) => {
  console.log(`[FAIL] ${m}`);
  failures++;
};

async function main() {
  // (1) число таблиц public — тем же запросом, что verify.ts
  const [{ n }] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND table_name !~ '^_'`;
  if (n === EXPECTED_TABLE_COUNT)
    ok(`public table count — ${n} (expected ${EXPECTED_TABLE_COUNT})`);
  else
    fail(`public table count — expected ${EXPECTED_TABLE_COUNT}, found ${n} (excl. _migrations; incl. legacy topic)`);

  // (2) ключевые таблицы не пусты
  for (const t of ["profile", "attempt", "answer_key", "content_item"] as const) {
    const [{ c }] = await sql<{ c: number }[]>`
      SELECT count(*)::int AS c FROM ${sql(t)}`;
    if (c > 0) ok(`row count — ${t} has ${c} row(s)`);
    else fail(`row count — ${t} is EMPTY (restore likely lost data)`);
  }

  // (3) freshness: attempt НЕ имеет created_at → started_at. GREATEST игнорит NULL.
  const [{ newest }] = await sql<{ newest: Date | null }[]>`
    SELECT GREATEST(
      (SELECT max(started_at) FROM attempt),
      (SELECT max(created_at) FROM profile),
      (SELECT max(created_at) FROM notification)
    ) AS newest`;
  if (!newest) {
    fail("freshness — no timestamp in attempt/profile/notification (empty DB?)");
  } else {
    const ageDays = (backupDate.getTime() - newest.getTime()) / 86_400_000;
    if (ageDays <= FRESHNESS_MAX_AGE_DAYS)
      ok(`freshness — newest row ${newest.toISOString()} is ${ageDays.toFixed(1)}d before backup (<= ${FRESHNESS_MAX_AGE_DAYS}d)`);
    else
      fail(`freshness — newest row ${newest.toISOString()} is ${ageDays.toFixed(1)}d before backup (> ${FRESHNESS_MAX_AGE_DAYS}d): stale/frozen dump?`);
    if (ageDays < -2)
      console.log(`[note] newest row is ${(-ageDays).toFixed(1)}d AFTER the backup date — check the <backup-date-ISO> argument.`);
  }
}

main()
  .then(async () => {
    await sql.end({ timeout: 5 });
    if (failures === 0) {
      console.log("exit 0");
      process.exit(0);
    }
    console.log(`exit 1 (${failures} check[s] failed)`);
    process.exit(1);
  })
  .catch(async (e) => {
    console.error("\ndrill crashed:", e);
    try {
      await sql.end({ timeout: 5 });
    } catch {
      // соединение уже закрыто
    }
    process.exit(2);
  });
```
