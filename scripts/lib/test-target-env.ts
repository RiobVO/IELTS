/**
 * loadTestTargetEnv — единственная безопасная точка входа к hosted тест-стенду
 * Supabase (волна 2, TESTING_PLAN §7). Грузит `.env.test.local` в process.env
 * (override:true — перекрывает любые ранее выставленные прод-значения) и
 * FAIL-FAST'ит, если конфиг хоть чем-то смотрит на прод.
 *
 * Зачем строгий guard: `migrate-test.ts`/`rls-posture-test.ts` пишут/читают
 * реальную БД по DIRECT_URL. Один прод-ref в любой из переменных = удар по
 * боевой базе (ср. инцидент db:down, стёрший прод). Контракт зеркалит
 * e2e/stateful-gate.ts: PROD_DB_REF не встречается substring'ом ни в одной
 * переменной, все резолвятся в ОДИН и тот же не-прод Supabase ref.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { PROD_DB_REF, supabaseRefFromUrl } from "../../e2e/stateful-gate.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = join(HERE, "..", "..", ".env.test.local");

// Все URL-переменные, которые обязаны указывать на тест-ref. SUPABASE_URL нужен
// service-role клиенту (создание юзеров A/B), NEXT_PUBLIC_* — supabase-js на
// стороне anon/authenticated, DATABASE_URL/DIRECT_URL — Drizzle/миграции.
const REF_VARS = ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "DATABASE_URL", "DIRECT_URL"] as const;

// Полный набор, который обязан присутствовать именно в .env.test.local (URL +
// ключи). Ключи не резолвятся в ref, но унаследованный из shell чужой ключ дал
// бы ложные результаты — поэтому требуем их наличия в файле (Codex Low #1).
const ALL_REQUIRED_VARS = [...REF_VARS, "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"] as const;

export interface TestTargetEnv {
  ref: string;
  supabaseUrl: string;
  anonKey: string;
  serviceRoleKey: string;
  databaseUrl: string;
  directUrl: string;
}

export function loadTestTargetEnv(): TestTargetEnv {
  try {
    readFileSync(ENV_PATH);
  } catch {
    throw new Error(
      `.env.test.local не найден (${ENV_PATH}). Заполни его по .env.example — ` +
        `ключи и pooler-строки тест-проекта Supabase.`,
    );
  }
  const parsed = loadEnv({ path: ENV_PATH, override: true });
  if (parsed.error) throw parsed.error;
  const fromFile = parsed.parsed ?? {};

  // 0. Все нужные переменные обязаны быть ЗАДАНЫ В ФАЙЛЕ, не унаследованы из
  //    shell process.env (Codex Low #1). dotenv override:true перекрывает лишь
  //    присутствующие в файле ключи — отсутствующий, но живущий в shell URL/ключ
  //    мог бы молча увести раннер в чужой (пусть и не-прод) проект. Читаем
  //    parsed.parsed (ровно содержимое файла), а не итоговый process.env.
  for (const name of ALL_REQUIRED_VARS) {
    const v = fromFile[name];
    if (!v || v.trim() === "") {
      throw new Error(
        `${name} не задан В .env.test.local (унаследованные из shell значения ` +
          `не принимаются — таргет обязан быть полностью определён файлом).`,
      );
    }
  }

  // 1. Прод-ref запрещён substring'ом (case-insensitive) в любой URL-переменной —
  //    belt-and-braces поверх ref-экстракции: ловит и malformed URL.
  for (const name of REF_VARS) {
    const v = process.env[name];
    if (!v || v.trim() === "") {
      throw new Error(`${name} не задан в .env.test.local`);
    }
    if (v.toLowerCase().includes(PROD_DB_REF)) {
      throw new Error(
        `${name} несёт прод-ref (${PROD_DB_REF}) — отказ. .env.test.local обязан ` +
          `смотреть ТОЛЬКО на тест-проект.`,
      );
    }
  }

  // 2. Все четыре резолвятся в один и тот же ref, и он не прод. Бросаем прямо
  //    в map — тогда refs.ref сужается до string (не string|null) для сравнений.
  const refs = REF_VARS.map((name) => {
    const ref = supabaseRefFromUrl(process.env[name]);
    if (!ref) {
      throw new Error(
        `${name} не резолвится в Supabase ref (ожидаю project/pooler/direct формат).`,
      );
    }
    return { name, ref };
  });
  const [first, ...rest] = refs;
  for (const { name, ref } of rest) {
    if (ref !== first.ref) {
      throw new Error(
        `Ref mismatch: ${first.name}=${first.ref} vs ${name}=${ref}. Все переменные ` +
          `обязаны смотреть на один тест-проект.`,
      );
    }
  }
  if (first.ref === PROD_DB_REF) {
    throw new Error(`Резолвленный ref ${first.ref} — прод. Отказ.`);
  }

  const need = (n: string): string => {
    const v = process.env[n];
    if (!v || v.trim() === "") throw new Error(`${n} не задан в .env.test.local`);
    return v;
  };
  return {
    ref: first.ref,
    supabaseUrl: need("SUPABASE_URL"),
    anonKey: need("SUPABASE_ANON_KEY"),
    serviceRoleKey: need("SUPABASE_SERVICE_ROLE_KEY"),
    databaseUrl: need("DATABASE_URL"),
    directUrl: need("DIRECT_URL"),
  };
}
