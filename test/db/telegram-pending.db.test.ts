import { afterAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";

/**
 * Инвариант «один ответ на вопрос» студенческого бота — на РЕАЛЬНОЙ транзакции
 * throwaway нативного PG (тот же харнесс, что attempts.db.test.ts).
 *
 * ПОЧЕМУ НЕ ЮНИТ. takePendingQuestion — единственная точка, где решается, имеет ли
 * нажатие право на вердикт. Мок-тест запинил бы результат запроса и доказал бы
 * ровно ничего: обе ошибки, которые здесь ловятся, живут в семантике PostgreSQL,
 * а не в ветвлениях JS.
 *   1. `UPDATE ... RETURNING` отдаёт значения ПОСЛЕ записи — а запись как раз
 *      обнуляет pending-поля, поэтому клейм всегда возвращал пусто (прод, 2026-08-06:
 *      бот молча съедал текстовые ответы, а через кнопочный путь — и нажатия).
 *   2. Два одновременных нажатия обязаны разойтись в ОДИН вердикт: иначе правильный
 *      ответ вскрывается перебором кнопок.
 * Оба проверяются только настоящим движком.
 */
import { setPendingQuestion, takePendingQuestion } from "@/lib/telegram/student/store";

// Свой raw-клиент для сида/инспекции — ОТДЕЛЬНО от app-пула @/db под тестом
// (приём attempts.db.test.ts / content-delete.db.test.ts). max:1 — сид последователен.
const sql = postgres(process.env.VERIFY_DATABASE_URL!, {
  max: 1,
  onnotice: () => {},
});

let seq = 0;

/** INSERT в auth.users — profile создаёт SECURITY DEFINER триггер миграции 0002. */
async function seedUser(): Promise<string> {
  seq++;
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO auth.users (email) VALUES (${`tg-pending-${seq}@test.local`})
    RETURNING id`;
  return row!.id;
}

async function seedContentItem(): Promise<string> {
  seq++;
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO content_item (section, category, title, band_type, status)
    VALUES ('reading', 'passage_1', ${`TG-${seq}`}, 'reading_academic', 'published')
    RETURNING id`;
  return row!.id;
}

/** Связанный чат без ожидания ответа — стартовое состояние всех тестов. */
async function seedLink(userId: string): Promise<void> {
  seq++;
  await sql`
    INSERT INTO telegram_link (user_id, chat_id, linked_at)
    VALUES (${userId}, ${1_000_000 + seq}, now())`;
}

async function readPending(userId: string): Promise<{
  content: string | null;
  number: number | null;
  askedAt: Date | null;
}> {
  const [row] = await sql<
    { pending_content_item_id: string | null; pending_question_number: number | null; pending_asked_at: Date | null }[]
  >`
    SELECT pending_content_item_id, pending_question_number, pending_asked_at
    FROM telegram_link WHERE user_id = ${userId}`;
  return {
    content: row!.pending_content_item_id,
    number: row!.pending_question_number,
    askedAt: row!.pending_asked_at,
  };
}

beforeEach(async () => {
  // auth.users каскадит в profile → telegram_link; content_item отдельно.
  await sql`TRUNCATE auth.users CASCADE`;
  await sql`TRUNCATE content_item CASCADE`;
});

afterAll(async () => {
  await sql.end({ timeout: 5 });
});

describe("takePendingQuestion — заявка на ответ", () => {
  it("возвращает ИМЕННО тот вопрос, который был поставлен", async () => {
    const userId = await seedUser();
    const contentItemId = await seedContentItem();
    await seedLink(userId);
    await setPendingQuestion(userId, contentItemId, 7);

    const claimed = await takePendingQuestion(userId);

    expect(claimed).toEqual({ contentItemId, questionNumber: 7 });
  });

  it("гасит ожидание: после клейма строка чиста", async () => {
    const userId = await seedUser();
    const contentItemId = await seedContentItem();
    await seedLink(userId);
    await setPendingQuestion(userId, contentItemId, 3);

    await takePendingQuestion(userId);

    expect(await readPending(userId)).toEqual({ content: null, number: null, askedAt: null });
  });

  it("повторный клейм пуст — второй ответ на тот же вопрос вердикта не даёт", async () => {
    const userId = await seedUser();
    const contentItemId = await seedContentItem();
    await seedLink(userId);
    await setPendingQuestion(userId, contentItemId, 12);

    const first = await takePendingQuestion(userId);
    const second = await takePendingQuestion(userId);

    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it("без ожидания — null (свободный текст не считается ответом)", async () => {
    const userId = await seedUser();
    await seedLink(userId);

    expect(await takePendingQuestion(userId)).toBeNull();
  });

  it("несвязанный аккаунт не роняет клейм", async () => {
    const userId = await seedUser();

    expect(await takePendingQuestion(userId)).toBeNull();
  });

  /**
   * СЕРДЦЕ ТЕСТА. Пять одновременных нажатий по кнопкам одного вопроса: право на
   * вердикт обязано достаться РОВНО ОДНОМУ. Больше одного = правильный ответ
   * вскрывается перебором; ноль = бот съел ответ (ровно то, что было на проде).
   */
  it("пять одновременных клеймов → ровно один вердикт", async () => {
    const userId = await seedUser();
    const contentItemId = await seedContentItem();
    await seedLink(userId);
    await setPendingQuestion(userId, contentItemId, 21);

    const results = await Promise.all(
      Array.from({ length: 5 }, () => takePendingQuestion(userId)),
    );

    const winners = results.filter((r) => r !== null);
    expect(winners).toHaveLength(1);
    expect(winners[0]).toEqual({ contentItemId, questionNumber: 21 });
    expect(await readPending(userId)).toEqual({ content: null, number: null, askedAt: null });
  });

  it("нажатие на тот же вопрос забирает его", async () => {
    const userId = await seedUser();
    const contentItemId = await seedContentItem();
    await seedLink(userId);
    await setPendingQuestion(userId, contentItemId, 5);

    expect(await takePendingQuestion(userId, { contentItemId, questionNumber: 5 })).toEqual({
      contentItemId,
      questionNumber: 5,
    });
  });

  /**
   * Вчерашний вопрос остаётся в переписке с живыми кнопками. Тап по нему НЕ должен
   * списывать право ответить на сегодняшний — иначе одно любопытное нажатие по
   * истории молча съедает актуальный вопрос.
   */
  it("нажатие на ЧУЖОЙ вопрос не трогает текущее ожидание", async () => {
    const userId = await seedUser();
    const today = await seedContentItem();
    const yesterday = await seedContentItem();
    await seedLink(userId);
    await setPendingQuestion(userId, today, 9);

    const stale = await takePendingQuestion(userId, {
      contentItemId: yesterday,
      questionNumber: 3,
    });
    expect(stale).toBeNull();

    // Сегодняшний вопрос по-прежнему ждёт ответа.
    expect(await takePendingQuestion(userId, { contentItemId: today, questionNumber: 9 })).toEqual({
      contentItemId: today,
      questionNumber: 9,
    });
  });

  it("тот же тест, но другой номер вопроса — тоже не наш клейм", async () => {
    const userId = await seedUser();
    const contentItemId = await seedContentItem();
    await seedLink(userId);
    await setPendingQuestion(userId, contentItemId, 9);

    expect(await takePendingQuestion(userId, { contentItemId, questionNumber: 8 })).toBeNull();
    expect(await readPending(userId)).toMatchObject({ number: 9 });
  });

  /**
   * Клеймы РАЗНЫХ юзеров не должны сериализоваться друг о друга: лок берётся по
   * своей строке, иначе вечерняя рассылка на 300 чатов встала бы в очередь.
   */
  it("клеймы разных аккаунтов независимы", async () => {
    const contentItemId = await seedContentItem();
    const a = await seedUser();
    const b = await seedUser();
    await seedLink(a);
    await seedLink(b);
    await setPendingQuestion(a, contentItemId, 1);
    await setPendingQuestion(b, contentItemId, 2);

    const [ra, rb] = await Promise.all([takePendingQuestion(a), takePendingQuestion(b)]);

    expect(ra).toEqual({ contentItemId, questionNumber: 1 });
    expect(rb).toEqual({ contentItemId, questionNumber: 2 });
  });
});
