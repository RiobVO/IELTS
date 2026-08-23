/**
 * КАНОН Storage-провижининга (волна 2, TESTING_PLAN §7) — единственный источник
 * истины для бакетов `speaking-audio` и `source-html` и их storage.objects-политик.
 *
 * Зачем модуль: раньше SQL бакета+политики дублировался в setup-speaking-storage.ts
 * (прод) и в storage-contract-test.ts (self-heal). Дубль означал, что контракт-тест
 * доказывал корректность политики, которую сам только что и поставил (ложно-зелёный
 * класс: сломанный прод-провижининг тест «чинил» и проходил). Теперь:
 *   - applyStorageProvisioning() — единственный путь SETUP (прод + тест-стенд);
 *   - verifyStorageProvisioning() — READ-ONLY сверка с каноном, НЕ чинит.
 *
 * Storage живёт в схеме `storage` реального Supabase (локальный docker её не
 * эмулирует) — оба вызова идут по DIRECT_URL/directUrl, а не через verify-гейт.
 */
import type { Sql } from "postgres";

/** Декларативная спека бакета + (опц.) owner-scoped политики на storage.objects. */
export interface StorageBucketSpec {
  id: string;
  /** Приватный бакет — public=false (публичного URL нет). */
  public: boolean;
  /** Байтовый кап; null = без лимита (source-html). */
  fileSizeLimit: number | null;
  /** Разрешённые MIME; null = без ограничения (source-html). */
  allowedMimeTypes: string[] | null;
  /**
   * Owner-scoped политика на storage.objects (только speaking-audio). null =
   * бакет без клиентской политики: доступ лишь service-role, RLS default-deny
   * для anon/authenticated (source-html).
   */
  ownerPolicy: {
    name: string;
    /** Каноническая CREATE POLICY — единственная формулировка семантики owner-доступа. */
    createSql: string;
    /**
     * Ожидаемый qual/with_check РОВНО как их нормализует и отдаёт PG (pg_policies).
     * verify сравнивает нормализованный факт с этим ТОЧНО (не по подстрокам) —
     * иначе семантически ослабленный предикат (напр. `... OR bucket_id=...`)
     * прошёл бы подстрочную проверку незамеченным (Codex P1 #1).
     */
    expectedPredicate: string;
  } | null;
}

// --- КАНОН -----------------------------------------------------------------

export const STORAGE_BUCKETS: StorageBucketSpec[] = [
  {
    // Приватный, 10 MB, только форматы MediaRecorder. Owner-scoped: юзер читает/
    // пишет ТОЛЬКО объекты под своим uid-префиксом (path = `${uid}/...`);
    // evaluate скачивает через service-role (обходит RLS); anon без политики.
    id: "speaking-audio",
    public: false,
    fileSizeLimit: 10485760,
    allowedMimeTypes: ["audio/webm", "audio/mp4"],
    ownerPolicy: {
      name: "speaking_audio_owner_all",
      createSql: `create policy speaking_audio_owner_all on storage.objects
        for all to authenticated
        using (bucket_id = 'speaking-audio'
               and (storage.foldername(name))[1] = auth.uid()::text)
        with check (bucket_id = 'speaking-audio'
               and (storage.foldername(name))[1] = auth.uid()::text);`,
      // Как PG нормализует и хранит предикат (одинаков для qual и with_check).
      expectedPredicate:
        "((bucket_id = 'speaking-audio'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text))",
    },
  },
  {
    // Приватный контент С ключами до вычистки (src/lib/import/source-html-storage.ts) —
    // только service-role путь, никакой клиентской политики. Любая permissive-политика,
    // открывающая source-html anon/authenticated = дрейф (ловится verify).
    id: "source-html",
    public: false,
    fileSizeLimit: null,
    allowedMimeTypes: null,
    ownerPolicy: null,
  },
];

function bucketById(id: string): StorageBucketSpec {
  const b = STORAGE_BUCKETS.find((x) => x.id === id);
  if (!b) throw new Error(`неизвестный бакет в каноне: ${id}`);
  return b;
}

// --- SETUP (идемпотентно создаёт/выравнивает по канону) ---------------------

/**
 * Идемпотентно провижинит бакеты канона (bucket upsert + owner-политики).
 * bucketIds — подмножество (по умолчанию весь канон). Значения — из STORAGE_BUCKETS,
 * не из вызывающего, поэтому bucket upsert параметризован, а DDL политики
 * (не параметризуется) берётся статической строкой канона.
 */
export async function applyStorageProvisioning(
  sql: Sql,
  bucketIds?: string[],
): Promise<void> {
  const targets = bucketIds ? bucketIds.map(bucketById) : STORAGE_BUCKETS;
  for (const b of targets) {
    await sql`
      insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values (${b.id}, ${b.id}, ${b.public}, ${b.fileSizeLimit}, ${b.allowedMimeTypes})
      on conflict (id) do update
        set public = ${b.public},
            file_size_limit = ${b.fileSizeLimit},
            allowed_mime_types = ${b.allowedMimeTypes}
    `;
    if (b.ownerPolicy) {
      // drop→create: политика приходит ровно к каноническому определению.
      await sql.unsafe(`drop policy if exists ${b.ownerPolicy.name} on storage.objects;`);
      await sql.unsafe(b.ownerPolicy.createSql);
    } else {
      // Бакет без owner-политики (source-html): канон = 0 клиентских политик.
      // Выравниваем — дропаем permissive-политики на storage.objects, что ссылаются
      // на этот bucket id для anon/authenticated/public. Codex P1 #2: иначе verify
      // находит утечку, но setup её НЕ лечит → контракт остаётся вечно красным.
      const candidates = await sql<{ policyname: string; qual: string | null; with_check: string | null }[]>`
        select policyname, qual, with_check from pg_policies
        where schemaname = 'storage' and tablename = 'objects'
          and permissive = 'PERMISSIVE'
          and (roles && array['anon','authenticated','public']::name[])`;
      // Фильтр по ТОЧНОМУ литералу `'<id>'` (не substring) — чтобы не задеть чужой
      // бакет с похожим именем (напр. source-html-archive). Симметрично verify.
      const leaks = candidates.filter((c) => referencesBucketLiteral(c, b.id));
      for (const l of leaks) {
        // policyname из pg_policies (не внешний вход); экранируем кавычки в идентификаторе.
        const safe = l.policyname.replace(/"/g, '""');
        await sql.unsafe(`drop policy if exists "${safe}" on storage.objects;`);
      }
    }
  }
}

// --- VERIFY (read-only сверка с каноном; НЕ чинит) --------------------------

interface BucketRow {
  id: string;
  public: boolean | null;
  file_size_limit: string | number | null;
  allowed_mime_types: string[] | null;
}

interface PolicyRow {
  policyname: string;
  cmd: string;
  roles: string[];
  qual: string | null;
  with_check: string | null;
}

function eqSet(a: string[], b: string[]): boolean {
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.length === sb.length && sa.every((v, i) => v === sb[i]);
}

/** Схлопывает пробелы для устойчивого к форматированию, но ТОЧНОГО сравнения предиката. */
function normalizePredicate(expr: string | null): string {
  return (expr ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Ссылается ли policy на bucket id ТОЧНЫМ SQL-литералом `'<id>'` (в qual/with_check),
 * а не подстрокой (Codex: голый `includes('source-html')` задел бы `source-html-archive`).
 * `'source-html'` не встречается в `'source-html-archive'` (там после id идёт `-`, не кавычка).
 * Bucket-agnostic policy (`using(true)`, без литерала id) сюда НЕ попадает — это отдельный
 * класс, покрытый поведенческими cross-user пробами контракта.
 */
function referencesBucketLiteral(p: { qual: string | null; with_check: string | null }, id: string): boolean {
  const blob = `${p.qual ?? ""} ${p.with_check ?? ""}`;
  return blob.includes(`'${id}'`);
}

/**
 * Сверяет фактическое состояние Storage с каноном. Строго read-only (только SELECT
 * из storage.buckets и pg_policies). ok=false + problems[] на любое расхождение —
 * вызывающий контракт-тест обязан упасть, а не self-heal'ить.
 */
export async function verifyStorageProvisioning(
  sql: Sql,
): Promise<{ ok: boolean; problems: string[] }> {
  const problems: string[] = [];

  const buckets = await sql<BucketRow[]>`
    select id, public, file_size_limit, allowed_mime_types
    from storage.buckets
    where id in ${sql(STORAGE_BUCKETS.map((b) => b.id))}`;
  const byId = new Map(buckets.map((r) => [r.id, r]));

  // Все permissive-политики на storage.objects, отданные anon/authenticated —
  // общий срез для проверки owner-политики speaking-audio И отсутствия дрейфа
  // на source-html (политики висят на общей таблице storage.objects, не на бакете).
  const objectPolicies = await sql<PolicyRow[]>`
    select policyname, cmd, roles::text[] as roles, qual, with_check
    from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and permissive = 'PERMISSIVE'
      and (roles && array['anon','authenticated','public']::name[])`;

  for (const spec of STORAGE_BUCKETS) {
    const b = byId.get(spec.id);
    if (!b) {
      problems.push(`бакет ${spec.id} отсутствует`);
      continue;
    }
    // a) атрибуты бакета.
    if (b.public !== spec.public) {
      problems.push(`бакет ${spec.id}: public=${b.public}, ожидалось ${spec.public}`);
    }
    const actualLimit = b.file_size_limit == null ? null : Number(b.file_size_limit);
    if (actualLimit !== spec.fileSizeLimit) {
      problems.push(
        `бакет ${spec.id}: file_size_limit=${actualLimit}, ожидалось ${spec.fileSizeLimit}`,
      );
    }
    const actualMime = b.allowed_mime_types;
    if (spec.allowedMimeTypes === null) {
      if (actualMime !== null && actualMime.length > 0) {
        problems.push(
          `бакет ${spec.id}: allowed_mime_types=[${actualMime.join(",")}], ожидалось null`,
        );
      }
    } else if (!actualMime || !eqSet(actualMime, spec.allowedMimeTypes)) {
      problems.push(
        `бакет ${spec.id}: allowed_mime_types=[${(actualMime ?? []).join(",")}], ` +
          `ожидалось [${spec.allowedMimeTypes.join(",")}]`,
      );
    }

    // b) owner-политика (speaking-audio): существует, cmd=ALL, roles=authenticated
    //    (без anon/public), qual+with_check несут owner-предикат.
    if (spec.ownerPolicy) {
      const p = objectPolicies.find((x) => x.policyname === spec.ownerPolicy!.name);
      if (!p) {
        problems.push(
          `политика ${spec.ownerPolicy.name} на storage.objects отсутствует (owner-доступ ${spec.id} не защищён)`,
        );
      } else {
        if (p.cmd !== "ALL") {
          problems.push(`политика ${spec.ownerPolicy.name}: cmd=${p.cmd}, ожидался ALL`);
        }
        // roles СТРОГО ровно [authenticated] — не «содержит authenticated» (Codex:
        // лишняя роль вроде custom_client прошла бы includes-проверку незамеченной).
        if (p.roles.length !== 1 || p.roles[0] !== "authenticated") {
          problems.push(
            `политика ${spec.ownerPolicy.name}: roles=[${p.roles.join(",")}], ожидалось ровно [authenticated]`,
          );
        }
        // ТОЧНОЕ сравнение с каноном (не подстроки): ослабление предиката
        // (добавленный OR, снятое условие) обязано краснеть.
        const expected = normalizePredicate(spec.ownerPolicy.expectedPredicate);
        if (normalizePredicate(p.qual) !== expected) {
          problems.push(
            `политика ${spec.ownerPolicy.name}: qual "${p.qual ?? "null"}" ≠ каноническому owner-предикату (возможно ослабление)`,
          );
        }
        if (normalizePredicate(p.with_check) !== expected) {
          problems.push(
            `политика ${spec.ownerPolicy.name}: with_check "${p.with_check ?? "null"}" ≠ каноническому owner-предикату`,
          );
        }
      }
      // Проверка одной именованной политики недостаточна (Codex): ЛИШНЯЯ адресная
      // permissive-политика на speaking-audio (напр. `insert with check (true)`)
      // открыла бы доступ, а именованная осталась бы корректной. Требуем: адресных
      // (по литералу `'speaking-audio'`) permissive-политик ровно одна — каноническая.
      const addressed = objectPolicies.filter((x) => referencesBucketLiteral(x, spec.id));
      const extras = addressed.filter((x) => x.policyname !== spec.ownerPolicy!.name);
      if (extras.length > 0) {
        problems.push(
          `бакет ${spec.id}: лишние адресные политики помимо канонической — [${extras
            .map((x) => x.policyname)
            .join(", ")}] (открывают доступ мимо owner-предиката)`,
        );
      }
    }

    // c) бакет БЕЗ owner-политики (source-html): ни одна permissive-политика на
    //    storage.objects (для anon/authenticated) не должна ссылаться на его id.
    //    Лишняя такая политика = дрейф (случайно оставленный доступ к контенту с ключами).
    if (!spec.ownerPolicy) {
      const leaks = objectPolicies.filter((p) => referencesBucketLiteral(p, spec.id));
      if (leaks.length > 0) {
        problems.push(
          `бакет ${spec.id}: посторонние политики ссылаются на него — [${leaks
            .map((p) => p.policyname)
            .join(", ")}] (лишняя permissive policy = дрейф)`,
        );
      }
    }
  }

  return { ok: problems.length === 0, problems };
}
