import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { db } from "@/db";
import { listMigrations } from "../../scripts/migrate.ts";

/**
 * Волна 1.5, пакет C (TESTING_PLAN §6, блок «Схема»): constraints/функции/
 * триггеры реальной SQL-схемы на throwaway нативном PG. globalSetup уже
 * доказывает «миграции с нуля + последовательное применение» (полный
 * migrateUp на чистой схеме перед каждым прогоном) — здесь только точечные
 * инварианты: partial unique 0007, UNIQUE 0053/0054, auth-триггеры 0002/0005,
 * FK ON DELETE-контракты, CHECK-constraints. UNIQUE(provider,
 * provider_transaction_id) уже закрыт test/db/payments.db.test.ts — не
 * дублируется здесь.
 */

// Свой raw-клиент для сида/инспекции — ОТДЕЛЬНО от app-пула @/db под тестом
// (тот же приём, что payments.db.test.ts / verify.ts).
const sql = postgres(process.env.VERIFY_DATABASE_URL!, {
  max: 1,
  onnotice: () => {},
});

let userSeq = 0;

/** INSERT в auth.users — profile создаёт SECURITY DEFINER триггер миграции 0002. */
async function seedUser(metaData: Record<string, string> = {}): Promise<string> {
  userSeq++;
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO auth.users (email, raw_user_meta_data)
    VALUES (${`dbtest-${userSeq}@test.local`}, ${sql.json(metaData)})
    RETURNING id`;
  return row!.id;
}

async function profileRow(userId: string): Promise<{
  tier: string;
  role: string;
  rating: number;
  referralCode: string;
  referredBy: string | null;
} | null> {
  const [row] = await sql<
    { tier: string; role: string; rating: number; referral_code: string; referred_by: string | null }[]
  >`SELECT tier, role, rating, referral_code, referred_by FROM profile WHERE id = ${userId}`;
  if (!row) return null;
  return {
    tier: row.tier,
    role: row.role,
    rating: row.rating,
    referralCode: row.referral_code,
    referredBy: row.referred_by,
  };
}

async function seedContentItem(): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO content_item (section, category, title, band_type)
    VALUES ('reading', 'passage_1', 'dbtest item', 'reading_academic')
    RETURNING id`;
  return row!.id;
}

let seq = 0;

async function seedInProgressAttempt(userId: string, contentItemId: string): Promise<string> {
  seq++;
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO attempt (user_id, content_item_id, mode, status)
    VALUES (${userId}, ${contentItemId}, 'mock', 'in_progress')
    RETURNING id`;
  return row!.id;
}

beforeEach(async () => {
  // Полный чистый лист: TRUNCATE auth.users каскадом сносит profile → attempt/
  // referral/trial_claim/payment; content_item отдельно (не FK-зависим от юзера).
  await sql`TRUNCATE auth.users, content_item, error_log CASCADE`;
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

describe("триггер 0002/0005: auto-provision profile на INSERT в auth.users", () => {
  it("INSERT в auth.users → появляется profile с дефолтами (tier=basic, role=student, rating=1000)", async () => {
    const userId = await seedUser();
    const profile = await profileRow(userId);
    expect(profile).not.toBeNull();
    expect(profile!.tier).toBe("basic");
    expect(profile!.role).toBe("student");
    expect(profile!.rating).toBe(1000);
    expect(profile!.referralCode).toBeTruthy();
  });

  it("DELETE auth.users каскадит на profile (0000_init: profile.id REFERENCES auth.users ON DELETE CASCADE)", async () => {
    const userId = await seedUser();
    expect(await profileRow(userId)).not.toBeNull();

    await sql`DELETE FROM auth.users WHERE id = ${userId}`;

    expect(await profileRow(userId)).toBeNull();
  });

  it("referral-линковка: signup с валидным ref_code инвайтера → referral(status=registered) + profile.referred_by", async () => {
    const inviterId = await seedUser();
    const inviterProfile = await profileRow(inviterId);
    const inviteeId = await seedUser({ ref_code: inviterProfile!.referralCode });

    const inviteeProfile = await profileRow(inviteeId);
    expect(inviteeProfile!.referredBy).toBe(inviterId);

    const [ref] = await sql<{ status: string; inviter_id: string }[]>`
      SELECT status, inviter_id FROM referral WHERE invitee_id = ${inviteeId}`;
    expect(ref?.status).toBe("registered");
    expect(ref?.inviter_id).toBe(inviterId);
  });

  it("несуществующий ref_code → линковки нет, signup НЕ падает (profile создан)", async () => {
    // Покрывает и self-referral: handle_new_user резолвит ref_code ДО инсёрта
    // самого профиля, поэтому собственный код на signup структурно не существует
    // и резолвится как unknown — отдельного достижимого self-кейса нет (ревью:
    // прежний «self-referral»-тест был дублем этого). Guard `v_inviter = NEW.id`
    // в 0005 — защитная глубина на гипотетический replay, триггером недостижим.
    const userId = await seedUser({ ref_code: "NOPE-NO-SUCH-CODE" });
    const profile = await profileRow(userId);
    expect(profile).not.toBeNull();
    expect(profile!.referredBy).toBeNull();
    const [ref] = await sql<{ id: string }[]>`
      SELECT id FROM referral WHERE invitee_id = ${userId}`;
    expect(ref).toBeUndefined();
  });
});

describe("0007: partial unique index — не более одной in_progress-попытки на (user, content_item)", () => {
  it("второй in_progress на ту же пару → 23505", async () => {
    const userId = await seedUser();
    const itemId = await seedContentItem();
    await seedInProgressAttempt(userId, itemId);

    await expect(seedInProgressAttempt(userId, itemId)).rejects.toMatchObject({
      code: "23505",
    });
  });

  it("после перевода первой попытки в submitted — новый in_progress вставляется свободно", async () => {
    const userId = await seedUser();
    const itemId = await seedContentItem();
    const firstId = await seedInProgressAttempt(userId, itemId);

    await sql`UPDATE attempt SET status = 'submitted' WHERE id = ${firstId}`;

    await expect(seedInProgressAttempt(userId, itemId)).resolves.toEqual(
      expect.any(String),
    );
  });
});

describe("0053: UNIQUE(invitee_id) на referral", () => {
  it("второй referral-ряд на того же invitee → 23505", async () => {
    const inviter1 = await seedUser();
    const inviter2 = await seedUser();
    const invitee = await seedUser();

    await sql`
      INSERT INTO referral (inviter_id, invitee_id, code, status)
      VALUES (${inviter1}, ${invitee}, 'DBTEST-CODE-1', 'registered')`;

    await expect(
      sql`
        INSERT INTO referral (inviter_id, invitee_id, code, status)
        VALUES (${inviter2}, ${invitee}, 'DBTEST-CODE-2', 'registered')`,
    ).rejects.toMatchObject({ code: "23505" });
  });
});

describe("0054: trial_claim PRIMARY KEY(user_id)", () => {
  it("второй claim того же юзера → 23505", async () => {
    const userId = await seedUser();
    const itemId = await seedContentItem();
    const item2Id = await seedContentItem();

    await sql`INSERT INTO trial_claim (user_id, content_item_id) VALUES (${userId}, ${itemId})`;

    await expect(
      sql`INSERT INTO trial_claim (user_id, content_item_id) VALUES (${userId}, ${item2Id})`,
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("ON DELETE CASCADE content_item_id (0054): удаление теста освобождает claim", async () => {
    const userId = await seedUser();
    const itemId = await seedContentItem();
    await sql`INSERT INTO trial_claim (user_id, content_item_id) VALUES (${userId}, ${itemId})`;

    await sql`DELETE FROM content_item WHERE id = ${itemId}`;

    const [row] = await sql<{ user_id: string }[]>`
      SELECT user_id FROM trial_claim WHERE user_id = ${userId}`;
    expect(row).toBeUndefined();
  });
});

describe("FK-инварианты", () => {
  it("attempt с несуществующим user_id → 23503", async () => {
    const itemId = await seedContentItem();
    await expect(
      sql`INSERT INTO attempt (user_id, content_item_id, mode, status)
        VALUES (${randomUUID()}, ${itemId}, 'mock', 'in_progress')`,
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("attempt с несуществующим content_item_id → 23503", async () => {
    const userId = await seedUser();
    await expect(
      sql`INSERT INTO attempt (user_id, content_item_id, mode, status)
        VALUES (${userId}, ${randomUUID()}, 'mock', 'in_progress')`,
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("payment.user_id FK: несуществующий юзер → 23503", async () => {
    await expect(
      sql`INSERT INTO payment
          (user_id, provider, provider_transaction_id, tier, period_months, amount, currency)
        VALUES (${randomUUID()}, 'payme', 'dbtest_fk_tx', 'premium', 1, 100000, 'UZS')`,
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("ON DELETE CASCADE content_item_id (0000_init: attempt.content_item_id → content_item): удаление теста сносит попытку", async () => {
    const userId = await seedUser();
    const itemId = await seedContentItem();
    const attemptId = await seedInProgressAttempt(userId, itemId);

    await sql`DELETE FROM content_item WHERE id = ${itemId}`;

    const [row] = await sql<{ id: string }[]>`SELECT id FROM attempt WHERE id = ${attemptId}`;
    expect(row).toBeUndefined();
  });

  it("ON DELETE CASCADE user_id (0000_init: attempt.user_id → profile): удаление юзера сносит попытку", async () => {
    const userId = await seedUser();
    const itemId = await seedContentItem();
    const attemptId = await seedInProgressAttempt(userId, itemId);

    await sql`DELETE FROM auth.users WHERE id = ${userId}`;

    const [row] = await sql<{ id: string }[]>`SELECT id FROM attempt WHERE id = ${attemptId}`;
    expect(row).toBeUndefined();
  });
});

describe("CHECK-constraints", () => {
  it("speaking_task.difficulty (0031): значение вне {1,2,3} → 23514", async () => {
    await expect(
      sql`
        INSERT INTO speaking_task (prompt, bullets, closing_prompt, difficulty)
        VALUES ('dbtest prompt', '[]'::jsonb, 'dbtest closing', 5)`,
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("writing_task.difficulty (0025): значение вне {1,2,3} → 23514", async () => {
    await expect(
      sql`INSERT INTO writing_task (category, prompt, difficulty) VALUES ('academic', 'dbtest prompt', 0)`,
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("writing_task.topic (0025): значение вне разрешённого набора → 23514", async () => {
    await expect(
      sql`INSERT INTO writing_task (category, prompt, topic) VALUES ('academic', 'dbtest prompt', 'not-a-real-topic')`,
    ).rejects.toMatchObject({ code: "23514" });
  });
});

describe("реестр миграций", () => {
  it("_migrations содержит ровно по одной строке на каждую миграцию из listMigrations() — дрейф набора красный", async () => {
    const names = listMigrations();

    const rows = await sql<{ name: string }[]>`SELECT name FROM _migrations`;

    expect(rows.map((r) => r.name).sort()).toEqual([...names].sort());
  });
});
