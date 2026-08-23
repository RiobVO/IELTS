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
 * Инвариант грантов, который скрипт обязан проверять НА ПРОДЕ (env-agnostic).
 * Прод отличается от локали: Supabase раздаёт новым таблицам широкие default-priv
 * гранты (готча проекта), которые локальный нативный PG не воспроизводит. Барьер
 * owner-read держат RLS + отсутствие anon-политики, а НЕ узость грантов — поэтому
 * для drift-когорты гранты на проде не пинятся (иначе флак на известной разнице).
 *
 *  - anon "empty"      — у anon обязан быть НОЛЬ грантов (REVOKE ALL, прод-проверено).
 *  - anon "any"        — гранты anon не пинятся (default-priv drift, held inert RLS'ом).
 *  - auth "empty"      — у authenticated ноль грантов (hard_lock).
 *  - auth "selectOnly" — только SELECT (+ колоночный read_at у notification).
 *  - auth "any"        — гранты не пинятся; барьер — отсутствие write-политики.
 */
export interface ProdGrantInvariant {
  anon: "empty" | "any";
  auth: "empty" | "selectOnly" | "any";
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
  /** annotation/payment: Supabase default-priv drift, барьер — RLS + нет write-политики. */
  knownProdGrantDrift: boolean;
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
    prodGrant: { anon: "empty", auth: "selectOnly" },
    policies: [{ name: policyName, cmd: "SELECT", qualKind: "owner" }],
    knownProdGrantDrift: false,
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
    prodGrant: { anon: "empty", auth: "empty" },
    policies: [],
    knownProdGrantDrift: false,
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
    prodGrant: { anon: "empty", auth: "selectOnly" },
    policies: [
      { name: "profile_select_own", cmd: "SELECT", qualKind: "owner" },
      { name: "profile_insert_own", cmd: "INSERT", qualKind: "owner" },
      { name: "profile_update_own", cmd: "UPDATE", qualKind: "owner" },
    ],
    knownProdGrantDrift: false,
  },
  // attempt — как profile: write-lockdown 0010 + полный grant-lockdown 0056.
  {
    table: "attempt",
    category: "owner_read",
    ownerColumn: "user_id",
    pk: "id",
    localGrants: SELECT_ONLY,
    prodGrant: { anon: "empty", auth: "selectOnly" },
    policies: [
      { name: "attempt_select_own", cmd: "SELECT", qualKind: "owner" },
      { name: "attempt_insert_own", cmd: "INSERT", qualKind: "owner" },
      { name: "attempt_update_own", cmd: "UPDATE", qualKind: "owner" },
    ],
    knownProdGrantDrift: false,
  },
  // annotation (0013) — только SELECT-грант, БЕЗ write-политики и БЕЗ REVOKE ALL.
  // На проде default-priv drift возможен, барьер — нет write-политики → auth:any.
  {
    table: "annotation",
    category: "owner_read",
    ownerColumn: "user_id",
    pk: "id",
    localGrants: SELECT_ONLY,
    prodGrant: { anon: "any", auth: "any" },
    policies: [{ name: "annotation_select_own", cmd: "SELECT", qualKind: "owner" }],
    knownProdGrantDrift: true,
  },
  // payment (0006) — как annotation: GRANT SELECT без REVOKE ALL, нет write-политики.
  // ОТМЕЧЕНО: payment не получил REVOKE-ALL хардинг, которым закрыли siblings (0047/0048).
  {
    table: "payment",
    category: "owner_read",
    ownerColumn: "user_id",
    pk: "id",
    localGrants: SELECT_ONLY,
    prodGrant: { anon: "any", auth: "any" },
    policies: [{ name: "payment_select_own", cmd: "SELECT", qualKind: "owner" }],
    knownProdGrantDrift: true,
  },
  // notification (0001 → 0046 → 0047): SELECT + колоночный UPDATE(read_at), 2 политики.
  {
    table: "notification",
    category: "notification",
    ownerColumn: "user_id",
    pk: "id",
    localGrants: { anon: [], auth: ["SELECT"], authUpdateCols: ["read_at"] },
    prodGrant: { anon: "empty", auth: "selectOnly" },
    policies: [
      { name: "notification_select_own", cmd: "SELECT", qualKind: "owner" },
      { name: "notification_update_own", cmd: "UPDATE", qualKind: "owner" },
    ],
    knownProdGrantDrift: false,
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
    prodGrant: { anon: "empty", auth: "selectOnly" },
    policies: [{ name: "writing_feedback_select_own", cmd: "SELECT", qualKind: "join" }],
    knownProdGrantDrift: false,
  },
  {
    table: "speaking_feedback",
    category: "owner_read_join",
    ownerColumn: "",
    pk: "id",
    localGrants: SELECT_ONLY,
    prodGrant: { anon: "empty", auth: "selectOnly" },
    policies: [{ name: "speaking_feedback_select_own", cmd: "SELECT", qualKind: "join" }],
    knownProdGrantDrift: false,
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

/** Колонки, на которые у роли есть колоночный UPDATE (без табличного UPDATE-гранта). */
export async function updateColumns(
  sql: Sql,
  table: string,
  grantee: string,
): Promise<string[]> {
  const rows = await sql<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.column_privileges
    WHERE table_schema = 'public' AND table_name = ${table}
      AND grantee = ${grantee} AND privilege_type = 'UPDATE'`;
  return rows.map((r) => r.column_name).sort();
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
  notes: string[];
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

const WRITE_GRANTS = ["INSERT", "UPDATE", "DELETE"];

export async function checkPosture(
  sql: Sql,
  c: TableContract,
  mode: "local" | "prod",
): Promise<PostureResult> {
  const problems: string[] = [];
  const notes: string[] = [];

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
    }
  }

  // 3. Гранты.
  const anonG = await tableGrants(sql, c.table, "anon");
  const authG = await tableGrants(sql, c.table, "authenticated");
  const authCols = await updateColumns(sql, c.table, "authenticated");

  if (mode === "local") {
    // Строго: точные localGrants (нативный PG без Supabase default-priv drift).
    if (!eqSet(anonG, c.localGrants.anon)) {
      problems.push(`anon гранты=[${anonG.join(",")}], ожидались [${c.localGrants.anon.join(",")}]`);
    }
    if (!eqSet(authG, c.localGrants.auth)) {
      problems.push(`auth гранты=[${authG.join(",")}], ожидались [${c.localGrants.auth.join(",")}]`);
    }
    if (!eqSet(authCols, c.localGrants.authUpdateCols)) {
      problems.push(
        `auth UPDATE-колонки=[${authCols.join(",")}], ожидались [${c.localGrants.authUpdateCols.join(",")}]`,
      );
    }
  } else {
    // Прод: ProdGrantInvariant — устойчиво к default-priv drift.
    if (c.prodGrant.anon === "empty" && anonG.length > 0) {
      problems.push(`anon обязан быть без грантов, есть [${anonG.join(",")}]`);
    }
    switch (c.prodGrant.auth) {
      case "empty":
        if (authG.length > 0 || authCols.length > 0) {
          problems.push(`auth обязан быть без грантов, есть [${authG.join(",")}] cols[${authCols.join(",")}]`);
        }
        break;
      case "selectOnly": {
        const extraTable = authG.filter((g) => g !== "SELECT");
        const extraCols = authCols.filter((col) => !c.localGrants.authUpdateCols.includes(col));
        if (extraTable.length > 0 || extraCols.length > 0) {
          problems.push(
            `auth шире SELECT-only: табличные лишние [${extraTable.join(",")}], колоночные лишние [${extraCols.join(",")}]`,
          );
        }
        break;
      }
      case "any":
        if (anonG.length > 0 || authG.length > WRITE_GRANTS.length) {
          notes.push(
            `drift-когорта: гранты не пинятся (anon=[${anonG.join(",")}], auth=[${authG.join(",")}]); барьер — RLS + нет write-политики`,
          );
        }
        break;
    }
  }

  return { table: c.table, ok: problems.length === 0, problems, notes };
}
