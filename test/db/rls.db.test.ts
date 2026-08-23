import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  checkPosture,
  RLS_CONTRACT,
  type TableContract,
} from "./rls-contract.ts";

/**
 * Волна 1.5, пакет B (TESTING_PLAN §6) — живая RLS / cross-user матрица ПО
 * ОПЕРАЦИЯМ на throwaway нативном PG. Ожидания берутся из декларативного контракта
 * (rls-contract.ts), выведенного из SCHEMA_NOTES + SQL политик, а НЕ из поведения.
 *
 * Актор переключается тем же приёмом, что verify.ts: в ОДНОМ соединении внутри
 * sql.begin() — set_config('request.jwt.claim.sub', uid, true) (транзакционно-
 * локально, читается auth.uid()) + SET LOCAL ROLE. На commit/rollback роль и GUC
 * сбрасываются, поэтому актор не утекает между пробами. Это эквивалент Supabase-
 * семантики: там anon/authenticated — роли Postgres, а auth.uid() читает sub из
 * JWT (локально — из того же GUC, что эмулирует bootstrap-supabase-local.sql).
 *
 * Ограничение эмуляции: default-priv гранты Supabase здесь не воспроизводятся
 * (готча проекта) — их держит прод-скрипт scripts/check-rls-posture.ts (постура),
 * а живые данные-пробы одинаковы (RLS-политики идентичны).
 *
 * Deny различается ЧЕСТНО:
 *   - grant  — 42501 «permission denied» ДО RLS (нет табличного/колоночного гранта);
 *   - rls_check — 42501 «new row violates row-level security» (WITH CHECK на write);
 *   - rls_hidden — RLS отфильтровала строки: SELECT → 0 строк / UPDATE|DELETE → 0
 *     affected, БЕЗ ошибки (ассертим И 0, И неизменность данных).
 */

const sql = postgres(process.env.VERIFY_DATABASE_URL!, {
  max: 1,
  onnotice: () => {},
});

type DenyMode = "grant" | "rls_check";
interface Outcome {
  ok: boolean;
  rows: number; // строк вернулось (SELECT)
  affected: number; // затронуто (UPDATE/DELETE/INSERT)
  denyMode?: DenyMode;
  message?: string;
}

/**
 * Выполняет один запрос под ролью актора. uid=null → без jwt (anon).
 * 42501 классифицируется по тексту: «row-level security» = WITH CHECK violation,
 * иначе = отсутствие гранта. Прочие ошибки пробрасываются (тест не должен молча
 * скрывать неожиданный сбой).
 */
async function exec(
  role: "anon" | "authenticated",
  uid: string | null,
  query: string,
  params: unknown[] = [],
): Promise<Outcome> {
  try {
    const res = await sql.begin(async (tx) => {
      if (uid) await tx`SELECT set_config('request.jwt.claim.sub', ${uid}, true)`;
      await tx.unsafe(`SET LOCAL ROLE ${role}`);
      return tx.unsafe(query, params as never[]);
    });
    return { ok: true, rows: res.length, affected: res.count };
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string };
    if (err?.code === "42501") {
      const denyMode: DenyMode = /row-level security/i.test(err.message ?? "")
        ? "rls_check"
        : "grant";
      return { ok: false, rows: 0, affected: 0, denyMode, message: err.message };
    }
    throw e;
  }
}

const asA = (uid: string, q: string, p: unknown[] = []) =>
  exec("authenticated", uid, q, p);

/** Число строк владельца (owner-path, bypass RLS) — контроль неизменности данных. */
async function ownerCount(table: string, pk: string, id: string): Promise<number> {
  const rows = await sql.unsafe(`SELECT 1 FROM ${table} WHERE ${pk} = $1`, [id]);
  return rows.length;
}

// --- сид ---------------------------------------------------------------------

let userA = "";
let userB = "";
/** table → { a, b } id строк-фикстур владельцев A/B. */
const rowIds: Record<string, { a: string; b: string }> = {};
/** hard-lock: одна строка (для owner-path позитива). */
const hardLockIds: Record<string, string> = {};

async function seedUser(email: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO auth.users (email) VALUES (${email}) RETURNING id`;
  return row!.id;
}

/** Сидит по одной строке владельца в owner-read / notification / join таблицах. */
async function seedForUser(
  userId: string,
  slot: "a" | "b",
  fx: {
    contentItemId: string;
    writingTaskId: string;
    speakingTaskId: string;
    vocabCardId: string;
  },
): Promise<{ writingSubmissionId: string; speakingSubmissionId: string }> {
  const put = (table: string, id: string) => {
    rowIds[table] ??= { a: "", b: "" };
    rowIds[table][slot] = id;
  };

  // profile: строка уже создана auth-триггером, её id = userId.
  put("profile", userId);

  const [att] = await sql<{ id: string }[]>`
    INSERT INTO attempt (user_id, content_item_id, mode)
    VALUES (${userId}, ${fx.contentItemId}, 'practice') RETURNING id`;
  put("attempt", att!.id);

  const [ann] = await sql<{ id: string }[]>`
    INSERT INTO annotation (user_id, content_item_id, passage_order, start_offset, end_offset)
    VALUES (${userId}, ${fx.contentItemId}, 1, 0, 5) RETURNING id`;
  put("annotation", ann!.id);

  const [pay] = await sql<{ id: string }[]>`
    INSERT INTO payment (user_id, provider, provider_transaction_id, tier, period_months, amount)
    VALUES (${userId}, 'payme', ${`rls_${slot}`}, 'premium', 1, 1000) RETURNING id`;
  put("payment", pay!.id);

  const [notif] = await sql<{ id: string }[]>`
    INSERT INTO notification (user_id, type, kind, title)
    VALUES (${userId}, 'system', 'verify', 'x') RETURNING id`;
  put("notification", notif!.id);

  const [wsub] = await sql<{ id: string }[]>`
    INSERT INTO writing_submission (user_id, task_id, essay_text, word_count)
    VALUES (${userId}, ${fx.writingTaskId}, 'essay', 2) RETURNING id`;
  put("writing_submission", wsub!.id);
  const [wfb] = await sql<{ id: string }[]>`
    INSERT INTO writing_feedback
      (submission_id, band_low, band_high, confidence, criteria, top_fixes,
       annotations, rewrite, checklist, provider, model, prompt_version)
    VALUES (${wsub!.id}, 6.0, 6.5, 'medium', '{}'::jsonb, '[]'::jsonb,
            '[]'::jsonb, '{}'::jsonb, '[]'::jsonb, 'p', 'm', 'v') RETURNING id`;
  put("writing_feedback", wfb!.id);

  const [ssub] = await sql<{ id: string }[]>`
    INSERT INTO speaking_submission (user_id, task_id, audio_path)
    VALUES (${userId}, ${fx.speakingTaskId}, 'audio/x') RETURNING id`;
  put("speaking_submission", ssub!.id);
  const [sfb] = await sql<{ id: string }[]>`
    INSERT INTO speaking_feedback
      (submission_id, band_low, band_high, confidence, criteria, transcript,
       annotations, top_fixes, drills, provider, model, prompt_version)
    VALUES (${ssub!.id}, 6.0, 6.5, 'medium', '{}'::jsonb, 't',
            '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'p', 'm', 'v') RETURNING id`;
  put("speaking_feedback", sfb!.id);

  const [evt] = await sql<{ id: string }[]>`
    INSERT INTO speaking_audio_event (user_id, event)
    VALUES (${userId}, 'consent_given') RETURNING id`;
  put("speaking_audio_event", evt!.id);

  const [vp] = await sql<{ id: string }[]>`
    INSERT INTO vocab_progress (user_id, card_id)
    VALUES (${userId}, ${fx.vocabCardId}) RETURNING id`;
  put("vocab_progress", vp!.id);

  const [sw] = await sql<{ id: string }[]>`
    INSERT INTO saved_word (user_id, word) VALUES (${userId}, 'w') RETURNING id`;
  put("saved_word", sw!.id);

  const [mr] = await sql<{ id: string }[]>`
    INSERT INTO mistake_resolution (user_id, content_item_id, question_number, qtype)
    VALUES (${userId}, ${fx.contentItemId}, 1, 'tfng') RETURNING id`;
  put("mistake_resolution", mr!.id);

  const [mrev] = await sql<{ id: string }[]>`
    INSERT INTO mistake_review (user_id, content_item_id, question_number, qtype)
    VALUES (${userId}, ${fx.contentItemId}, 1, 'tfng') RETURNING id`;
  put("mistake_review", mrev!.id);

  const [pre] = await sql<{ id: string }[]>`
    INSERT INTO preorder (user_id, tier, period_months, amount)
    VALUES (${userId}, 'premium', 1, 1000) RETURNING id`;
  put("preorder", pre!.id);

  return { writingSubmissionId: wsub!.id, speakingSubmissionId: ssub!.id };
}

beforeAll(async () => {
  // Чистый лист (globalSetup уже применил миграции с нуля; здесь чистим прошлый сид).
  await sql`TRUNCATE auth.users, content_item CASCADE`;

  // Общие фикстуры (owner-path).
  const [ci] = await sql<{ id: string }[]>`
    INSERT INTO content_item (section, category, title, band_type, status)
    VALUES ('reading', 'passage_1', 'RLS fixture', 'reading_academic', 'published') RETURNING id`;
  const [pg] = await sql<{ id: string }[]>`
    INSERT INTO passage (content_item_id, "order", body_html)
    VALUES (${ci!.id}, 1, '<p>x</p>') RETURNING id`;
  const [q] = await sql<{ id: string }[]>`
    INSERT INTO question (content_item_id, passage_id, number, qtype, prompt_html, "order")
    VALUES (${ci!.id}, ${pg!.id}, 1, 'tfng', '<p>q</p>', 1) RETURNING id`;
  const [wt] = await sql<{ id: string }[]>`
    INSERT INTO writing_task (category, prompt, status)
    VALUES ('academic', 'p', 'published') RETURNING id`;
  const [st] = await sql<{ id: string }[]>`
    INSERT INTO speaking_task (prompt, bullets, closing_prompt, status)
    VALUES ('p', '[]'::jsonb, 'c', 'published') RETURNING id`;
  const [vd] = await sql<{ id: string }[]>`
    INSERT INTO vocab_deck (title, source_file_path, status)
    VALUES ('d', 'rls-fixture', 'published') RETURNING id`;
  const [vc] = await sql<{ id: string }[]>`
    INSERT INTO vocab_card (deck_id, "order", word, definition)
    VALUES (${vd!.id}, 1, 'w', 'def') RETURNING id`;

  const fx = {
    contentItemId: ci!.id,
    writingTaskId: wt!.id,
    speakingTaskId: st!.id,
    vocabCardId: vc!.id,
  };

  userA = await seedUser("rls-a@test.local");
  userB = await seedUser("rls-b@test.local");
  const seedA = await seedForUser(userA, "a", fx);
  await seedForUser(userB, "b", fx);

  // hard-lock: по одной строке (owner-path позитив; для deny строки не нужны).
  const [ak] = await sql<{ id: string }[]>`
    INSERT INTO answer_key (question_id, mode, accept)
    VALUES (${q!.id}, 'exact', '["A"]'::jsonb) RETURNING id`;
  hardLockIds["answer_key"] = ak!.id;

  // status='submitted': второй in_progress на том же item нарушил бы
  // attempt_one_in_progress_idx (у A уже есть in_progress-фикстура выше).
  const [snapAtt] = await sql<{ id: string }[]>`
    INSERT INTO attempt (user_id, content_item_id, mode, status, submitted_at)
    VALUES (${userA}, ${ci!.id}, 'practice', 'submitted', now()) RETURNING id`;
  await sql`
    INSERT INTO attempt_review_snapshot (attempt_id, snapshot)
    VALUES (${snapAtt!.id}, '{}'::jsonb)`;
  hardLockIds["attempt_review_snapshot"] = snapAtt!.id;

  const [wfd] = await sql<{ id: string }[]>`
    INSERT INTO writing_feedback_debug (submission_id, raw_output, provider, model, prompt_version)
    VALUES (${seedA.writingSubmissionId}, 'raw', 'p', 'm', 'v') RETURNING id`;
  hardLockIds["writing_feedback_debug"] = wfd!.id;

  const [sfd] = await sql<{ id: string }[]>`
    INSERT INTO speaking_feedback_debug (submission_id, raw_output, provider, model, prompt_version)
    VALUES (${seedA.speakingSubmissionId}, 'raw', 'p', 'm', 'v') RETURNING id`;
  hardLockIds["speaking_feedback_debug"] = sfd!.id;
}, 60_000);

afterAll(async () => {
  await sql.end({ timeout: 5 });
});

// --- матрица SELECT (клиент-читаемые категории) ------------------------------

const readable = RLS_CONTRACT.filter((c) =>
  ["owner_read", "owner_read_join", "notification"].includes(c.category),
);

describe("cross-user SELECT — своё видно, чужое отфильтровано RLS, owner видит оба", () => {
  it.each(readable.map((c) => [c.table, c] as const))(
    "%s",
    async (_t, c: TableContract) => {
      const { a, b } = rowIds[c.table];
      const sel = `SELECT * FROM ${c.table} WHERE ${c.pk} = $1`;

      // anon: НИ ОДНОГО гранта → 42501 permission denied ДО RLS (не «0 строк»).
      const anon = await exec("anon", null, sel, [a]);
      expect(anon.ok).toBe(false);
      expect(anon.denyMode).toBe("grant");

      // A видит свою строку; строку B — 0 (RLS отфильтровала, БЕЗ ошибки).
      expect((await asA(userA, sel, [a])).rows).toBe(1);
      const aCrossB = await asA(userA, sel, [b]);
      expect(aCrossB.ok).toBe(true);
      expect(aCrossB.rows).toBe(0);

      // B симметрично.
      expect((await asA(userB, sel, [b])).rows).toBe(1);
      expect((await asA(userB, sel, [a])).rows).toBe(0);

      // owner-path (postgres) обходит RLS — видит обе строки.
      const both = await sql.unsafe(
        `SELECT * FROM ${c.table} WHERE ${c.pk} IN ($1,$2)`,
        [a, b],
      );
      expect(both.length).toBe(2);
    },
  );
});

// --- матрица записи: клиент не пишет owner-state ------------------------------

describe("клиентская запись owner-state запрещена (INSERT/UPDATE/DELETE → deny grant)", () => {
  it.each(readable.map((c) => [c.table, c] as const))(
    "%s",
    async (_t, c: TableContract) => {
      const { a } = rowIds[c.table];
      // Пробуем не-read_at колонку (pk=pk): даже у notification нет гранта на неё,
      // поэтому проба универсальна. read_at-позитив notification — отдельным блоком.
      const probes = [
        `INSERT INTO ${c.table} DEFAULT VALUES`,
        `UPDATE ${c.table} SET ${c.pk} = ${c.pk} WHERE ${c.pk} = $1`,
        `DELETE FROM ${c.table} WHERE ${c.pk} = $1`,
      ];
      for (const query of probes) {
        const params = query.startsWith("INSERT") ? [] : [a];
        const anon = await exec("anon", null, query, params);
        expect(anon.ok, `anon: ${query}`).toBe(false);
        expect(anon.denyMode, `anon: ${query}`).toBe("grant");

        const auth = await exec("authenticated", userA, query, params);
        expect(auth.ok, `auth: ${query}`).toBe(false);
        expect(auth.denyMode, `auth: ${query}`).toBe("grant");
      }
      // Данные владельца A не тронуты ни одной из проб.
      expect(await ownerCount(c.table, c.pk, a)).toBe(1);
    },
  );
});

// --- notification: единственная разрешённая клиентская запись (read_at) -------

describe("notification — UPDATE(read_at): позитив own, RLS-фильтр cross, колоночный deny", () => {
  it("A помечает СВОЮ строку прочитанной → 1 affected, read_at выставлен", async () => {
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO notification (user_id, type, kind, title)
      VALUES (${userA}, 'system', 'verify', 'read-at-own') RETURNING id`;
    const out = await asA(userA, `UPDATE notification SET read_at = now() WHERE id = $1`, [
      row!.id,
    ]);
    expect(out.ok).toBe(true);
    expect(out.affected).toBe(1);
    const [after] = await sql<{ read_at: Date | null }[]>`
      SELECT read_at FROM notification WHERE id = ${row!.id}`;
    expect(after!.read_at).not.toBeNull();
  });

  it("B по строке A → 0 affected (RLS-фильтр, НЕ ошибка), read_at не изменился", async () => {
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO notification (user_id, type, kind, title)
      VALUES (${userA}, 'system', 'verify', 'read-at-cross') RETURNING id`;
    const out = await asA(userB, `UPDATE notification SET read_at = now() WHERE id = $1`, [
      row!.id,
    ]);
    expect(out.ok).toBe(true);
    expect(out.affected).toBe(0); // deny через RLS USING — 0 строк без ошибки
    const [after] = await sql<{ read_at: Date | null }[]>`
      SELECT read_at FROM notification WHERE id = ${row!.id}`;
    expect(after!.read_at).toBeNull(); // данные не тронуты
  });

  it("A по СВОЕЙ строке, но не-read_at колонка (title) → deny grant (нет колоночного гранта)", async () => {
    const { a } = rowIds["notification"];
    const out = await asA(userA, `UPDATE notification SET title = 'hacked' WHERE id = $1`, [a]);
    expect(out.ok).toBe(false);
    expect(out.denyMode).toBe("grant");
  });
});

// --- hard-lock: клиент недостижим любой операцией ----------------------------

const hardLock = RLS_CONTRACT.filter((c) => c.category === "hard_lock");

describe("hard-lock (answer_key / snapshot / *_feedback_debug) — клиент denied, owner читает", () => {
  it.each(hardLock.map((c) => [c.table, c] as const))(
    "%s",
    async (_t, c: TableContract) => {
      const id = hardLockIds[c.table];
      const probes = [
        `SELECT * FROM ${c.table} WHERE ${c.pk} = $1`,
        `INSERT INTO ${c.table} DEFAULT VALUES`,
        `UPDATE ${c.table} SET ${c.pk} = ${c.pk} WHERE ${c.pk} = $1`,
        `DELETE FROM ${c.table} WHERE ${c.pk} = $1`,
      ];
      for (const query of probes) {
        const params = query.startsWith("INSERT") ? [] : [id];
        for (const [role, uid] of [
          ["anon", null],
          ["authenticated", userA],
        ] as const) {
          const out = await exec(role, uid, query, params);
          expect(out.ok, `${role}: ${query}`).toBe(false);
          expect(out.denyMode, `${role}: ${query}`).toBe("grant");
        }
      }
      // owner-path читает засеянную строку (service_role/grading путь жив).
      const owned = await sql.unsafe(`SELECT * FROM ${c.table} WHERE ${c.pk} = $1`, [id]);
      expect(owned.length).toBe(1);
    },
  );
});

// --- постура каталогов (strict local) ----------------------------------------

describe("постура каталогов (RLS + политики + гранты) соответствует контракту", () => {
  it.each(RLS_CONTRACT.map((c) => [c.table, c] as const))(
    "%s",
    async (_t, c: TableContract) => {
      const r = await checkPosture(sql, c, "local");
      expect(r.problems).toEqual([]);
    },
  );
});
