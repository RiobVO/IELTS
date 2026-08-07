import { afterAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";

/**
 * Откуда студенческий бот берёт «вопрос дня» — на реальной БД.
 *
 * ПОЧЕМУ ЭТО ВАЖНО ПРОВЕРИТЬ ИМЕННО ТАК. Раньше вопрос читался из mistake_review,
 * а она наполняется ТОЛЬКО когда человек руками разбирает ошибки на сайте. На проде
 * в ней лежало 2 строки от одного юзера при 75 сданных попытках от двенадцати —
 * то есть для новичка, который просто сдал тест, бот был нем. Тест ловит эту
 * регрессию в лоб: попытка есть, mistake_review пуст — вопрос обязан найтись.
 *
 * Второй инвариант — SM-2 остаётся главным по срокам: ошибка, повторённая на сайте
 * и запланированная на будущее, в чат раньше времени не уходит.
 */
import { pickDailyQuestion } from "@/lib/telegram/student/daily-question";

const sql = postgres(process.env.VERIFY_DATABASE_URL!, {
  max: 1,
  onnotice: () => {},
});

let seq = 0;

async function seedUser(): Promise<string> {
  seq++;
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO auth.users (email) VALUES (${`tg-daily-${seq}@test.local`})
    RETURNING id`;
  return row!.id;
}

interface SeededTest {
  contentItemId: string;
  questionNumber: number;
}

/** Опубликованный тест с одним вопросом и ключом. */
async function seedTest(
  opts: {
    status?: "draft" | "published";
    prompt?: string;
    accept?: string;
    qtype?: string;
  } = {},
): Promise<SeededTest> {
  seq++;
  const [item] = await sql<{ id: string }[]>`
    INSERT INTO content_item (section, category, title, band_type, status)
    VALUES ('reading', 'passage_1', ${`Daily ${seq}`}, 'reading_academic',
            ${opts.status ?? "published"})
    RETURNING id`;
  const [p] = await sql<{ id: string }[]>`
    INSERT INTO passage (content_item_id, "order", body_html)
    VALUES (${item!.id}, 1, '<p>body</p>') RETURNING id`;
  const [q] = await sql<{ id: string }[]>`
    INSERT INTO question (content_item_id, passage_id, number, qtype, prompt_html, "order")
    VALUES (${item!.id}, ${p!.id}, 1, ${opts.qtype ?? "tfng"}::question_type,
            ${opts.prompt ?? "<p>The bird is a symbol of the nation.</p>"}, 1)
    RETURNING id`;
  await sql`
    INSERT INTO answer_key (question_id, mode, accept)
    VALUES (${q!.id}, 'exact', ${sql.json([opts.accept ?? "TRUE"])})`;
  return { contentItemId: item!.id, questionNumber: 1 };
}

/**
 * Сданная попытка с НЕВЕРНЫМ ответом на вопрос 1 + review-снимок (D3). Снимок
 * обязателен: getOpenMistakes джойнит его inner join'ом, попытки без него —
 * legacy и в разбор не попадают.
 */
async function seedWrongAttempt(
  userId: string,
  t: SeededTest,
  opts: { accept?: string; submittedAt?: string; qtype?: string } = {},
): Promise<void> {
  const [a] = await sql<{ id: string }[]>`
    INSERT INTO attempt (user_id, content_item_id, mode, status, started_at, submitted_at, answers)
    VALUES (${userId}, ${t.contentItemId}, 'practice', 'submitted', now(),
            ${opts.submittedAt ? sql`${opts.submittedAt}::timestamptz` : sql`now()`},
            ${sql.json({ "1": "FALSE" })})
    RETURNING id`;
  await sql`
    INSERT INTO attempt_review_snapshot (attempt_id, snapshot)
    VALUES (${a!.id}, ${sql.json({
      questions: [
        {
          number: 1,
          qtype: opts.qtype ?? "tfng",
          mode: "exact",
          accept: [opts.accept ?? "TRUE"],
        },
      ],
    })})`;
}

beforeEach(async () => {
  await sql`TRUNCATE auth.users CASCADE`;
  await sql`TRUNCATE content_item CASCADE`;
});

afterAll(async () => {
  await sql.end({ timeout: 5 });
});

describe("pickDailyQuestion — источник вопроса", () => {
  it("берёт ошибку из СДАННОЙ попытки, даже когда mistake_review пуст", async () => {
    const userId = await seedUser();
    const t = await seedTest();
    await seedWrongAttempt(userId, t);

    const { question, dueTotal } = await pickDailyQuestion(userId);

    expect(question).not.toBeNull();
    expect(question!.contentItemId).toBe(t.contentItemId);
    expect(question!.questionNumber).toBe(1);
    expect(question!.prompt).toBe("The bird is a symbol of the nation.");
    expect(question!.options).toBeNull();
    expect(dueTotal).toBe(1);
  });

  it("нерешаемый в чате тип не спрашивается, но и не прячется: due-счётчик его видит", async () => {
    const userId = await seedUser();
    const t = await seedTest({ qtype: "matching_headings", prompt: "<p>Paragraph A</p>" });
    await seedWrongAttempt(userId, t, { qtype: "matching_headings" });

    const { question, dueTotal } = await pickDailyQuestion(userId);

    expect(question).toBeNull();
    expect(dueTotal).toBe(1); // повод написать «это на сайте» вместо молчания
  });

  it("верный ответ вопросом дня не становится", async () => {
    const userId = await seedUser();
    const t = await seedTest({ accept: "FALSE" }); // попытка отвечает FALSE
    await seedWrongAttempt(userId, t, { accept: "FALSE" });

    expect((await pickDailyQuestion(userId)).question).toBeNull();
  });

  it("чужие ошибки не спрашиваются", async () => {
    const owner = await seedUser();
    const stranger = await seedUser();
    const t = await seedTest();
    await seedWrongAttempt(owner, t);

    expect((await pickDailyQuestion(stranger)).question).toBeNull();
  });

  it("снятый с публикации тест не спрашивается", async () => {
    const userId = await seedUser();
    const t = await seedTest({ status: "draft" });
    await seedWrongAttempt(userId, t);

    expect((await pickDailyQuestion(userId)).question).toBeNull();
  });

  it("вопрос с пустой формулировкой не уходит в чат", async () => {
    const userId = await seedUser();
    const t = await seedTest({ prompt: "<p></p>" });
    await seedWrongAttempt(userId, t);

    expect((await pickDailyQuestion(userId)).question).toBeNull();
  });

  it("отработанную ошибку («Mark learned») не переспрашивает", async () => {
    const userId = await seedUser();
    const t = await seedTest();
    await seedWrongAttempt(userId, t, { submittedAt: "2026-01-01T00:00:00Z" });
    await sql`
      INSERT INTO mistake_resolution
        (user_id, content_item_id, question_number, qtype, resolved_at)
      VALUES (${userId}, ${t.contentItemId}, 1, 'tfng', now())`;

    expect((await pickDailyQuestion(userId)).question).toBeNull();
  });

  it("SM-2 остаётся главным по срокам: запланированное на будущее не спрашивается", async () => {
    const userId = await seedUser();
    const t = await seedTest();
    await seedWrongAttempt(userId, t, { submittedAt: "2026-01-01T00:00:00Z" });
    // Повторено на сайте ПОСЛЕ попытки и назначено на будущее — расписание валидно.
    await sql`
      INSERT INTO mistake_review
        (user_id, content_item_id, question_number, qtype, due_at, interval_days,
         last_reviewed_at)
      VALUES (${userId}, ${t.contentItemId}, 1, 'tfng', now() + interval '3 days', 3, now())`;

    expect((await pickDailyQuestion(userId)).question).toBeNull();
  });

  it("просроченное по SM-2 спрашивается", async () => {
    const userId = await seedUser();
    const t = await seedTest();
    await seedWrongAttempt(userId, t, { submittedAt: "2026-01-01T00:00:00Z" });
    await sql`
      INSERT INTO mistake_review
        (user_id, content_item_id, question_number, qtype, due_at, interval_days,
         last_reviewed_at)
      VALUES (${userId}, ${t.contentItemId}, 1, 'tfng', now() - interval '1 day', 3,
              '2026-01-02T00:00:00Z')`;

    expect((await pickDailyQuestion(userId)).question).not.toBeNull();
  });
});
