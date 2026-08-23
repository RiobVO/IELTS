/**
 * Storage-контракт hosted тест-стенда (волна 2, TESTING_PLAN §7): private-бакеты
 * `speaking-audio` и `source-html` против реального Supabase Storage (не эмулируется
 * локальным Postgres — см. setup-speaking-storage.ts). Таргет строго из
 * loadTestTargetEnv() (fail-fast на прод-ref), никогда .env.local.
 *
 * READ-ONLY verify-ГЕЙТ (первым): сверяет фактическое состояние Storage с каноном
 * (scripts/lib/storage-provisioning.ts) — бакеты + owner-политика speaking-audio +
 * отсутствие дрейфа на source-html. Тест НЕ чинит: если провижининг отсутствует
 * или дрейфанул → FAIL + подсказка запустить setup, exit БЕЗ поведенческих проб.
 * Иначе тест доказывал бы корректность политики, которую сам же и поставил.
 *
 * Контракт на бакет (поведенческие пробы, после зелёного verify):
 *   1) service-role UPLOAD тестового объекта;
 *   2) POSITIVE CONTROL — service-role signed URL реально отдаёт 200 + верное тело
 *      (без этого anon-deny ниже может быть ложным: объекта могло просто не быть);
 *   3) ANON download того же объекта — DENY (приватный бакет обязан отказать);
 *   4) cleanup объекта в finally (ошибка cleanup логируется, не роняет итог).
 * Отдельно: anon НЕ может создать бакет (граница service-role).
 *
 * Authenticated-контракт (внешнее ревью, High #2 + Medium #3): service-role и anon —
 * не единственные роли, которые видит PostgREST. Лишняя permissive policy
 * `TO authenticated` на приватном бакете не ловится ни service-role проверками, ни
 * anon-deny — нужен реальный authenticated-юзер:
 *   1) создать юзера U через service-role admin API + залогинить (реальный JWT, тот же
 *      паттерн, что test/hosted/rls-http.ts);
 *   2) speaking-audio (owner-policy по (storage.foldername(name))[1] = auth.uid()::text):
 *      U заливает объект под СВОИМ префиксом → OK; U скачивает СВОЙ объект своим
 *      authed-клиентом → OK + тело совпадает (owner POSITIVE CONTROL — тем же ударом
 *      доказывает валидность JWT/anon-ключа проекта, закрывая Medium #3 для anon-deny
 *      выше); затем service-role заливает объект под ЧУЖИМ префиксом (случайный UUID) —
 *      U пытается скачать его своим authed-клиентом → DENY (cross-user, прямой IDOR-вектор
 *      на Storage, если owner-policy пробита);
 *   3) source-html (без policy вовсе, только service-role): U пытается скачать объект,
 *      залитый service-role → DENY (default-deny обязан работать и для authenticated,
 *      не только anon — иначе случайно оставленная permissive policy пройдёт незамеченной);
 *   4) cleanup всех созданных объектов + удаление юзера U в finally.
 */
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { loadTestTargetEnv } from "./lib/test-target-env.ts";
import { verifyStorageProvisioning } from "./lib/storage-provisioning.ts";

const t = loadTestTargetEnv();

interface BucketSpec {
  id: string;
  /** speaking-audio держит allowed_mime_types — контракт-объект обязан ему соответствовать. */
  contentType: string;
  /**
   * РЕАЛИСТИЧНОЕ расширение ключа пробы (Codex P2 #1): bucket-agnostic policy по
   * имени объекта (напр. `name LIKE '%.html'`) не содержит литерал bucket id и не
   * ловится verify — но откроет реальные `.html`-объекты. Проба обязана бить по
   * тому же расширению, что реальный контент, иначе anon-deny ложно-зелёный.
   */
  ext: string;
}

// Провижининг (создание бакетов + owner-политика) больше НЕ здесь — он в каноне
// (scripts/lib/storage-provisioning.ts), применяется отдельным setup-test-storage.ts.
// Тут только поведенческие пробы против уже провижиненного стенда.
const BUCKETS: BucketSpec[] = [
  { id: "speaking-audio", contentType: "audio/webm", ext: "webm" },
  { id: "source-html", contentType: "text/html; charset=utf-8", ext: "html" },
];

let failures = 0;

function ok(msg: string): void {
  console.log(`[OK] ${msg}`);
}

function fail(msg: string): void {
  failures++;
  console.log(`[FAIL] ${msg}`);
}

/**
 * READ-ONLY verify-гейт. Сверяет Storage с каноном; при расхождении печатает КАЖДУЮ
 * проблему как [FAIL] + подсказку setup и возвращает false — main обязан выйти БЕЗ
 * поведенческих проб (self-heal здесь запрещён — иначе ложно-зелёный класс).
 */
async function verifyProvisioning(): Promise<boolean> {
  const sql = postgres(t.directUrl, { max: 1, prepare: false, onnotice: () => {} });
  try {
    const { ok: isOk, problems } = await verifyStorageProvisioning(sql);
    if (isOk) {
      ok("provisioning соответствует канону (бакеты + owner-политика speaking-audio)");
      return true;
    }
    for (const p of problems) fail(`provisioning: ${p}`);
    console.log("подсказка: запусти `npm run test:hosted:storage:setup` и повтори.");
    return false;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function testBucketContract(bucket: BucketSpec): Promise<void> {
  const bucketId = bucket.id;
  const svc = createClient(t.supabaseUrl, t.serviceRoleKey);
  const anon = createClient(t.supabaseUrl, t.anonKey);
  const key = `contract-test/${Date.now()}-${Math.random().toString(36).slice(2)}.${bucket.ext}`;
  const body = new Uint8Array([9, 8, 7, 6, 5]);

  try {
    // 2) service-role upload.
    const up = await svc.storage.from(bucketId).upload(key, body, {
      contentType: bucket.contentType,
    });
    if (up.error) {
      fail(`${bucketId}: service-role upload — ${up.error.message}`);
      return;
    }
    ok(`${bucketId}: service-role upload прошёл`);

    // 3) positive control — signed URL реально отдаёт байты.
    const signed = await svc.storage.from(bucketId).createSignedUrl(key, 30);
    if (signed.error || !signed.data?.signedUrl) {
      fail(`${bucketId}: не удалось создать signed URL — ${signed.error?.message}`);
    } else {
      const resp = await fetch(signed.data.signedUrl);
      if (!resp.ok) {
        fail(`${bucketId}: signed URL вернул HTTP ${resp.status}`);
      } else {
        const bytes = new Uint8Array(await resp.arrayBuffer());
        const matches = bytes.length === body.length && bytes.every((b, i) => b === body[i]);
        if (!matches) {
          fail(`${bucketId}: signed URL отдал тело, не совпадающее с загруженным`);
        } else {
          ok(`${bucketId}: signed URL — HTTP 200, тело совпадает (positive control)`);
        }
      }
    }

    // 4) anon deny — приватный бакет должен отказать. Что это именно policy-deny, а
    // не битый anon-ключ, отдельно доказывает owner positive control в
    // testAuthenticatedBoundaries() (тот же проект, тот же клиентский ключ-класс).
    const anonDl = await anon.storage.from(bucketId).download(key);
    if (anonDl.data) {
      fail(`${bucketId}: anon смог скачать объект приватного бакета`);
    } else {
      ok(`${bucketId}: anon download — deny, как и требуется приватностью`);
    }
  } finally {
    // 5) cleanup — best-effort, не роняет итог теста.
    const rm = await svc.storage.from(bucketId).remove([key]);
    if (rm.error) {
      console.log(`[WARN] ${bucketId}: cleanup объекта не удался — ${rm.error.message}`);
    }
  }
}

/**
 * Authenticated-контракт (High #2 + Medium #3): реальный залогиненный юзер против
 * owner-policy speaking-audio (owner-positive + cross-user-deny) и default-deny
 * source-html (нет policy вовсе — authenticated обязан отказать так же, как anon).
 */
async function testAuthenticatedBoundaries(): Promise<void> {
  const admin = createClient(t.supabaseUrl, t.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const svc = createClient(t.supabaseUrl, t.serviceRoleKey);

  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `storage-contract-${runId}@example.test`;
  const password = `Storage-${runId}-Aa1!`;
  const body = new Uint8Array([1, 2, 3, 4]);

  let userId = "";
  let ownKey = "";
  let foreignKey = "";
  let sourceHtmlKey = "";

  try {
    // 1) реальный authenticated-юзер через service-role admin API + логин своим JWT
    // (тот же паттерн, что test/hosted/rls-http.ts).
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) {
      fail(`не удалось создать authenticated-юзера — ${created.error?.message}`);
      return;
    }
    userId = created.data.user.id;
    const authed = createClient(t.supabaseUrl, t.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const signed = await authed.auth.signInWithPassword({ email, password });
    if (signed.error || !signed.data.session) {
      fail(`authenticated-юзер не смог залогиниться — ${signed.error?.message}`);
      return;
    }
    ok("authenticated-юзер создан и залогинен (реальный JWT)");

    // 2) speaking-audio owner-модель — U заливает под своим префиксом.
    ownKey = `${userId}/contract-${Date.now()}.webm`;
    const upOwn = await authed.storage.from("speaking-audio").upload(ownKey, body, {
      contentType: "audio/webm",
    });
    if (upOwn.error) {
      fail(`speaking-audio: authenticated-юзер не смог залить объект под своим префиксом — ${upOwn.error.message}`);
    } else {
      ok("speaking-audio: authenticated-юзер залил объект под своим префиксом (owner upload)");

      // OWNER POSITIVE CONTROL клиентским ключом — без него cross-user deny ниже
      // тавтологичен (0 могло быть и из-за битого ключа/URL, не только политики).
      const dlOwn = await authed.storage.from("speaking-audio").download(ownKey);
      if (dlOwn.error || !dlOwn.data) {
        fail(`speaking-audio: authenticated-юзер не смог скачать СВОЙ объект — ${dlOwn.error?.message}`);
      } else {
        const bytes = new Uint8Array(await dlOwn.data.arrayBuffer());
        const matches = bytes.length === body.length && bytes.every((b, i) => b === body[i]);
        if (!matches) {
          fail("speaking-audio: authenticated-юзер скачал свой объект, но тело не совпадает");
        } else {
          ok("speaking-audio: authenticated-юзер скачал СВОЙ объект, тело совпадает (owner positive control)");
        }
      }
    }

    // CROSS-USER: service-role заливает объект под ЧУЖИМ префиксом (случайный UUID,
    // не U) — U пытается скачать его своим authed-клиентом → DENY. Прямой IDOR-вектор
    // на Storage, если owner-policy пробита permissive-грантом.
    const foreignUuid = randomUUID();
    foreignKey = `${foreignUuid}/foreign-${Date.now()}.webm`;
    const upForeign = await svc.storage.from("speaking-audio").upload(foreignKey, body, {
      contentType: "audio/webm",
    });
    if (upForeign.error) {
      fail(
        `speaking-audio: service-role не смог засеять чужой объект для cross-user пробы — ${upForeign.error.message}`,
      );
    } else {
      const dlForeign = await authed.storage.from("speaking-audio").download(foreignKey);
      if (dlForeign.data) {
        fail("speaking-audio: authenticated-юзер скачал ЧУЖОЙ объект — IDOR, owner-policy пробита");
      } else {
        ok("speaking-audio: authenticated-юзер НЕ может скачать чужой объект (cross-user deny, owner-policy держится)");
      }
    }

    // 2b) cross-user UPLOAD: U пытается ЗАЛИТЬ под чужим префиксом. Ловит класс,
    // который каталожный verify не адресует — bucket-agnostic `insert with check(true)`
    // policy (не содержит литерал bucket id). Owner with_check обязан отказать.
    const foreignUploadKey = `${randomUUID()}/foreign-upload-${Date.now()}.webm`;
    const upForeignByU = await authed.storage.from("speaking-audio").upload(foreignUploadKey, body, {
      contentType: "audio/webm",
    });
    if (upForeignByU.data && !upForeignByU.error) {
      fail("speaking-audio: authenticated-юзер ЗАЛИЛ объект под чужим префиксом — with_check owner-предиката пробит (лишняя insert-policy)");
      // подчистить пробитый объект
      await svc.storage.from("speaking-audio").remove([foreignUploadKey]);
    } else {
      ok("speaking-audio: authenticated-юзер НЕ может залить под чужим префиксом (cross-user upload deny, with_check держится)");
    }

    // 3) source-html — policy вовсе нет (только service-role путь). authenticated
    // обязан получить default-deny так же, как anon — иначе случайно оставленная
    // permissive policy `TO authenticated` пройдёт незамеченной.
    sourceHtmlKey = `contract-auth-probe/${Date.now()}.html`;
    const upHtml = await svc.storage.from("source-html").upload(sourceHtmlKey, new TextEncoder().encode("<p>x</p>"), {
      contentType: "text/html; charset=utf-8",
    });
    if (upHtml.error) {
      fail(`source-html: service-role не смог засеять объект для authenticated-deny пробы — ${upHtml.error.message}`);
    } else {
      const dlHtml = await authed.storage.from("source-html").download(sourceHtmlKey);
      if (dlHtml.data) {
        fail("source-html: authenticated-юзер скачал объект без policy — лишняя permissive policy на приватном бакете");
      } else {
        ok("source-html: authenticated-юзер НЕ может скачать объект без policy (default-deny держится и для authenticated)");
      }
    }
  } finally {
    // cleanup — best-effort, ошибки логируются, не роняют итог.
    if (ownKey) {
      const rm = await svc.storage.from("speaking-audio").remove([ownKey]);
      if (rm.error) console.log(`[WARN] cleanup speaking-audio own объекта не удался — ${rm.error.message}`);
    }
    if (foreignKey) {
      const rm = await svc.storage.from("speaking-audio").remove([foreignKey]);
      if (rm.error) console.log(`[WARN] cleanup speaking-audio foreign объекта не удался — ${rm.error.message}`);
    }
    if (sourceHtmlKey) {
      const rm = await svc.storage.from("source-html").remove([sourceHtmlKey]);
      if (rm.error) console.log(`[WARN] cleanup source-html auth-probe объекта не удался — ${rm.error.message}`);
    }
    if (userId) {
      const del = await admin.auth.admin.deleteUser(userId);
      if (del.error) console.log(`[WARN] cleanup authenticated-юзера ${userId} не удался — ${del.error.message}`);
    }
  }
}

async function testServiceRoleBoundary(): Promise<void> {
  const anon = createClient(t.supabaseUrl, t.anonKey);
  const probeName = `anon-boundary-probe-${Date.now()}`;
  const created = await anon.storage.createBucket(probeName, { public: false });
  if (created.data) {
    fail(`anon смог создать бакет ${probeName} — граница service-role нарушена`);
    // Подчистить, если граница неожиданно пробита — иначе тест-проект захламляется.
    const svc = createClient(t.supabaseUrl, t.serviceRoleKey);
    const rm = await svc.storage.deleteBucket(probeName);
    if (rm.error) console.log(`[WARN] не удалось удалить пробитый бакет ${probeName}: ${rm.error.message}`);
    return;
  }
  ok("anon не может создать бакет — граница service-role держится");

  // Вторая грань: anon не может залить объект в существующий приватный бакет (без policy).
  const key = `anon-upload-probe-${Date.now()}.bin`;
  const up = await anon.storage.from("source-html").upload(key, new Uint8Array([1]));
  if (up.data) {
    fail(`anon смог залить объект в приватный source-html`);
    const svc = createClient(t.supabaseUrl, t.serviceRoleKey);
    await svc.storage.from("source-html").remove([key]);
  } else {
    ok("anon не может залить объект в приватный source-html — граница держится");
  }
}

async function main(): Promise<void> {
  console.log(`target: тест-проект ${t.ref} (hosted Supabase), storage-контракт\n`);

  // verify-гейт первым: без соответствия канону поведенческие пробы бессмысленны
  // (и тест не должен «чинить» дрейф, маскируя сломанный провижининг).
  if (!(await verifyProvisioning())) {
    console.log(`\nexit 1 — провижининг не соответствует канону (${failures} проблем(а))`);
    process.exit(1);
  }

  for (const b of BUCKETS) {
    await testBucketContract(b);
  }
  await testAuthenticatedBoundaries();
  await testServiceRoleBoundary();

  if (failures === 0) {
    console.log(
      `\nexit 0 — storage-контракт чист (${BUCKETS.length} бакета + service-role границы + authenticated owner/cross-user границы)`,
    );
    process.exit(0);
  }
  console.log(`\nexit 1 — ${failures} нарушение(й) контракта`);
  process.exit(1);
}

main().catch((e) => {
  console.error("\nstorage-contract-test crashed:", e);
  process.exit(2);
});
