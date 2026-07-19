import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";

/**
 * Волна 1.5, пакет A (TESTING_PLAN §6, «Конкурентность»): реальные транзакции и
 * гонки PostgreSQL на throwaway нативном PG — то, что мок-тесты честно пометили
 * как «предикат запинен, атомарность не доказана». Схему готовит
 * test/db-global-setup.ts, env перехватывает test/db-setup.ts
 * (DATABASE_URL → VERIFY_DATABASE_URL до импорта @/db).
 *
 * ── Решение по after() ──
 * access.ts / apply-post-submit.ts / finalize-submit.ts откладывают эффекты через
 * `after()` из next/server. Вне request-scope Next `after()` бросает/теряет
 * колбэк, а applyPostSubmit к тому же ГЛОТАЕТ ошибки (try/catch + error_log) —
 * тест, ждущий отложенный эффект, не отличил бы «эффект не случился» от «упало и
 * проглотилось». Поэтому мок next/server собирает колбэки в очередь (vi.hoisted,
 * чтобы фабрика видела массив), а flushAfter() детерминированно их прогоняет:
 * отложенные notification/referral/leaderboard-эффекты становятся наблюдаемы, а
 * там, где мы их НЕ ждём, просто не флашим (captureServer уже no-op — ключи
 * PostHog вычищены db-setup'ом). Где эффект важен — дополнительно проверяем
 * чистоту error_log, отделяя «не случилось» от «проглочено».
 */
const { afterHooks, captureServerMock } = vi.hoisted(() => ({
  afterHooks: [] as Array<() => unknown>,
  captureServerMock: vi.fn(),
}));
vi.mock("next/server", () => ({
  after: (cb: () => unknown) => {
    afterHooks.push(cb);
  },
}));
// Телеметрию мокаем НАБЛЮДАЕМО (ревью-находка: с вычищенными PostHog-ключами
// captureServer — no-op, и удаление/дублирование test_submit оставалось бы
// зелёным). Мок-fn позволяет ассертить «ровно одно событие с точным payload».
vi.mock("@/lib/analytics/server", () => ({ captureServer: captureServerMock }));
/** Детерминированно прогоняет накопленные after()-колбэки (по одному, по порядку). */
async function flushAfter(): Promise<void> {
  while (afterHooks.length) {
    const cb = afterHooks.shift()!;
    await cb();
  }
}

/**
 * SQLSTATE ошибки с разворотом cause-цепочки: Drizzle оборачивает pg-ошибку в
 * DrizzleQueryError, у которого `code` живёт в `cause` (ревью-находка: проверка
 * только верхнего уровня пропустила бы реальный deadlock).
 */
function pgCode(e: unknown): string | null {
  let cur: unknown = e;
  while (cur && typeof cur === "object") {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === "string") return code;
    cur = (cur as { cause?: unknown }).cause;
  }
  return null;
}

// redirect() из next/navigation НЕ мокаем: он бросает NEXT_REDIRECT, и это ровно
// тот сигнал отказа по капу/trial, который проверяем через isNextRedirectError.
import { startAttempt } from "@/lib/exam/access";
import { finalizeSubmit } from "@/lib/exam/finalize-submit";
import { isNextRedirectError } from "@/lib/exam/is-redirect-error";
import { applyPostSubmit } from "@/lib/progress/apply-post-submit";
import { maybeRewardReferral } from "@/lib/progress/referral";
import { BASIC_MOCK_WEEKLY_LIMIT, BASIC_PRACTICE_DAILY_LIMIT } from "@/lib/tiers";
import { db } from "@/db";

// Свой raw-клиент для сида/инспекции — ОТДЕЛЬНО от app-пула @/db под тестом (тот
// же приём, что verify.ts / payments.db.test.ts). max:1 — сид последовательный.
const sql = postgres(process.env.VERIFY_DATABASE_URL!, {
  max: 1,
  onnotice: () => {},
});

let seq = 0;

/** INSERT в auth.users — profile создаёт SECURITY DEFINER триггер миграции 0002. */
async function seedUser(): Promise<string> {
  seq++;
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO auth.users (email) VALUES (${`attempt-${seq}@test.local`})
    RETURNING id`;
  const [prof] = await sql<{ id: string }[]>`
    SELECT id FROM profile WHERE id = ${row!.id}`;
  expect(prof?.id).toBe(row!.id); // auth-триггер обязан был создать profile
  return row!.id;
}

/**
 * Минимальный published content_item. По умолчанию одиночный passage (basic,
 * не-trial-путь). `full=true` → полный tier-гейтнутый тест (full_reading +
 * premium) для trial-веток.
 */
async function seedContent(full = false): Promise<string> {
  seq++;
  const category = full ? "full_reading" : "passage_1";
  const tier = full ? "premium" : "basic";
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO content_item (section, category, title, band_type, tier_required, status)
    VALUES ('reading', ${category}, ${`T-${seq}`}, 'reading_academic', ${tier}, 'published')
    RETURNING id`;
  return row!.id;
}

/** Уже СДАННАЯ mock-попытка (нужна applyPostSubmit: count submitted = 1 → rated). */
async function seedSubmittedAttempt(userId: string, contentItemId: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO attempt
      (user_id, content_item_id, mode, status, started_at, submitted_at, raw_score, time_used_seconds)
    VALUES
      (${userId}, ${contentItemId}, 'mock', 'submitted', now() - interval '20 min', now(), 5, 1200)
    RETURNING id`;
  return row!.id;
}

/** in_progress mock-попытка (вход для finalizeSubmit / single-fire claim). */
async function seedInProgressAttempt(userId: string, contentItemId: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO attempt (user_id, content_item_id, mode, status, started_at)
    VALUES (${userId}, ${contentItemId}, 'mock', 'in_progress', now() - interval '20 min')
    RETURNING id`;
  return row!.id;
}

/** Практис-попытки «сегодня» для набивания капа (mode practice, started_at now). */
async function seedPracticeToday(userId: string, contentItemId: string, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await sql`
      INSERT INTO attempt (user_id, content_item_id, mode, status, started_at)
      VALUES (${userId}, ${contentItemId}, 'practice', 'submitted', now())`;
  }
}

async function profileFacts(userId: string): Promise<{
  xp: number;
  rating: number;
  ratedCount: number;
}> {
  const [row] = await sql<{ xp: number; rating: number; rated_count: number }[]>`
    SELECT xp, rating, rated_count FROM profile WHERE id = ${userId}`;
  return { xp: row!.xp, rating: row!.rating, ratedCount: row!.rated_count };
}

async function countRows(table: string, where: string, ...params: unknown[]): Promise<number> {
  const [row] = await sql.unsafe<{ n: number }[]>(
    `SELECT count(*)::int AS n FROM ${table} WHERE ${where}`,
    params as never[],
  );
  return row!.n;
}

/** Волюм-1 бейдж: после ПЕРВОЙ submitted-попытки volume=1 ≥ 1 → выдаётся ровно раз. */
async function seedVolumeBadge(): Promise<void> {
  await sql`
    INSERT INTO badge (code, name, description, icon, criteria)
    VALUES ('first_test', 'First Test', 'Complete one test', '1',
            ${sql.json({ type: "volume", tests: 1 })})`;
}

/** referral-строка status='registered' прямым INSERT (обходим OAuth/signup-триггер). */
async function seedReferral(inviterId: string, inviteeId: string): Promise<void> {
  seq++;
  await sql`
    INSERT INTO referral (inviter_id, invitee_id, code, status)
    VALUES (${inviterId}, ${inviteeId}, ${`REF${seq}`}, 'registered')`;
}

// Failure-injection триггерами (паттерн INJECT_SQL из payments.db.test.ts): сбой
// внутри транзакции обязан откатить ВСЕ связанные записи.
const INJECT_SQL = {
  raiseOnProfileUpdate: `
    CREATE OR REPLACE FUNCTION _inject_profile_fail() RETURNS trigger
    LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected profile failure'; END $$;
    CREATE TRIGGER _inject_profile_fail BEFORE UPDATE ON profile
      FOR EACH ROW EXECUTE FUNCTION _inject_profile_fail();`,
  raiseOnAttemptInsert: `
    CREATE OR REPLACE FUNCTION _inject_attempt_fail() RETURNS trigger
    LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected attempt failure'; END $$;
    CREATE TRIGGER _inject_attempt_fail BEFORE INSERT ON attempt
      FOR EACH ROW EXECUTE FUNCTION _inject_attempt_fail();`,
  cleanup: `
    DROP TRIGGER IF EXISTS _inject_profile_fail ON profile;
    DROP FUNCTION IF EXISTS _inject_profile_fail();
    DROP TRIGGER IF EXISTS _inject_attempt_fail ON attempt;
    DROP FUNCTION IF EXISTS _inject_attempt_fail();`,
};

/** Вход finalizeSubmit: rated mock-путь (mock + первая сдача + не too-fast). */
function finalizeInput(
  attemptId: string,
  userId: string,
  contentItemId: string,
  over: Partial<Parameters<typeof finalizeSubmit>[0]> = {},
): Parameters<typeof finalizeSubmit>[0] {
  return {
    attemptId,
    userId,
    contentItemId,
    mode: "mock",
    answers: { "1": "TRUE" },
    submittedAt: new Date(),
    timeUsedSeconds: 600, // ≥ total*3 → не too-fast
    rawScore: 7,
    total: 10,
    bandValue: null,
    perType: { tfng: { correct: 7, total: 10 } },
    reviewRows: [
      {
        number: 1,
        qtype: "tfng",
        mode: "exact",
        accept: ["TRUE"],
        explanation: null,
        explanationRu: null,
        evidence: null,
      },
    ],
    ...over,
  };
}

beforeEach(async () => {
  afterHooks.length = 0; // очередь after() не течёт между тестами
  captureServerMock.mockClear();
  // Полный чистый лист: TRUNCATE auth.users каскадом сносит profile → attempt/
  // referral/trial_claim/content_item/notification/user_badge/leaderboard/…;
  // badge (без FK к profile) и error_log чистим явно.
  await sql`TRUNCATE auth.users, badge, error_log CASCADE`;
});

afterEach(async () => {
  await sql.unsafe(INJECT_SQL.cleanup); // инъекции не переживают свой тест даже при fail
});

afterAll(async () => {
  await sql.end({ timeout: 5 });
  // app-пул @/db держит воркер живым; drizzle-postgres-js экспонирует raw-клиент.
  const client = (
    db as unknown as {
      $client?: { end: (o?: { timeout?: number }) => Promise<void> };
    }
  ).$client;
  if (client?.end) await client.end({ timeout: 5 });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* §6: два одновременных старта при лимите 2 → проходят ровно 2, остальные — отказ */
/* ────────────────────────────────────────────────────────────────────────── */
describe("Basic-кап на старты (транзакционный, под row-lock)", () => {
  it("4 одновременных practice-старта РАЗНЫХ item → ровно 2 attempt, 2 редиректа limit=practice", async () => {
    const userId = await seedUser();
    const items = await Promise.all([seedContent(), seedContent(), seedContent(), seedContent()]);

    const results = await Promise.allSettled(
      items.map((id) => startAttempt(userId, id, "practice", false, null, "basic")),
    );

    const created = results.filter((r) => r.status === "fulfilled");
    const capped = results.filter(
      (r) => r.status === "rejected" && isNextRedirectError(r.reason),
    );
    expect(created).toHaveLength(BASIC_PRACTICE_DAILY_LIMIT); // 2
    expect(capped).toHaveLength(items.length - BASIC_PRACTICE_DAILY_LIMIT); // 2
    // Отказ ведёт именно на practice-лимит.
    for (const r of capped) {
      expect((r as PromiseRejectedResult).reason.digest).toContain("limit=practice");
    }
    // В БД РОВНО 2 строки — гонка не пробила кап (авторитетная проверка под локом).
    expect(await countRows("attempt", "user_id = $1", userId)).toBe(2);
  });

  it("4 одновременных mock-старта РАЗНЫХ item → ровно 2 attempt, 2 редиректа limit=mock", async () => {
    const userId = await seedUser();
    const items = await Promise.all([seedContent(), seedContent(), seedContent(), seedContent()]);

    const results = await Promise.allSettled(
      items.map((id) => startAttempt(userId, id, "mock", false, null, "basic")),
    );

    const created = results.filter((r) => r.status === "fulfilled");
    const capped = results.filter(
      (r) => r.status === "rejected" && isNextRedirectError(r.reason),
    );
    expect(created).toHaveLength(BASIC_MOCK_WEEKLY_LIMIT); // 2
    expect(capped).toHaveLength(items.length - BASIC_MOCK_WEEKLY_LIMIT);
    for (const r of capped) {
      expect((r as PromiseRejectedResult).reason.digest).toContain("limit=mock");
    }
    expect(await countRows("attempt", "user_id = $1", userId)).toBe(2);
  });

  it("лимит уже израсходован → одиночный старт отказывает, новой строки нет", async () => {
    const userId = await seedUser();
    const spent = await seedContent();
    await seedPracticeToday(userId, spent, BASIC_PRACTICE_DAILY_LIMIT); // 2 практис сегодня
    const fresh = await seedContent();

    const err = await startAttempt(userId, fresh, "practice", false, null, "basic").catch((e) => e);
    expect(isNextRedirectError(err)).toBe(true);
    expect((err as { digest: string }).digest).toContain("limit=practice");
    // Ни одной попытки на новом тесте.
    expect(await countRows("attempt", "user_id = $1 AND content_item_id = $2", userId, fresh)).toBe(0);
  });

  it("premium лимитом НЕ гейтится: 4 одновременных старта → 4 attempt, 0 отказов", async () => {
    const userId = await seedUser();
    const items = await Promise.all([seedContent(), seedContent(), seedContent(), seedContent()]);

    // userTier='premium' → fast-path без транзакции/капа (paid безлимит).
    const results = await Promise.allSettled(
      items.map((id) => startAttempt(userId, id, "practice", false, null, "premium")),
    );

    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    expect(await countRows("attempt", "user_id = $1", userId)).toBe(4);
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* §6: два конкурентных старта ОДНОГО item → одна попытка, второй получает resume  */
/* ────────────────────────────────────────────────────────────────────────── */
describe("Гонка старта ОДНОГО item → одна попытка + resume", () => {
  it("basic (транзакционный путь): оба вызова возвращают ОДИН attemptId, in_progress ровно один", async () => {
    const userId = await seedUser();
    const item = await seedContent();

    const [a, b] = await Promise.all([
      startAttempt(userId, item, "practice", false, null, "basic"),
      startAttempt(userId, item, "practice", false, null, "basic"),
    ]);

    expect(a.attemptId).toBe(b.attemptId); // проигравший гонку получил resume победителя
    expect(
      await countRows(
        "attempt",
        "user_id = $1 AND content_item_id = $2 AND status = 'in_progress'",
        userId,
        item,
      ),
    ).toBe(1);
  });

  it("paid (fast-path): гонку ловит onConflictDoNothing — один attemptId, in_progress один", async () => {
    const userId = await seedUser();
    const item = await seedContent();

    const [a, b] = await Promise.all([
      startAttempt(userId, item, "practice", false, null, "premium"),
      startAttempt(userId, item, "practice", false, null, "premium"),
    ]);

    expect(a.attemptId).toBe(b.attemptId);
    expect(
      await countRows(
        "attempt",
        "user_id = $1 AND content_item_id = $2 AND status = 'in_progress'",
        userId,
        item,
      ),
    ).toBe(1);
  });

  it("basic на границе капа (1 из 2 израсходован): гонка одного item → оба resume, ноль cap-отказов", async () => {
    // Ревью-находка: при нулевом расходе капа удаление resume-recheck под локом
    // маскируется ON CONFLICT'ом. Здесь граница limit−1: победитель вставкой
    // добивает кап до 2/2, и проигравший лока БЕЗ recheck насчитал бы полный кап
    // и получил ложный limit-redirect вместо resume той же попытки.
    const userId = await seedUser();
    const other = await seedContent();
    await seedPracticeToday(userId, other, BASIC_PRACTICE_DAILY_LIMIT - 1);
    const item = await seedContent();

    const [a, b] = await Promise.all([
      startAttempt(userId, item, "practice", false, null, "basic"),
      startAttempt(userId, item, "practice", false, null, "basic"),
    ]);

    expect(a.attemptId).toBe(b.attemptId); // проигравший получил resume, НЕ cap-отказ
    expect(
      await countRows(
        "attempt",
        "user_id = $1 AND content_item_id = $2 AND status = 'in_progress'",
        userId,
        item,
      ),
    ).toBe(1);
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* §6: два одновременных submit одной попытки → ровно один рейтинг/XP/badge/notif  */
/* ────────────────────────────────────────────────────────────────────────── */
describe("Гонка submit одной попытки → ровно один эффект", () => {
  it("два параллельных finalizeSubmit → один claimed, XP/рейтинг/бейдж/уведомление начислены РОВНО раз", async () => {
    const userId = await seedUser();
    const item = await seedContent();
    const attemptId = await seedInProgressAttempt(userId, item);
    await seedVolumeBadge();

    const before = await profileFacts(userId);

    const [r1, r2] = await Promise.all([
      finalizeSubmit(finalizeInput(attemptId, userId, item)),
      finalizeSubmit(finalizeInput(attemptId, userId, item)),
    ]);

    // Ровно один победитель claim'а.
    const claimed = [r1, r2].filter((r) => r.claimed);
    expect(claimed).toHaveLength(1);

    // XP вырос на xpGain (10 + rawScore=7) РОВНО один раз.
    const after = await profileFacts(userId);
    expect(after.xp - before.xp).toBe(17);
    // Рейтинг применён один раз (ratedCount 0→1, rating сдвинулся).
    expect(after.ratedCount).toBe(1);
    expect(after.rating).not.toBe(before.rating);
    // difficulty теста тоже двинут один раз.
    expect(await countRows("content_item", "id = $1 AND difficulty_count = 1", item)).toBe(1);
    // Ровно один snapshot и одна submitted-строка (повторного applyPostSubmit нет).
    expect(await countRows("attempt_review_snapshot", "attempt_id = $1", attemptId)).toBe(1);
    expect(await countRows("attempt", "id = $1 AND status = 'submitted'", attemptId)).toBe(1);
    // Бейдж выдан синхронно внутри applyPostSubmit — ровно один.
    expect(await countRows("user_badge", "user_id = $1", userId)).toBe(1);

    // Отложенные эффекты (badge-notification) — под flushAfter.
    await flushAfter();
    expect(await countRows("notification", "user_id = $1 AND type = 'badge_unlocked'", userId)).toBe(1);
    // test_submit — РОВНО одно событие с точным payload (регистрируется только
    // победителем claim'а; проигравший не доходит до after()-регистрации).
    const testSubmits = captureServerMock.mock.calls.filter((c) => c[0] === "test_submit");
    expect(testSubmits).toHaveLength(1);
    expect(testSubmits[0]![1]).toBe(userId);
    expect(testSubmits[0]![2]).toMatchObject({
      content_item_id: item,
      raw_score: 7,
      total: 10,
      mode: "mock",
    });
    // Ни одного проглоченного сбоя — эффекты СЛУЧИЛИСЬ, а не «упали в error_log».
    expect(await countRows("error_log", "true")).toBe(0);
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* §6: конкурентный referral reward → начисляется один раз                       */
/* ────────────────────────────────────────────────────────────────────────── */
describe("Конкурентный referral reward", () => {
  it("8 параллельных maybeRewardReferral(rated) → inviter +100, invitee +50, rewarded, ровно пара уведомлений", async () => {
    const inviter = await seedUser();
    const invitee = await seedUser();
    await seedReferral(inviter, invitee);

    await Promise.all(Array.from({ length: 8 }, () => maybeRewardReferral(invitee, true)));

    // Ровно один claim: status → rewarded, XP начислены по разу.
    const [ref] = await sql<{ status: string; reward: string | null }[]>`
      SELECT status, reward FROM referral WHERE invitee_id = ${invitee}`;
    expect(ref!.status).toBe("rewarded");
    expect(ref!.reward).toBe("xp:inviter=100,invitee=50");
    expect((await profileFacts(inviter)).xp).toBe(100);
    expect((await profileFacts(invitee)).xp).toBe(50);
    // Уведомления пишутся синхронно (не under after): ровно два, по одному на юзера.
    expect(await countRows("notification", "kind = 'referral'")).toBe(2);
    expect(await countRows("notification", "user_id = $1 AND kind = 'referral'", inviter)).toBe(1);
    expect(await countRows("notification", "user_id = $1 AND kind = 'referral'", invitee)).toBe(1);
    expect(await countRows("error_log", "true")).toBe(0);
  });

  it("rated=false НЕ сжигает строку: остаётся registered, позднейший rated её забирает", async () => {
    const inviter = await seedUser();
    const invitee = await seedUser();
    await seedReferral(inviter, invitee);

    await maybeRewardReferral(invitee, false); // too-fast/ретейк — награду не берём
    let [ref] = await sql<{ status: string }[]>`
      SELECT status FROM referral WHERE invitee_id = ${invitee}`;
    expect(ref!.status).toBe("registered"); // строка НЕ сгорела
    expect((await profileFacts(inviter)).xp).toBe(0);

    await maybeRewardReferral(invitee, true); // настоящий rated-сабмит
    [ref] = await sql<{ status: string }[]>`
      SELECT status FROM referral WHERE invitee_id = ${invitee}`;
    expect(ref!.status).toBe("rewarded");
    expect((await profileFacts(inviter)).xp).toBe(100);
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* §6: падение внутри транзакции → откат всех связанных записей                   */
/* ────────────────────────────────────────────────────────────────────────── */
describe("Откат транзакции при инъекции сбоя", () => {
  it("applyPostSubmit rated-путь: RAISE на UPDATE profile → difficulty/XP/rating/streak НЕ изменились, сбой в error_log", async () => {
    const userId = await seedUser();
    const item = await seedContent();
    const attemptId = await seedSubmittedAttempt(userId, item); // count submitted = 1 → rated

    const before = await profileFacts(userId);

    // Транзакция applyPostSubmit: обновляет content_item (difficulty), затем profile
    // → инъекция бросает на UPDATE profile → ВСЯ tx откатывается (обе таблицы).
    await sql.unsafe(INJECT_SQL.raiseOnProfileUpdate);
    const out = await applyPostSubmit({
      userId,
      contentItemId: item,
      attemptId,
      mode: "mock",
      rawScore: 5,
      total: 10,
      timeUsedSeconds: 1200,
      submittedAt: new Date(),
    });

    // best-effort: НЕ бросил, вернул fallback.
    expect(out.rated).toBe(false);
    // difficulty теста откатился (count 0, rating дефолт 1000).
    expect(
      await countRows("content_item", "id = $1 AND difficulty_count = 0 AND difficulty_rating = 1000", item),
    ).toBe(1);
    // profile нетронут: XP/rating/rated_count те же, streak не проставлен.
    const after = await profileFacts(userId);
    expect(after).toEqual(before);
    expect(await countRows("profile", "id = $1 AND last_activity_date IS NULL AND current_streak = 0", userId)).toBe(1);
    // Отличаем «откатилось» от «молча пропущено»: сбой ЗАФИКСИРОВАН.
    expect(await countRows("error_log", "message = 'applyPostSubmit failed'")).toBe(1);
  });

  it("finalizeSubmit: сбой прогрессии ПОСЛЕ claim → submitted сохранён, прогрессия скипнута, сбой в error_log", async () => {
    // Ревью-находка, зафиксированная как КОНТРАКТ, а не баг: claim
    // in_progress→submitted коммитится ДО транзакции applyPostSubmit — осознанный
    // best-effort дизайн (apply-post-submit.ts: «сбой прогрессии не должен терять
    // сабмит юзера»), существовавший и в инлайн-коде до экстракции. Реконсиляция
    // недоначисленной прогрессии сознательно не реализована; гарантия — сбой НЕ
    // теряется молча (error_log), а сабмит и разбор юзера переживают его.
    const userId = await seedUser();
    const item = await seedContent();
    const attemptId = await seedInProgressAttempt(userId, item);
    const before = await profileFacts(userId);

    await sql.unsafe(INJECT_SQL.raiseOnProfileUpdate);
    const out = await finalizeSubmit(finalizeInput(attemptId, userId, item));

    expect(out.claimed).toBe(true); // finalizeSubmit не бросил, claim пережил сбой
    expect(await countRows("attempt", "id = $1 AND status = 'submitted'", attemptId)).toBe(1);
    expect(await countRows("attempt_review_snapshot", "attempt_id = $1", attemptId)).toBe(1);
    // Прогрессия целиком откатилась: XP/rating/rated_count нетронуты.
    expect(await profileFacts(userId)).toEqual(before);
    // …и сбой наблюдаем — «деградировано», а не «потеряно молча».
    expect(await countRows("error_log", "message = 'applyPostSubmit failed'")).toBe(1);
  });

  it("startAttempt trial-путь: RAISE на INSERT attempt → ни trial_claim, ни attempt не появились", async () => {
    const userId = await seedUser();
    const item = await seedContent(true); // full_reading + premium → trial-лейн

    // Транзакция startAttempt (isTrial): profile FOR UPDATE → insert trial_claim →
    // cap-count → INSERT attempt (openNewAttempt) → инъекция бросает → tx откат.
    await sql.unsafe(INJECT_SQL.raiseOnAttemptInsert);
    const err = await startAttempt(userId, item, "practice", true, null, "basic").catch((e) => e);

    // Это реальный сбой БД (инъекция на INSERT attempt), НЕ redirect —
    // startAttempt транзакцию не оборачивает try/catch, ошибка пробрасывается.
    // (drizzle обёртывает pg-ошибку в «Failed query: insert into attempt…» — сам
    // факт проброса + откат ниже и есть доказательство атомарности.)
    expect(err).toBeInstanceOf(Error);
    expect(isNextRedirectError(err)).toBe(false);
    // trial_claim, вставленный ранее в ТОЙ ЖЕ транзакции, откатился вместе с attempt.
    expect(await countRows("trial_claim", "user_id = $1", userId)).toBe(0);
    expect(await countRows("attempt", "user_id = $1", userId)).toBe(0);
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* §6: порядок локов profile→content_item под нагрузкой → без deadlock            */
/* ────────────────────────────────────────────────────────────────────────── */
describe("Лок-порядок profile→content_item под нагрузкой", () => {
  // Известное ограничение (ревью, осознанно принято): Promise.all не гарантирует
  // фактического перекрытия транзакций — на «удачном» расписании сломанная
  // сериализация может пройти. Управляемый rendezvous-барьер (pg_sleep-триггеры)
  // отвергнут как машинерия с собственным флак-риском; компенсация — 10 раундов
  // × 4 конкурентных вызова за прогон и правило ×5-10 прогонов сьюта (гоча).
  it("10 раундов × 4 конкурентных (startAttempt+applyPostSubmit) → 0 deadlock, счётчики сходятся", async () => {
    const userId = await seedUser();
    const items = await Promise.all([seedContent(), seedContent(), seedContent()]);
    // По одной submitted-попытке на item → applyPostSubmit каждый раз rated
    // (count submitted = 1; applyPostSubmit НЕ вставляет attempt, только читает count).
    for (const it of items) await seedSubmittedAttempt(userId, it);

    const ROUNDS = 10;
    let applyCalls = 0;
    const failures: unknown[] = [];

    for (let r = 0; r < ROUNDS; r++) {
      // 2 applyPostSubmit + 2 startAttempt — оба лочат profile→content_item в ОДНОМ
      // порядке; startAttempt basic упрётся в кап и будет редиректить (это норм,
      // всё равно берёт profile-лок первым — стресс порядка сохраняется).
      applyCalls += 2;
      const ops: Promise<unknown>[] = [
        applyPostSubmit({
          userId, contentItemId: items[0]!, attemptId: `${r}-a`,
          mode: "mock", rawScore: 5, total: 10, timeUsedSeconds: 1200, submittedAt: new Date(),
        }),
        applyPostSubmit({
          userId, contentItemId: items[1]!, attemptId: `${r}-b`,
          mode: "mock", rawScore: 5, total: 10, timeUsedSeconds: 1200, submittedAt: new Date(),
        }),
        startAttempt(userId, items[2]!, "practice", false, null, "basic"),
        startAttempt(userId, items[0]!, "practice", false, null, "basic"),
      ];
      const settled = await Promise.allSettled(ops);
      for (const s of settled) {
        if (s.status === "rejected" && !isNextRedirectError(s.reason)) failures.push(s.reason);
      }
    }

    // Ни одной ошибки deadlock_detected (40P01) — код ищем с разворотом cause
    // (Drizzle-обёртка), и НИКАКИХ прочих неожиданных ошибок: любая (deadlock,
    // timeout, constraint) красит тест со своим текстом. Проглоченные
    // applyPostSubmit'ом сбои ловим отдельно через error_log.
    expect(failures.filter((e) => pgCode(e) === "40P01")).toHaveLength(0);
    expect(failures.map((e) => String(e))).toEqual([]);
    expect(await countRows("error_log", "message = 'applyPostSubmit failed'")).toBe(0);

    // Счётчики сходятся: каждый applyPostSubmit был rated и сериализован под
    // profile-локом → ratedCount и XP выросли РОВНО applyCalls раз (без lost update).
    const facts = await profileFacts(userId);
    expect(facts.ratedCount).toBe(applyCalls); // 20
    expect(facts.xp).toBe(applyCalls * (10 + 5)); // 20 * 15 = 300
  });
});
