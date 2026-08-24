import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";

/**
 * Физическое удаление драфта (deleteDraftContentItem, src/lib/content/delete.ts) —
 * реальная транзакция на throwaway нативном PG, тот же харнесс, что attempts.db.test.ts.
 *
 * revalidateTag вне Next request-scope бросает ("Invariant: static generation store
 * missing") — мокаем next/cache, как unit-тест publish.ts мокает его для той же функции
 * семейства (publish.test.ts). Мок живёт только в этом файле (vitest изолирует граф
 * модулей по тест-файлу), не задевает attempts.db.test.ts/next/server-мок.
 */
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

import { deleteDraftContentItem } from "@/lib/content/delete";
import { db } from "@/db";

// Свой raw-клиент для сида/инспекции — ОТДЕЛЬНО от app-пула @/db под тестом
// (тот же приём, что attempts.db.test.ts / verify.ts). max:2 (не 1, как в
// attempts.db.test.ts) — race-тест ниже держит СОЕДИНЕНИЕ №1 через sql.reserve()
// (незакоммиченная BEGIN-транзакция) и ОДНОВРЕМЕННО опрашивает pg_stat_activity
// через сам `sql` (соединение №2); с max:1 второй запрос ждал бы свободного
// соединения вечно (сам себя дедлочит).
const sql = postgres(process.env.VERIFY_DATABASE_URL!, {
  max: 2,
  onnotice: () => {},
});

let seq = 0;

/** INSERT в auth.users — profile создаёт SECURITY DEFINER триггер миграции 0002. */
async function seedUser(): Promise<string> {
  seq++;
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO auth.users (email) VALUES (${`delete-${seq}@test.local`})
    RETURNING id`;
  return row!.id;
}

/**
 * content_item + одна passage + один question (проверить каскад на удалении).
 * status по умолчанию 'draft'.
 */
async function seedContentWithQuestion(status: "draft" | "published" = "draft"): Promise<{
  contentItemId: string;
  passageId: string;
  questionId: string;
}> {
  seq++;
  const [item] = await sql<{ id: string }[]>`
    INSERT INTO content_item (section, category, title, band_type, status)
    VALUES ('reading', 'passage_1', ${`T-${seq}`}, 'reading_academic', ${status})
    RETURNING id`;
  const [passage] = await sql<{ id: string }[]>`
    INSERT INTO passage (content_item_id, "order", body_html)
    VALUES (${item!.id}, 1, '<p>body</p>')
    RETURNING id`;
  const [question] = await sql<{ id: string }[]>`
    INSERT INTO question (content_item_id, passage_id, number, qtype, prompt_html, "order")
    VALUES (${item!.id}, ${passage!.id}, 1, 'tfng', '<p>Q1</p>', 1)
    RETURNING id`;
  return { contentItemId: item!.id, passageId: passage!.id, questionId: question!.id };
}

async function seedInProgressAttempt(userId: string, contentItemId: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO attempt (user_id, content_item_id, mode, status, started_at)
    VALUES (${userId}, ${contentItemId}, 'mock', 'in_progress', now())
    RETURNING id`;
  return row!.id;
}

async function countRows(table: string, where: string, ...params: unknown[]): Promise<number> {
  const [row] = await sql.unsafe<{ n: number }[]>(
    `SELECT count(*)::int AS n FROM ${table} WHERE ${where}`,
    params as never[],
  );
  return row!.n;
}

/**
 * Не полагаемся на sleep как на доказательство порядка: poll'им pg_stat_activity,
 * пока где-то не появится реально ЗАБЛОКИРОВАННЫЙ (wait_event_type='Lock') запрос
 * к content_item — это и есть SELECT ... FOR UPDATE deleteDraftContentItem, вставший
 * в очередь на row-лок. Таймаут → бросаем громко (гонка не воспроизвелась, тест
 * недостоверен), а не молча проезжаем дальше.
 */
async function waitForLockWait(timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [row] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE wait_event_type = 'Lock' AND query ILIKE '%content_item%'`;
    if (row!.n > 0) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("timed out waiting for deleteDraftContentItem to block on the content_item FOR UPDATE lock");
}

beforeEach(async () => {
  // Полный чистый лист: TRUNCATE auth.users каскадом сносит profile → attempt;
  // content_item каскадом сносит passage/question/answer_key (+ остаточный attempt).
  await sql`TRUNCATE auth.users, content_item CASCADE`;
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

describe("deleteDraftContentItem", () => {
  it("драфт без attempts → ok:true, content_item удалён, question каскадом тоже", async () => {
    const { contentItemId, questionId } = await seedContentWithQuestion("draft");

    const res = await deleteDraftContentItem(contentItemId);

    expect(res).toEqual({ ok: true, title: expect.any(String) });
    expect(await countRows("content_item", "id = $1", contentItemId)).toBe(0);
    expect(await countRows("question", "id = $1", questionId)).toBe(0);
  });

  it("published → ok:false has reason 'published', строка на месте", async () => {
    const { contentItemId } = await seedContentWithQuestion("published");

    const res = await deleteDraftContentItem(contentItemId);

    expect(res).toEqual({ ok: false, reason: "published" });
    expect(await countRows("content_item", "id = $1", contentItemId)).toBe(1);
  });

  it("драфт с одним attempt → ok:false 'has_attempts', строка и attempt на месте", async () => {
    const userId = await seedUser();
    const { contentItemId } = await seedContentWithQuestion("draft");
    const attemptId = await seedInProgressAttempt(userId, contentItemId);

    const res = await deleteDraftContentItem(contentItemId);

    expect(res).toEqual({ ok: false, reason: "has_attempts" });
    expect(await countRows("content_item", "id = $1", contentItemId)).toBe(1);
    expect(await countRows("attempt", "id = $1", attemptId)).toBe(1);
  });

  it("несуществующий id → ok:false 'not_found'", async () => {
    const res = await deleteDraftContentItem("00000000-0000-0000-0000-000000000000");

    expect(res).toEqual({ ok: false, reason: "not_found" });
  });

  /**
   * Race-репродукция (Codex-ревью, MVCC под READ COMMITTED, подтверждённый блокер):
   * незакоммиченный INSERT в attempt на ОТДЕЛЬНОМ соединении держит KEY SHARE на
   * строке content_item (FK-триггер). Управляем таймингом руками через reserved-
   * соединение (BEGIN + INSERT без коммита) — без FOR UPDATE в deleteDraftContentItem
   * DELETE-стейтмент решил бы "attempts нет" по своему снапшоту ДО чужого коммита и
   * снёс бы тест вместе со свежей попыткой. С FOR UPDATE наш SELECT блокируется на
   * конфликте с KEY SHARE (ждём waitForLockWait, не гадаем по времени), коммитим
   * reserved-транзакцию, и следующий стейтмент (DELETE) внутри той же tx получает
   * свежий снапшот, видящий закоммиченный attempt → has_attempts, ничего не удалено.
   */
  it("гонка: attempt коммитится, пока delete ждёт FOR UPDATE лок → has_attempts, обе строки на месте", async () => {
    const userId = await seedUser();
    const { contentItemId } = await seedContentWithQuestion("draft");

    const reserved = await sql.reserve();
    try {
      await reserved.unsafe("BEGIN");
      await reserved`
        INSERT INTO attempt (user_id, content_item_id, mode, status, started_at)
        VALUES (${userId}, ${contentItemId}, 'mock', 'in_progress', now())`;
      // Незакоммиченный INSERT — content_item ещё держит только KEY SHARE, delete
      // ниже стартует и блокируется на конфликте с ним.

      const deletePromise = deleteDraftContentItem(contentItemId);
      await waitForLockWait(); // deleteDraftContentItem реально встал на лок

      await reserved.unsafe("COMMIT");

      const res = await deletePromise;
      expect(res).toEqual({ ok: false, reason: "has_attempts" });
      expect(await countRows("content_item", "id = $1", contentItemId)).toBe(1);
      expect(await countRows("attempt", "content_item_id = $1", contentItemId)).toBe(1);
    } finally {
      // release() НЕ откатывает открытую транзакцию — если тест упал до COMMIT,
      // явный ROLLBACK не даёт незакрытой tx утечь в следующий тест (после
      // успешного COMMIT это просто WARNING, не ошибка; onnotice заглушен).
      await reserved.unsafe("ROLLBACK");
      reserved.release();
    }
  });
});
