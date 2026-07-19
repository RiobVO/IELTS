import { readFileSync } from "node:fs";

/**
 * Прод-ref проекта Supabase (см. .env.local). Пишущие e2e-спеки (signup,
 * smoke) создают реальных юзеров и attempt-строки через service-role — гейт
 * должен отказывать, даже если ALLOW_STATEFUL_E2E=1 выставлен по ошибке
 * поверх прод-конфига (двойная защита: флаг + не-прод БД).
 */
export const PROD_DB_REF = "oyecqbveatkolbqgfczq";

export type E2eEnv = Record<string, string | undefined>;

export const STATEFUL_E2E_BLOCKED_MESSAGE =
  "Stateful e2e blocked: set ALLOW_STATEFUL_E2E=1 and point SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL/DATABASE_URL/DIRECT_URL all at the same non-prod Supabase project";

// Обязательный набор переменных гейта: e2e/admin.ts провижинит юзеров через
// SUPABASE_URL (service-role), а не только через DATABASE_URL/DIRECT_URL —
// раньше только эти две проверялись, и SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL
// оставались дырой (могли смотреть на прод, пока Postgres-урлы были local).
const REQUIRED_VARS = ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "DATABASE_URL", "DIRECT_URL"] as const;

// Ref прод-проекта Supabase — фиксированной длины 20 символов [a-z0-9]
// (см. PROD_DB_REF). Три формата URL несут ref по-разному:
//   - project URL:        https://<ref>.supabase.co
//   - direct connection:  postgres(ql)://...@db.<ref>.supabase.co:5432/...
//   - pooler connection:  postgres(ql)://postgres.<ref>:...@<region>.pooler.supabase.com:.../...
const SUPABASE_PROJECT_HOST_RE = /^([a-z0-9]{20})\.supabase\.co$/;
const SUPABASE_DIRECT_HOST_RE = /^db\.([a-z0-9]{20})\.supabase\.co$/;
const SUPABASE_POOLER_USER_RE = /^postgres\.([a-z0-9]{20})$/;
const SUPABASE_POOLER_HOST_SUFFIX = ".pooler.supabase.com";

// Playwright-процесс не подхватывает .env.local сам (это делает Next.js на
// билде) — читаем вручную, тот же формат/приоритет, что admin.ts.
function loadEnvLocalFile(): Record<string, string> {
  const out: Record<string, string> = {};
  let raw: string;
  try {
    raw = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  } catch {
    return out;
  }
  for (const line of raw.split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/** .env.local смёрженный с process.env (process.env приоритетнее) — то, что реально видят global-setup и спеки. */
export function loadE2eEnv(): E2eEnv {
  return { ...loadEnvLocalFile(), ...process.env };
}

/**
 * Извлекает Supabase project ref из одного из трёх известных форматов URL:
 * project URL (`https://<ref>.supabase.co`), pooler-connection-string
 * (`postgres(ql)://postgres.<ref>:...@<region>.pooler.supabase.com/...`)
 * или direct-connection-string (`...@db.<ref>.supabase.co:5432/...`).
 * Ничего не подошло (localhost, произвольный хост, http:// вместо https:,
 * malformed URL) → null — по контракту гейта это трактуется как блок, а не
 * как "ref не проверяем".
 *
 * Разбор через `new URL()` (не сырой regex по строке) — старая версия искала
 * pooler/direct-паттерны неанкерованным regex по всей строке, включая
 * query/fragment, и позволяла спрятать реальный (trailing-dot/UPPERCASE) хост
 * за рабочим decoy-паттерном где-то в query. Здесь ref для конкретного URL
 * ищется РОВНО по одному месту — hostname (и username для pooler), которое
 * определяет протокол, без фоллбэка на другой формат.
 */
export function supabaseRefFromUrl(url: string | undefined): string | null {
  if (!url) return null;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.protocol === "https:") {
    // Спецсхемы (http/https/...) WHATWG URL лоуркейсит сам; trailing dot в
    // hostname (`...supabase.co.`) сохраняется и корректно отсекается якорем
    // `$` — так и должно резаться decoy-хосты с обфусцированным прод-хостом.
    const match = SUPABASE_PROJECT_HOST_RE.exec(parsed.hostname);
    return match ? match[1] : null;
  }

  if (parsed.protocol === "postgres:" || parsed.protocol === "postgresql:") {
    // Не-спецсхема — hostname НЕ лоуркейсится автоматически, приводим сами.
    const hostname = parsed.hostname.toLowerCase();

    const directMatch = SUPABASE_DIRECT_HOST_RE.exec(hostname);
    if (directMatch) return directMatch[1];

    const isPoolerHost = hostname === "pooler.supabase.com" || hostname.endsWith(SUPABASE_POOLER_HOST_SUFFIX);
    if (!isPoolerHost) return null;

    // Битая percent-последовательность в username роняет decodeURIComponent
    // (URIError) — гейт обязан вернуть блок (null), а не бросить: предикат
    // вычисляется в т.ч. при загрузке playwright.config.ts.
    let username: string;
    try {
      username = decodeURIComponent(parsed.username).toLowerCase();
    } catch {
      return null;
    }
    const poolerMatch = SUPABASE_POOLER_USER_RE.exec(username);
    return poolerMatch ? poolerMatch[1] : null;
  }

  return null;
}

/**
 * Причина, по которой stateful e2e заблокирован, либо null если разрешён.
 * Контракт (волна 2, TESTING_PLAN.md §7 — hard guard; уточнён внешним
 * ревью — находки 1/2):
 *   1. ALLOW_STATEFUL_E2E === "1".
 *   2. SMOKE_BASE_URL не задан (пусто/whitespace-only после trim) — иначе
 *      Playwright переиспользует внешне запущенный app-сервер
 *      (`reuseExistingServer`), который мог стартовать с прод-.env.local, и
 *      гейт не может за него поручиться.
 *   3. Все четыре REQUIRED_VARS заданы (непустые после trim) — admin.ts
 *      берёт SUPABASE_URL (service-role, создание тестовых юзеров),
 *      NEXT_PUBLIC_SUPABASE_URL — browser-side ключ (инлайнится в клиент),
 *      DATABASE_URL/DIRECT_URL — Drizzle/миграции (attempt-строки пишет
 *      приложение через своё DB-подключение).
 *   4. Прод-ref не встречается substring'ом (case-insensitive) ни в одной из
 *      четырёх (belt-and-braces поверх ref-экстракции — ловит и malformed
 *      URL, и UPPERCASE-обфускацию в пароле/query).
 *   5. Из каждой из четырёх извлекается Supabase project ref, и все четыре
 *      равны между собой (localhost/не-Supabase URL ⇒ ref не извлекается ⇒
 *      блок — смешанное окружение localhost-БД + hosted auth некогерентно,
 *      auth-стек всегда hosted, Supabase Local невозможен).
 *   6. Общий ref !== PROD_DB_REF (фактически покрыто п.4, но проверяется
 *      независимо от порядка).
 */
export function statefulE2eBlockReason(env: E2eEnv): string | null {
  if (env.ALLOW_STATEFUL_E2E !== "1") {
    return 'ALLOW_STATEFUL_E2E is not set to "1"';
  }

  if (env.SMOKE_BASE_URL !== undefined && env.SMOKE_BASE_URL.trim() !== "") {
    return "SMOKE_BASE_URL must be unset for stateful e2e (the gate cannot vouch for an externally started app server)";
  }

  for (const name of REQUIRED_VARS) {
    if (!env[name] || env[name]!.trim() === "") {
      return `${name} is not set`;
    }
  }

  for (const name of REQUIRED_VARS) {
    if (env[name]!.toLowerCase().includes(PROD_DB_REF)) {
      return `${name} points at the prod Supabase ref (${PROD_DB_REF})`;
    }
  }

  const refs = REQUIRED_VARS.map((name) => ({ name, ref: supabaseRefFromUrl(env[name]) }));
  for (const { name, ref } of refs) {
    if (!ref) {
      return `${name} does not resolve to a recognized Supabase URL (project/pooler/direct format)`;
    }
  }

  const [first, ...rest] = refs;
  for (const { name, ref } of rest) {
    if (ref !== first.ref) {
      return `Supabase project ref mismatch: ${first.name}=${first.ref} vs ${name}=${ref}`;
    }
  }

  if (first.ref === PROD_DB_REF) {
    return `Supabase project ref ${first.ref} is the prod ref`;
  }

  return null;
}

/**
 * Единый предикат гейта: пишущие e2e-спеки и их провижининг юзеров
 * (global-setup) разрешены ТОЛЬКО когда statefulE2eBlockReason вернул null —
 * см. её докстринг за полным контрактом.
 */
export function isStatefulE2eAllowed(env: E2eEnv): boolean {
  return statefulE2eBlockReason(env) === null;
}
