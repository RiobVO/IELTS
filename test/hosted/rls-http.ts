/**
 * IDOR-матрица через РЕАЛЬНЫЙ PostgREST+Auth hosted тест-стенда Supabase
 * (волна 2, TESTING_PLAN §7). В отличие от test/db/rls.db.test.ts (нативный PG,
 * SET LOCAL ROLE + set_config jwt.claim.sub — эмуляция), здесь пробы идут через
 * настоящий HTTP-слой supabase-js двумя реально залогиненными юзерами + anon.
 * Это ловит то, что нативная эмуляция пропускает: Supabase default-priv гранты,
 * PostgREST-экспозицию таблиц, поведение реального JWT→auth.uid().
 *
 * Ожидания — из общего RLS_CONTRACT (rls-contract.ts), НЕ дублируются.
 *
 * Посев — через postgres по directUrl (роль owner тест-проекта обходит RLS, как
 * Drizzle-путь): создаём фикстуры и по одной owner-строке для A и B в каждой
 * owner-scoped таблице, плюс по строке в hard-lock таблицы.
 *
 * КРИТИЧНЫЙ ИНВАРИАНТ (без него тест — ложный зелёный): для каждой owner-таблицы
 * positive control ОБЯЗАТЕЛЕН — A через свой authed-клиент читает СВОЮ строку и
 * обязан её вернуть. 0 строк «потому что RLS» неотличимо от 0 строк «потому что
 * не засеяли», поэтому провал позитива = FAIL посева/раннера, не skip.
 */
import postgres, { type Sql } from "postgres";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { TestTargetEnv } from "../../scripts/lib/test-target-env.ts";
import { RLS_CONTRACT, type TableContract } from "../db/rls-contract.ts";

export type IdorStatus = "PASS" | "FAIL" | "SKIPPED";

export interface IdorResult {
  table: string;
  category: string;
  status: IdorStatus;
  /** Человекочитаемые доказанные IDOR-векторы (positive + negative). */
  vectors: string[];
  /** Причины FAIL (пусто при PASS). */
  problems: string[];
  /** Причина SKIPPED (undefined иначе). */
  reason?: string;
}

// --- низкоуровневые HTTP-пробы через supabase-js ------------------------------

interface ReadOutcome {
  rows: number;
  denied: boolean; // PostgREST вернул ошибку (нет гранта / RLS на write)
  errorMsg?: string;
}

/** SELECT одной строки по pk через переданный клиент (anon/authed-A/authed-B). */
async function trySelect(
  client: SupabaseClient,
  table: string,
  pk: string,
  id: string,
): Promise<ReadOutcome> {
  const { data, error } = await client.from(table).select("*").eq(pk, id);
  if (error) return { rows: 0, denied: true, errorMsg: error.message };
  return { rows: data?.length ?? 0, denied: false };
}

/** DELETE строки по pk через клиент; rows = сколько реально удалено (после RLS). */
async function tryDelete(
  client: SupabaseClient,
  table: string,
  pk: string,
  id: string,
): Promise<ReadOutcome> {
  const { data, error } = await client.from(table).delete().eq(pk, id).select();
  if (error) return { rows: 0, denied: true, errorMsg: error.message };
  return { rows: data?.length ?? 0, denied: false };
}

/** Число строк по owner-пути (postgres, обходит RLS) — контроль неизменности. */
async function ownerCount(sql: Sql, table: string, pk: string, id: string): Promise<number> {
  const rows = await sql.unsafe(`SELECT 1 FROM ${table} WHERE ${pk} = $1`, [id]);
  return rows.length;
}

// --- пробы по категориям ------------------------------------------------------

/** owner_read / owner_read_join / notification: тройная проба + write-deny. */
async function probeReadable(
  c: TableContract,
  ids: { a: string; b: string },
  clientA: SupabaseClient,
  clientB: SupabaseClient,
  anon: SupabaseClient,
  sql: Sql,
): Promise<IdorResult> {
  const problems: string[] = [];
  const vectors: string[] = [];
  const { pk } = c;

  // (a) POSITIVE control — обязателен. A видит СВОЮ строку, B видит СВОЮ.
  const ownA = await trySelect(clientA, c.table, pk, ids.a);
  if (ownA.rows < 1) {
    problems.push(
      `positive control провален: A не видит свою строку ${ids.a} ` +
        `(rows=${ownA.rows}${ownA.denied ? `, denied: ${ownA.errorMsg}` : ""}) — посев/auth сломан`,
    );
  } else {
    vectors.push("positive: A читает свою строку (rows≥1)");
  }
  const ownB = await trySelect(clientB, c.table, pk, ids.b);
  if (ownB.rows < 1) {
    problems.push(
      `positive control провален: B не видит свою строку ${ids.b} ` +
        `(rows=${ownB.rows}${ownB.denied ? `, denied: ${ownB.errorMsg}` : ""})`,
    );
  } else {
    vectors.push("positive: B читает свою строку (rows≥1)");
  }

  // (b) NEGATIVE cross-user. B читает строку A и наоборот → 0 строк.
  const crossBA = await trySelect(clientB, c.table, pk, ids.a);
  if (crossBA.rows !== 0) {
    problems.push(`IDOR: B прочитал строку A (${ids.a}), rows=${crossBA.rows}`);
  } else {
    vectors.push(`negative cross-user: B НЕ видит строку A (${crossBA.denied ? "grant-deny" : "RLS-фильтр"})`);
  }
  const crossAB = await trySelect(clientA, c.table, pk, ids.b);
  if (crossAB.rows !== 0) {
    problems.push(`IDOR: A прочитал строку B (${ids.b}), rows=${crossAB.rows}`);
  } else {
    vectors.push("negative cross-user: A НЕ видит строку B");
  }

  // (c) NEGATIVE anon. anon-клиент читает строку A → 0 строк / grant-deny.
  const anonA = await trySelect(anon, c.table, pk, ids.a);
  if (anonA.rows !== 0) {
    problems.push(`anon прочитал строку A (${ids.a}), rows=${anonA.rows}`);
  } else {
    vectors.push(`negative anon: anon НЕ видит строку A (${anonA.denied ? "grant-deny" : "RLS-фильтр"})`);
  }

  // (d) WRITE-DENY. A пытается удалить строку B → 0 удалено И строка B на месте.
  const delAB = await tryDelete(clientA, c.table, pk, ids.b);
  const bStillThere = (await ownerCount(sql, c.table, pk, ids.b)) === 1;
  if (delAB.rows !== 0 || !bStillThere) {
    problems.push(
      `write-deny провален: A удалил строку B (deleted=${delAB.rows}, ` +
        `B_present=${bStillThere})`,
    );
  } else {
    vectors.push(`write-deny: A НЕ может удалить строку B (${delAB.denied ? "grant-deny" : "RLS-фильтр"})`);
  }

  return {
    table: c.table,
    category: c.category,
    status: problems.length === 0 ? "PASS" : "FAIL",
    vectors,
    problems,
  };
}

/** hard_lock: anon И authed-A читают таблицу → 0 строк; owner-путь читает засев. */
async function probeHardLock(
  c: TableContract,
  id: string,
  clientA: SupabaseClient,
  anon: SupabaseClient,
  sql: Sql,
): Promise<IdorResult> {
  const problems: string[] = [];
  const vectors: string[] = [];
  const { pk } = c;

  // owner-path positive control — засев обязан существовать, иначе deny-пробы
  // ниже тавтологичны (0 строк «потому что не засеяли»).
  if ((await ownerCount(sql, c.table, pk, id)) !== 1) {
    problems.push(`positive control провален: owner-путь не видит засеянную строку ${id}`);
  } else {
    vectors.push("positive: owner-путь читает засеянную строку (grading-путь жив)");
  }

  const anonRead = await trySelect(anon, c.table, pk, id);
  if (anonRead.rows !== 0) {
    problems.push(`hard-lock пробит: anon прочитал ${c.table} (${id}), rows=${anonRead.rows}`);
  } else {
    vectors.push(`negative anon: anon НЕ читает hard-lock (${anonRead.denied ? "grant-deny" : "RLS"})`);
  }

  const authRead = await trySelect(clientA, c.table, pk, id);
  if (authRead.rows !== 0) {
    problems.push(`hard-lock пробит: authenticated A прочитал ${c.table} (${id}), rows=${authRead.rows}`);
  } else {
    vectors.push(`negative auth: authenticated НЕ читает hard-lock (${authRead.denied ? "grant-deny" : "RLS"})`);
  }

  return {
    table: c.table,
    category: c.category,
    status: problems.length === 0 ? "PASS" : "FAIL",
    vectors,
    problems,
  };
}

// --- посев (owner-путь, обходит RLS) -----------------------------------------

interface SeedAcc {
  /** table → { a, b } id owner-строк A/B (owner_read/join/notification). */
  rowIds: Record<string, { a: string; b: string }>;
  /** hard-lock table → id засеянной строки. */
  hardLockIds: Record<string, string>;
  /** Fixture-корни для явной очистки (каскадят контент-граф). */
  fixtureRoots: Array<{ table: string; id: string }>;
}

/** Сидит owner-строки одного юзера во все owner-scoped таблицы контракта. */
async function seedForUser(
  sql: Sql,
  userId: string,
  slot: "a" | "b",
  runId: string,
  fx: { contentItemId: string; writingTaskId: string; speakingTaskId: string; vocabCardId: string },
  rowIds: Record<string, { a: string; b: string }>,
): Promise<{ writingSubmissionId: string; speakingSubmissionId: string }> {
  const put = (table: string, id: string) => {
    rowIds[table] ??= { a: "", b: "" };
    rowIds[table][slot] = id;
  };

  // profile — уже создан триггером on_auth_user_created при admin.createUser.
  put("profile", userId);

  const [att] = await sql<{ id: string }[]>`
    INSERT INTO attempt (user_id, content_item_id, mode)
    VALUES (${userId}, ${fx.contentItemId}, 'practice') RETURNING id`;
  put("attempt", att!.id);

  const [ann] = await sql<{ id: string }[]>`
    INSERT INTO annotation (user_id, content_item_id, passage_order, start_offset, end_offset)
    VALUES (${userId}, ${fx.contentItemId}, 1, 0, 5) RETURNING id`;
  put("annotation", ann!.id);

  // provider_transaction_id уникален (provider, tx) — run-scope против коллизии прогонов.
  const [pay] = await sql<{ id: string }[]>`
    INSERT INTO payment (user_id, provider, provider_transaction_id, tier, period_months, amount)
    VALUES (${userId}, 'payme', ${`rls_${slot}_${runId}`}, 'premium', 1, 1000) RETURNING id`;
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
    INSERT INTO saved_word (user_id, word) VALUES (${userId}, ${`w_${slot}`}) RETURNING id`;
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

// Наполняет переданный acc (не создаёт свой) — при частичном падении посева
// уже созданные fixture-корни/строки видны снаружи и будут очищены (Codex Medium #2).
async function seed(sql: Sql, userA: string, userB: string, runId: string, acc: SeedAcc): Promise<void> {
  const { rowIds, hardLockIds, fixtureRoots } = acc;

  // Общие фикстуры (owner-путь). source_file_path у vocab_deck уникален — run-scope.
  const [ci] = await sql<{ id: string }[]>`
    INSERT INTO content_item (section, category, title, band_type, status)
    VALUES ('reading', 'passage_1', ${`RLS http fixture ${runId}`}, 'reading_academic', 'published') RETURNING id`;
  fixtureRoots.push({ table: "content_item", id: ci!.id });
  const [pg] = await sql<{ id: string }[]>`
    INSERT INTO passage (content_item_id, "order", body_html)
    VALUES (${ci!.id}, 1, '<p>x</p>') RETURNING id`;
  const [q] = await sql<{ id: string }[]>`
    INSERT INTO question (content_item_id, passage_id, number, qtype, prompt_html, "order")
    VALUES (${ci!.id}, ${pg!.id}, 1, 'tfng', '<p>q</p>', 1) RETURNING id`;
  const [wt] = await sql<{ id: string }[]>`
    INSERT INTO writing_task (category, prompt, status)
    VALUES ('academic', 'p', 'published') RETURNING id`;
  fixtureRoots.push({ table: "writing_task", id: wt!.id });
  const [st] = await sql<{ id: string }[]>`
    INSERT INTO speaking_task (prompt, bullets, closing_prompt, status)
    VALUES ('p', '[]'::jsonb, 'c', 'published') RETURNING id`;
  fixtureRoots.push({ table: "speaking_task", id: st!.id });
  const [vd] = await sql<{ id: string }[]>`
    INSERT INTO vocab_deck (title, source_file_path, status)
    VALUES ('d', ${`rls-http-fixture-${runId}`}, 'published') RETURNING id`;
  fixtureRoots.push({ table: "vocab_deck", id: vd!.id });
  const [vc] = await sql<{ id: string }[]>`
    INSERT INTO vocab_card (deck_id, "order", word, definition)
    VALUES (${vd!.id}, 1, 'w', 'def') RETURNING id`;

  const fx = {
    contentItemId: ci!.id,
    writingTaskId: wt!.id,
    speakingTaskId: st!.id,
    vocabCardId: vc!.id,
  };

  const seedA = await seedForUser(sql, userA, "a", runId, fx, rowIds);
  await seedForUser(sql, userB, "b", runId, fx, rowIds);

  // hard-lock засев (owner-путь позитив; для deny-проб строки нужны, чтобы
  // отличить «0 из-за защиты» от «0 из-за пустой таблицы»).
  const [ak] = await sql<{ id: string }[]>`
    INSERT INTO answer_key (question_id, mode, accept)
    VALUES (${q!.id}, 'exact', '["A"]'::jsonb) RETURNING id`;
  hardLockIds["answer_key"] = ak!.id;

  // submitted-attempt (не in_progress — иначе конфликт attempt_one_in_progress_idx с фикстурой A выше).
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
}

// --- оркестрация --------------------------------------------------------------

const READABLE_CATEGORIES = ["owner_read", "owner_read_join", "notification"];

function randSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Полный прогон IDOR-матрицы против hosted тест-стенда. Идемпотентно-переиспользуем. */
export async function runIdorMatrix(
  env: TestTargetEnv,
): Promise<{ passed: number; failed: number; results: IdorResult[] }> {
  const runId = `${Date.now()}-${randSuffix()}`;
  const password = `Idor-${runId}-Aa1!`;
  const emailA = `idor-a-${runId}@example.test`;
  const emailB = `idor-b-${runId}@example.test`;

  const admin = createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const sql = postgres(env.directUrl, { max: 1, prepare: false, onnotice: () => {} });

  let userAId = "";
  let userBId = "";
  // Аккумулятор снаружи try: посев наполняет его инкрементально, поэтому finally
  // чистит и при частичном падении seed (Codex Medium #2), а не только при успехе.
  const acc: SeedAcc = { rowIds: {}, hardLockIds: {}, fixtureRoots: [] };

  try {
    // 1. Два юзера через service-role admin API (email_confirm → sign-in сразу работает).
    const createdA = await admin.auth.admin.createUser({ email: emailA, password, email_confirm: true });
    if (createdA.error || !createdA.data.user) {
      throw new Error(`admin.createUser(A) failed: ${createdA.error?.message}`);
    }
    userAId = createdA.data.user.id;
    const createdB = await admin.auth.admin.createUser({ email: emailB, password, email_confirm: true });
    if (createdB.error || !createdB.data.user) {
      throw new Error(`admin.createUser(B) failed: ${createdB.error?.message}`);
    }
    userBId = createdB.data.user.id;

    // 2. Реальный логин A и B через anon-эндпоинт → authed-клиенты с их JWT.
    const clientA = createClient(env.supabaseUrl, env.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const clientB = createClient(env.supabaseUrl, env.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const anon = createClient(env.supabaseUrl, env.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const signA = await clientA.auth.signInWithPassword({ email: emailA, password });
    if (signA.error || !signA.data.session) throw new Error(`signIn(A) failed: ${signA.error?.message}`);
    const signB = await clientB.auth.signInWithPassword({ email: emailB, password });
    if (signB.error || !signB.data.session) throw new Error(`signIn(B) failed: ${signB.error?.message}`);

    // 3. Посев owner-строк + hard-lock (owner-путь через postgres).
    await seed(sql, userAId, userBId, runId, acc);

    // 4. Матрица.
    const results: IdorResult[] = [];

    for (const c of RLS_CONTRACT) {
      if (READABLE_CATEGORIES.includes(c.category)) {
        const ids = acc.rowIds[c.table];
        if (!ids || !ids.a || !ids.b) {
          results.push({
            table: c.table,
            category: c.category,
            status: "SKIPPED",
            vectors: [],
            problems: [],
            reason: "нет засеянных owner-строк A/B (FK-цепочка не покрыта посевом)",
          });
          continue;
        }
        results.push(await probeReadable(c, ids, clientA, clientB, anon, sql));
      } else if (c.category === "hard_lock") {
        const id = acc.hardLockIds[c.table];
        if (!id) {
          results.push({
            table: c.table,
            category: c.category,
            status: "SKIPPED",
            vectors: [],
            problems: [],
            reason: "нет засеянной hard-lock строки (FK-цепочка не покрыта посевом)",
          });
          continue;
        }
        results.push(await probeHardLock(c, id, clientA, anon, sql));
      }
    }

    const passed = results.filter((r) => r.status === "PASS").length;
    const failed = results.filter((r) => r.status === "FAIL").length;
    return { passed, failed, results };
  } finally {
    // 5. Cleanup — идемпотентная переиспользуемость (тест-проект живёт). Ошибки
    //    очистки логируем, не роняем итог. deleteUser каскадит user-owned строки
    //    (profile → attempt/notification/submission/... через onDelete cascade);
    //    fixture-корни каскадят контент-граф (answer_key/passage/...).
    //    speaking_audio_event чистим ЯВНО: его FK — ON DELETE SET NULL, не
    //    CASCADE (миграция 0027), поэтому deleteUser его НЕ уносит (Codex Medium #1).
    const evIds = acc.rowIds["speaking_audio_event"];
    if (evIds) {
      for (const id of [evIds.a, evIds.b]) {
        if (!id) continue;
        try {
          await sql.unsafe(`DELETE FROM speaking_audio_event WHERE id = $1`, [id]);
        } catch (e) {
          console.error(`cleanup: delete speaking_audio_event(${id}) failed:`, e);
        }
      }
    }
    for (const uid of [userAId, userBId]) {
      if (!uid) continue;
      try {
        const { error } = await admin.auth.admin.deleteUser(uid);
        if (error) console.error(`cleanup: deleteUser(${uid}) failed: ${error.message}`);
      } catch (e) {
        console.error(`cleanup: deleteUser(${uid}) threw:`, e);
      }
    }
    // fixtureRoots наполняется инкрементально в seed — чистим даже при частичном сбое.
    for (const { table, id } of acc.fixtureRoots) {
      try {
        await sql.unsafe(`DELETE FROM ${table} WHERE id = $1`, [id]);
      } catch (e) {
        console.error(`cleanup: delete ${table}(${id}) failed:`, e);
      }
    }
    try {
      await sql.end({ timeout: 5 });
    } catch {
      // уже закрыт
    }
  }
}
