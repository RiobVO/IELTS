import type { Sql } from "postgres";

/**
 * Волна 1.5, пакет B (TESTING_PLAN §6) — декларативный контракт RLS/cross-user
 * постуры. ЕДИНЫЙ источник ожиданий и для живой матрицы (test/db/rls.db.test.ts),
 * и для read-only прод-скрипта (scripts/check-rls-posture.ts).
 *
 * ВАЖНО: ожидания выведены из КОНТРАКТА (SCHEMA_NOTES.md + SQL политик в
 * migrations/), а НЕ из наблюдаемого поведения — иначе тест-тавтология. Любое
 * расхождение факта и этого контракта = находка, не «подгонка ожидания».
 *
 * Категории постуры (по миграциям):
 *  - owner_read       — SELECT своих строк (user_id/id = auth.uid()); запись только
 *                       owner-path (нет клиентского write-гранта/политики).
 *  - owner_read_join  — то же, но владение через родительскую submission (EXISTS-джойн).
 *  - notification     — SELECT своих + UPDATE ТОЛЬКО колонки read_at (0046/0047).
 *  - hard_lock        — REVOKE ALL, ноль политик: клиент физически не достаёт
 *                       (answer_key/snapshot/*_feedback_debug, ядро security).
 */

export type RlsCategory =
  | "owner_read"
  | "owner_read_join"
  | "notification"
  | "hard_lock";

/** Ожидаемая политика: имя + команда + вид qual-предиката (owner|join). */
export interface PolicyExpectation {
  name: string;
  cmd: "SELECT" | "INSERT" | "UPDATE" | "DELETE" | "ALL";
  /** owner: `<ownerColumn> = auth.uid()`; join: подстрока `user_id = auth.uid()`. */
  qualKind: "owner" | "join";
}

/**
 * Инвариант authenticated-грантов, который скрипт обязан проверять НА ПРОДЕ
 * (env-agnostic). Прод отличался от локали Supabase default-priv грантами (готча
 * проекта), но после lockdown-миграций (0047/0048/0056/0057) дрейф снят ВЕЗДЕ,
 * поэтому drift-исключений в контракте больше нет; anon и PUBLIC не
 * параметризуются вовсе — у них безусловно НОЛЬ грантов на каждой таблице
 * (universal-инвариант в checkPosture, рецидив дрейфа = красный).
 *
 *  - "empty"      — у authenticated ноль грантов (hard_lock).
 *  - "selectOnly" — РОВНО SELECT: наличие обязательно (без него ломаются
 *    клиентские Supabase-чтения — ревью-находка «пустые гранты проходили»),
 *    сверх него ничего (+ колоночный UPDATE только по authUpdateCols).
 */
export interface ProdGrantInvariant {
  auth: "empty" | "selectOnly";
}

export interface TableContract {
  table: string;
  category: RlsCategory;
  /** Колонка-владелец uid ("user_id" | "id"); "" для join/hard_lock. */
  ownerColumn: string;
  /** Первичный ключ для пробы по строке ("id" | "attempt_id"). */
  pk: string;
  /** Локальные (drift-free) ТОЧНЫЕ гранты — строгая проверка vitest-постурой. */
  localGrants: { anon: string[]; auth: string[]; authUpdateCols: string[] };
  /** Инвариант, который пинит прод-скрипт (см. ProdGrantInvariant). */
  prodGrant: ProdGrantInvariant;
  /** Точный набор permissive-политик (пусто для hard_lock). */
  policies: PolicyExpectation[];
}

// --- helpers для сокращения повторов ---------------------------------------

const SELECT_ONLY: TableContract["localGrants"] = {
  anon: [],
  auth: ["SELECT"],
  authUpdateCols: [],
};

/** owner_read с REVOKE ALL + GRANT SELECT (0037-класс, прод-проверено 0048). */
function ownerReadStrict(
  table: string,
  policyName: string,
  ownerColumn = "user_id",
): TableContract {
  return {
    table,
    category: "owner_read",
    ownerColumn,
    pk: "id",
    localGrants: SELECT_ONLY,
    prodGrant: { auth: "selectOnly" },
    policies: [{ name: policyName, cmd: "SELECT", qualKind: "owner" }],
  };
}

/** hard-lock: REVOKE ALL, ноль политик (answer_key-класс). */
function hardLock(table: string, pk = "id"): TableContract {
  return {
    table,
    category: "hard_lock",
    ownerColumn: "",
    pk,
    localGrants: { anon: [], auth: [], authUpdateCols: [] },
    prodGrant: { auth: "empty" },
    policies: [],
  };
}

// --- контракт --------------------------------------------------------------

export const RLS_CONTRACT: TableContract[] = [
  // profile — SELECT/INSERT/UPDATE-политики есть (0001), но write-гранты ревокнуты
  // (0010 INSERT/UPDATE, 0056 остальной дрейф вплоть до anon-attributes). После 0056
  // постура строгая: anon пустой, authenticated — только SELECT (политики inert).
  {
    table: "profile",
    category: "owner_read",
    ownerColumn: "id",
    pk: "id",
    localGrants: SELECT_ONLY,
    prodGrant: { auth: "selectOnly" },
    policies: [
      { name: "profile_select_own", cmd: "SELECT", qualKind: "owner" },
      { name: "profile_insert_own", cmd: "INSERT", qualKind: "owner" },
      { name: "profile_update_own", cmd: "UPDATE", qualKind: "owner" },
    ],
  },
  // attempt — как profile: write-lockdown 0010 + полный grant-lockdown 0056.
  {
    table: "attempt",
    category: "owner_read",
    ownerColumn: "user_id",
    pk: "id",
    localGrants: SELECT_ONLY,
    prodGrant: { auth: "selectOnly" },
    policies: [
      { name: "attempt_select_own", cmd: "SELECT", qualKind: "owner" },
      { name: "attempt_insert_own", cmd: "INSERT", qualKind: "owner" },
      { name: "attempt_update_own", cmd: "UPDATE", qualKind: "owner" },
    ],
  },
  // annotation (0013) — SELECT-грант + select_own; прод-дрейф снят 0057 (ревью:
  // «any»-режим был тавтологией, а RLS не покрывает TRUNCATE/REFERENCES/TRIGGER).
  {
    table: "annotation",
    category: "owner_read",
    ownerColumn: "user_id",
    pk: "id",
    localGrants: SELECT_ONLY,
    prodGrant: { auth: "selectOnly" },
    policies: [{ name: "annotation_select_own", cmd: "SELECT", qualKind: "owner" }],
  },
  // payment (0006) — как annotation: клиентский SELECT жив (/app/profile читает
  // историю платежей supabase-клиентом), остальной дрейф снят 0057.
  {
    table: "payment",
    category: "owner_read",
    ownerColumn: "user_id",
    pk: "id",
    localGrants: SELECT_ONLY,
    prodGrant: { auth: "selectOnly" },
    policies: [{ name: "payment_select_own", cmd: "SELECT", qualKind: "owner" }],
  },
  // notification (0001 → 0046 → 0047): SELECT + колоночный UPDATE(read_at), 2 политики.
  {
    table: "notification",
    category: "notification",
    ownerColumn: "user_id",
    pk: "id",
    localGrants: { anon: [], auth: ["SELECT"], authUpdateCols: ["read_at"] },
    prodGrant: { auth: "selectOnly" },
    policies: [
      { name: "notification_select_own", cmd: "SELECT", qualKind: "owner" },
      { name: "notification_update_own", cmd: "UPDATE", qualKind: "owner" },
    ],
  },
  // REVOKE-ALL owner-read когорта (прод-проверена 0048/собственными хардингами).
  ownerReadStrict("writing_submission", "writing_submission_select_own"),
  ownerReadStrict("speaking_submission", "speaking_submission_select_own"),
  ownerReadStrict("speaking_audio_event", "speaking_audio_event_select_own"),
  ownerReadStrict("vocab_progress", "vocab_progress_select_own"),
  ownerReadStrict("saved_word", "saved_word_select_own"),
  ownerReadStrict("mistake_resolution", "mistake_resolution_select_own"),
  ownerReadStrict("mistake_review", "mistake_review_select_own"),
  ownerReadStrict("preorder", "preorder_select_own"),
  // owner_read_join — владение через submission (EXISTS-джойн, как passage→content_item).
  {
    table: "writing_feedback",
    category: "owner_read_join",
    ownerColumn: "",
    pk: "id",
    localGrants: SELECT_ONLY,
    prodGrant: { auth: "selectOnly" },
    policies: [{ name: "writing_feedback_select_own", cmd: "SELECT", qualKind: "join" }],
  },
  {
    table: "speaking_feedback",
    category: "owner_read_join",
    ownerColumn: "",
    pk: "id",
    localGrants: SELECT_ONLY,
    prodGrant: { auth: "selectOnly" },
    policies: [{ name: "speaking_feedback_select_own", cmd: "SELECT", qualKind: "join" }],
  },
  // hard-lock (ядро security): REVOKE ALL, ноль политик — клиент недостижим ЛЮБОЙ операцией.
  hardLock("answer_key"),
  hardLock("attempt_review_snapshot", "attempt_id"),
  hardLock("writing_feedback_debug"),
  hardLock("speaking_feedback_debug"),
];

// ---------------------------------------------------------------------------
// Каталожные пробы (read-only) — общие для vitest-постуры и прод-скрипта.
// ---------------------------------------------------------------------------

export interface CatalogPolicy {
  policyname: string;
  permissive: string;
  cmd: string;
  roles: string[];
  qual: string | null;
  with_check: string | null;
}

export async function relRowSecurity(sql: Sql, table: string): Promise<boolean> {
  const [row] = await sql<{ rls: boolean }[]>`
    SELECT relrowsecurity AS rls FROM pg_class
    WHERE oid = ${`public.${table}`}::regclass`;
  return row?.rls === true;
}

export async function tablePolicies(sql: Sql, table: string): Promise<CatalogPolicy[]> {
  return sql<CatalogPolicy[]>`
    SELECT policyname, permissive, cmd, roles::text[] AS roles, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = ${table}`;
}

export async function tableGrants(
  sql: Sql,
  table: string,
  grantee: string,
): Promise<string[]> {
  const rows = await sql<{ privilege_type: string }[]>`
    SELECT privilege_type FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name = ${table} AND grantee = ${grantee}`;
  return rows.map((r) => r.privilege_type).sort();
}

/**
 * КОЛОНОЧНЫЕ-only привилегии роли — как строки "PRIV:col". column_privileges
 * расширяет табличные гранты в строку на каждую колонку (проверено на локальной
 * БД: табличный SELECT у notification даёт SELECT×все колонки), поэтому честный
 * колоночный грант = privilege_type, которого НЕТ среди табличных грантов роли.
 * Без вычитания ревью-находка «колоночный SELECT/INSERT невидим» не закрывалась
 * бы: раньше смотрелся только UPDATE.
 */
export async function columnOnlyPrivileges(
  sql: Sql,
  table: string,
  grantee: string,
): Promise<string[]> {
  const rows = await sql<{ privilege_type: string; column_name: string }[]>`
    SELECT DISTINCT privilege_type, column_name
    FROM information_schema.column_privileges
    WHERE table_schema = 'public' AND table_name = ${table} AND grantee = ${grantee}
      AND privilege_type NOT IN (
        SELECT privilege_type FROM information_schema.role_table_grants
        WHERE table_schema = 'public' AND table_name = ${table} AND grantee = ${grantee})`;
  return rows.map((r) => `${r.privilege_type}:${r.column_name}`).sort();
}

// ---------------------------------------------------------------------------
// checkPosture — сверка каталогов с контрактом. mode:
//   "local" — строго ТОЧНЫЕ localGrants (нативный PG без drift);
//   "prod"  — ProdGrantInvariant (устойчиво к Supabase default-priv drift).
// Только SELECT из каталогов — строго read-only, безопасно против прода.
// ---------------------------------------------------------------------------

export interface PostureResult {
  table: string;
  ok: boolean;
  problems: string[];
}

function ownerQualRe(ownerColumn: string): RegExp {
  // \b перед именем: "id = auth.uid()" НЕ матчнётся внутри "user_id" (перед "id" стоит "_").
  return new RegExp(`\\b${ownerColumn}\\s*=\\s*auth\\.uid\\(\\)`);
}
const JOIN_QUAL_RE = /user_id\s*=\s*auth\.uid\(\)/;

function eqSet(a: string[], b: string[]): boolean {
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.length === sb.length && sa.every((v, i) => v === sb[i]);
}

export async function checkPosture(
  sql: Sql,
  c: TableContract,
  mode: "local" | "prod",
): Promise<PostureResult> {
  const problems: string[] = [];

  // 1. RLS включён (инвариант в обоих режимах).
  if (!(await relRowSecurity(sql, c.table))) {
    problems.push("RLS выключен (relrowsecurity=false)");
  }

  // 2. Политики.
  const pols = await tablePolicies(sql, c.table);
  const permissive = pols.filter((p) => p.permissive === "PERMISSIVE");

  // 2a. Никакая политика не открывает доступ anon/public (клиентский anon = deny-all).
  const anonExposed = permissive.filter(
    (p) => p.roles.includes("anon") || p.roles.includes("public"),
  );
  if (anonExposed.length > 0) {
    problems.push(
      `anon/public открыт политиками: ${anonExposed.map((p) => p.policyname).join(", ")}`,
    );
  }

  if (c.category === "hard_lock") {
    // 2b. hard-lock: ноль permissive-политик.
    if (permissive.length > 0) {
      problems.push(
        `hard-lock ожидает 0 политик, найдено ${permissive.length}: ${permissive
          .map((p) => p.policyname)
          .join(", ")}`,
      );
    }
  } else {
    // 2c. Набор политик СОВПАДАЕТ с контрактом (имя/cmd/qual/roles) — ни лишних, ни
    // подменённых. Лишняя permissive-политика (напр. USING(true)) = дыра.
    const expectedNames = c.policies.map((p) => p.name).sort();
    const actualNames = permissive.map((p) => p.policyname).sort();
    if (!eqSet(expectedNames, actualNames)) {
      problems.push(
        `набор политик не совпал: ожидались [${expectedNames.join(", ")}], ` +
          `есть [${actualNames.join(", ")}]`,
      );
    }
    for (const exp of c.policies) {
      const got = permissive.find((p) => p.policyname === exp.name);
      if (!got) continue; // уже отражено в mismatch выше
      if (got.cmd !== exp.cmd) {
        problems.push(`${exp.name}: cmd=${got.cmd}, ожидался ${exp.cmd}`);
      }
      if (!got.roles.includes("authenticated")) {
        problems.push(`${exp.name}: roles=${got.roles.join(",")} без authenticated`);
      }
      // qual для SELECT/UPDATE; для INSERT предикат в with_check.
      const expr = exp.cmd === "INSERT" ? got.with_check : got.qual;
      const re = exp.qualKind === "join" ? JOIN_QUAL_RE : ownerQualRe(c.ownerColumn);
      if (!expr || !re.test(expr)) {
        problems.push(
          `${exp.name}: предикат "${expr ?? "null"}" не соответствует ownership (${exp.qualKind})`,
        );
      }
      // Ревью-находка: substring-проверка пропустила бы "user_id = auth.uid() OR
      // true". Полная AST-нормализация хрупка между версиями PG (прод vs локаль),
      // поэтому дешёвый и достаточный guard: ни одна контрактная политика не
      // ожидает дизъюнкции — любое OR в предикате = красный.
      if (expr && /\bor\b/i.test(expr)) {
        problems.push(`${exp.name}: предикат "${expr}" содержит OR — ослабление ownership`);
      }
    }
  }

  // 3. Гранты. UNIVERSAL-инварианты (оба режима): anon и PUBLIC — ноль табличных
  // И ноль колоночных грантов на КАЖДОЙ таблице (после 0047/0048/0056/0057 дрейфа
  // нет нигде; PUBLIC — ревью-находка «права через PUBLIC невидимы»). Membership-
  // производные права осознанно не считаем: anon/authenticated в Supabase ни от
  // кого не наследуют, а машинерия has_table_privilege хрупче пользы.
  const anonG = await tableGrants(sql, c.table, "anon");
  const authG = await tableGrants(sql, c.table, "authenticated");
  const publicG = await tableGrants(sql, c.table, "PUBLIC");
  const anonCols = await columnOnlyPrivileges(sql, c.table, "anon");
  const authColPrivs = await columnOnlyPrivileges(sql, c.table, "authenticated");
  const publicCols = await columnOnlyPrivileges(sql, c.table, "PUBLIC");

  if (anonG.length > 0 || anonCols.length > 0) {
    problems.push(
      `anon обязан быть без грантов, есть [${anonG.join(",")}] cols[${anonCols.join(",")}]`,
    );
  }
  if (publicG.length > 0 || publicCols.length > 0) {
    problems.push(
      `PUBLIC обязан быть без грантов, есть [${publicG.join(",")}] cols[${publicCols.join(",")}]`,
    );
  }

  // authenticated: колоночные-only права строго = UPDATE по authUpdateCols
  // (контрактный read_at у notification), в ОБОИХ режимах.
  const expectedAuthCols = c.localGrants.authUpdateCols.map((col) => `UPDATE:${col}`).sort();
  if (!eqSet(authColPrivs, expectedAuthCols)) {
    problems.push(
      `auth колоночные права=[${authColPrivs.join(",")}], ожидались [${expectedAuthCols.join(",")}]`,
    );
  }

  if (mode === "local") {
    // Строго: точные localGrants (нативный PG без Supabase default-priv drift).
    if (!eqSet(authG, c.localGrants.auth)) {
      problems.push(`auth гранты=[${authG.join(",")}], ожидались [${c.localGrants.auth.join(",")}]`);
    }
  } else {
    switch (c.prodGrant.auth) {
      case "empty":
        if (authG.length > 0) {
          problems.push(`auth обязан быть без грантов, есть [${authG.join(",")}]`);
        }
        break;
      case "selectOnly": {
        // Ревью-находка: «не шире SELECT» без «SELECT обязан быть» пропускал
        // пустые гранты — при них молча ломаются клиентские Supabase-чтения.
        if (!eqSet(authG, ["SELECT"])) {
          problems.push(`auth обязан быть РОВНО [SELECT], есть [${authG.join(",")}]`);
        }
        break;
      }
    }
  }

  return { table: c.table, ok: problems.length === 0, problems };
}
