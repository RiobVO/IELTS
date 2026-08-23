import { createClient } from "@supabase/supabase-js";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  answerKey,
  attempt,
  contentItem,
  passage as passageT,
  profile,
  question as questionT,
  signupThrottle,
} from "../src/db/schema";
import { SMOKE_EMAIL, SMOKE_PASSWORD } from "./auth";
import { isStatefulE2eAllowed, loadE2eEnv, type E2eEnv } from "./stateful-gate";

/**
 * Сид контента и юзеров для stateful-e2e против hosted тест-стенда Supabase
 * (волна 3a, TESTING_PLAN §9). Идемпотентен: контент пересобирается по
 * детерминированным sourceFilePath-ключам (delete-by-key + insert с фиксированным
 * id, зеркалит persist.ts), юзеры провижинятся через admin API с игнором
 * «already registered». Повторный прогон даёт идентичные count'ы таблиц.
 *
 * Формы записи content_item/passage/question/answer_key копируют импорт-пайплайн
 * (src/lib/import/persist.ts) — иначе грейдинг (grade.ts маршрутит по answer_key.mode)
 * и раннеры сломались бы на seed-данных.
 *
 * Гейт и креды: все чтения URL/ключей идут через resolved e2e env (тот же
 * объект, что резолвит гейт), не через сырой process.env — раньше отдельные
 * модули (admin.ts) читали свой собственный .env-срез и могли разойтись с
 * гейтом при смешанном .env.local/.env.development.local (внешний ревью,
 * находка A). seedStatefulE2e(env) получает его параметром из global-setup
 * (резолвлен там ровно один раз); хелперы, которых зовут спеки напрямую
 * (deleteInProgressAttemptsByEmail и т.д.), резолвят его сами через
 * loadE2eEnv() — чистая функция над файлами + process.env, дёшево звать
 * повторно, и это тот же снапшот, что видит запущенное приложение. Каждая
 * экспортируемая функция defensively перепроверяет isStatefulE2eAllowed(env)
 * и бросает, если гейт не пройден (global-setup бросает раньше — это
 * belt-and-braces на случай прямого импорта хелпера спекой в обход global-setup).
 */

/* -------------------------------------------------------------------------- */
/* Экспортируемые ключи сида — спеки строят по ним URL и адресуют юзеров.       */
/* -------------------------------------------------------------------------- */

// Фиксированные id обоих seed content_item: спеки собирают URL без запроса к БД
// (/app/reading/[id] для атомизированного, /app/exam/[id]?mode=mock для раннера).
// «0e2e» = мнемоника e2e; формат — валидный UUID (version 4, variant 8).
export const SEED_ATOMIZED_READING_ID = "0e2e0000-0000-4000-8000-000000000a01";
export const SEED_RUNNER_MOCK_ID = "0e2e0000-0000-4000-8000-000000000a02";

// Ключи идемпотентности (source_file_path) — по ним re-seed сносит прежние строки.
const SEED_ATOMIZED_SOURCE = "e2e-seed/atomized-reading-v1";
const SEED_RUNNER_SOURCE = "e2e-seed/runner-bridge-mock-v1";

// Cap-юзер (tier='basic') для теста дневного practice-капа. Пароль — по образцу
// auth.ts: дефолт-константа + env-override (тест-стенд, не секрет).
export const CAP_EMAIL = process.env.CAP_EMAIL ?? "e2e-cap@bando-test.local";
export const CAP_PASSWORD = process.env.CAP_PASSWORD ?? "cap-test-password-1";

// Re-export для удобства спек (иначе тянуть из двух модулей).
export { SMOKE_EMAIL, SMOKE_PASSWORD };

/* -------------------------------------------------------------------------- */
/* Инфраструктура подключения.                                                 */
/* -------------------------------------------------------------------------- */

type SeedDb = ReturnType<typeof drizzle>;

/**
 * Открывает короткоживущий Drizzle/postgres-js клиент на env.DIRECT_URL,
 * выполняет fn и ГАРАНТИРОВАННО закрывает соединение (postgres.js иначе держит
 * event-loop — процесс Playwright/probe не завершится). prepare:false —
 * универсально безопасно (DIRECT_URL = session pooler, но защищаемся и от
 * transaction-mode). Гейт перепроверяется здесь по ПЕРЕДАННОМУ env — единая
 * точка для всех хелперов, и тот же объект, из которого берётся DIRECT_URL
 * (нельзя пройти гейт по одному снапшоту env, а подключиться по другому).
 */
async function withDb<T>(env: E2eEnv, fn: (db: SeedDb) => Promise<T>): Promise<T> {
  if (!isStatefulE2eAllowed(env)) {
    throw new Error(
      "e2e/seed: stateful e2e gate not passed — refusing to touch the database " +
        "(set ALLOW_STATEFUL_E2E=1 and point env at a non-prod Supabase project)",
    );
  }
  const url = env.DIRECT_URL;
  if (!url) throw new Error("e2e/seed: DIRECT_URL is not set");

  const client = postgres(url, { prepare: false, max: 1, idle_timeout: 5, connect_timeout: 10 });
  try {
    return await fn(drizzle(client));
  } finally {
    // timeout: закрываем даже если запрос завис — не блокируем завершение процесса.
    await client.end({ timeout: 5 });
  }
}

/** Admin-клиент Supabase (service-role) на переданном env — провижининг юзеров в обход почты. */
function adminClient(env: E2eEnv) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("e2e/seed: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in the resolved e2e env");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

/* -------------------------------------------------------------------------- */
/* Синтетический runner_html для теста bridge-протокола.                        */
/* -------------------------------------------------------------------------- */

// Минимальный раннер, проживающий в opaque-origin sandbox (allow-scripts, без
// allow-same-origin) под CSP роута (default-src 'none'; script-src 'unsafe-inline';
// connect-src 'none'). По клику Submit шлёт parent'у ТОЧНО то сообщение, что ждёт
// ExamFrame.onMessage: { type: "ielts-submit", answers } с targetOrigin "*"
// (parent валидирует отправителя по e.source === iframe.contentWindow, не по origin).
//
// Инварианты прохода сквозь read-time трансформеры роута (/runner):
//  - есть <head> → polyfillRunnerStorage инжектит storage-шим (без <head> роут 500).
//  - type записан в ДВОЙНЫХ кавычках → injectProgressBridge (ищет `type: 'ielts-submit'`
//    в одинарных) не матчит → чистый no-op, без частичного патча.
//  - targetOrigin уже "*" → retargetBridgeOrigin (ищет `, window.location.origin)`) no-op.
//  - нет .mode-switcher / pendingMode / beginTest+mode-card-btn → forceRunnerMode = no-op.
//  - нет фирменных маркеров чужих шаблонов → все skinRunner* = no-op.
// answers согласованы с answer_key раннер-item ниже (Q1=ALPHA, Q2=BETA, оба exact).
const RUNNER_MOCK_HTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Bridge mock runner</title></head>
<body>
<h1>E2E bridge mock runner</h1>
<p>Synthetic runner exercising the iframe submit bridge.</p>
<button id="submit" type="button">Submit</button>
<script>
  document.getElementById("submit").addEventListener("click", function () {
    try {
      parent.postMessage({ type: "ielts-submit", answers: { "1": "ALPHA", "2": "BETA" } }, "*");
    } catch (e) {}
  });
</script>
</body>
</html>`;

/* -------------------------------------------------------------------------- */
/* Определения контента (канонические формы persist.ts).                        */
/* -------------------------------------------------------------------------- */

type ContentInsert = typeof contentItem.$inferInsert;
type PassageInsert = typeof passageT.$inferInsert;
type QuestionInsert = typeof questionT.$inferInsert;
type AnswerKeyInsert = typeof answerKey.$inferInsert;

// Вопрос сида: question-поля + answer_key-поля (persist.ts пишет их одной парой insert'ов).
interface SeedQuestion {
  number: number;
  qtype: QuestionInsert["qtype"];
  promptHtml: string;
  options: { value: string; label: string }[] | null;
  answerMode: AnswerKeyInsert["mode"];
  accept: string[];
}

interface SeedContent {
  id: string;
  sourceFilePath: string;
  section: ContentInsert["section"];
  category: ContentInsert["category"];
  bandType: ContentInsert["bandType"];
  title: string;
  runnerHtml: string | null;
  passageBodyHtml: string;
  questions: SeedQuestion[];
}

// Item 1 — атомизированный reading (БЕЗ runner_html): каталог маршрутит его на
// /app/reading/[id]. category=passage_1 (практический, НЕ full_* → trial-лейн не
// задевается). 5 вопросов разных типов: 2 текст-ввода (Q3/Q4), 2 MCQ (Q2/Q5), 1 tfng (Q1).
const ATOMIZED_READING: SeedContent = {
  id: SEED_ATOMIZED_READING_ID,
  sourceFilePath: SEED_ATOMIZED_SOURCE,
  section: "reading",
  category: "passage_1",
  bandType: "reading_academic",
  title: "E2E Seed — Atomized Reading",
  runnerHtml: null,
  passageBodyHtml:
    "<p>The seed passage exists so the atomized runner has body text to render. " +
    "Climate and water are mentioned to anchor the completion answers.</p>",
  questions: [
    {
      number: 1,
      qtype: "tfng",
      promptHtml: "<p>The passage was written for automated tests.</p>",
      options: [
        { value: "TRUE", label: "True" },
        { value: "FALSE", label: "False" },
        { value: "NOT GIVEN", label: "Not Given" },
      ],
      answerMode: "exact",
      accept: ["TRUE"],
    },
    {
      number: 2,
      qtype: "mcq_single",
      promptHtml: "<p>Which letter is the correct choice?</p>",
      options: [
        { value: "A", label: "Option A" },
        { value: "B", label: "Option B" },
        { value: "C", label: "Option C" },
        { value: "D", label: "Option D" },
      ],
      answerMode: "exact",
      accept: ["B"],
    },
    {
      number: 3,
      qtype: "sentence_completion",
      promptHtml: "<p>The passage anchors on ______ change.</p>",
      options: null,
      answerMode: "exact",
      accept: ["CLIMATE"],
    },
    {
      number: 4,
      qtype: "short_answer",
      promptHtml: "<p>Name the second anchor word.</p>",
      options: null,
      answerMode: "text_accept",
      accept: ["WATER", "H2O"],
    },
    {
      number: 5,
      qtype: "mcq_single",
      promptHtml: "<p>Pick the third-question letter.</p>",
      options: [
        { value: "A", label: "Option A" },
        { value: "B", label: "Option B" },
        { value: "C", label: "Option C" },
        { value: "D", label: "Option D" },
      ],
      answerMode: "exact",
      accept: ["C"],
    },
  ],
};

// Item 2 — раннер-mock (runner_html задан): каталог маршрутит его на /app/exam/[id];
// спеки стартуют ?mode=mock → iframe → тест bridge-протокола. category=passage_2
// (не full_* → без trial). Два short_answer с exact-ключами, совпадающими с тем,
// что шлёт RUNNER_MOCK_HTML (Q1=ALPHA, Q2=BETA) → детерминированный грейд 2/2.
const RUNNER_MOCK: SeedContent = {
  id: SEED_RUNNER_MOCK_ID,
  sourceFilePath: SEED_RUNNER_SOURCE,
  section: "reading",
  category: "passage_2",
  bandType: "reading_academic",
  title: "E2E Seed — Runner Bridge Mock",
  runnerHtml: RUNNER_MOCK_HTML,
  passageBodyHtml: "<p>Bridge mock passage — questions hang off it for grading.</p>",
  questions: [
    {
      number: 1,
      qtype: "short_answer",
      promptHtml: "<p>Bridge answer one.</p>",
      options: null,
      answerMode: "exact",
      accept: ["ALPHA"],
    },
    {
      number: 2,
      qtype: "short_answer",
      promptHtml: "<p>Bridge answer two.</p>",
      options: null,
      answerMode: "exact",
      accept: ["BETA"],
    },
  ],
};

const SEED_CONTENT = [ATOMIZED_READING, RUNNER_MOCK];

/**
 * Пишет один content_item + passage + questions + answer_keys в транзакции.
 * Идемпотентность: DELETE по source_file_path (FK cascade сносит passage/question/
 * answer_key/attempt прежней версии), затем INSERT с фиксированным id. Тот же
 * порядок и формы, что persist.persistTest, но статус сразу 'published' (сид не
 * проходит review-гейт админки) и reviewed_at проставлен.
 */
async function seedOneContent(db: SeedDb, c: SeedContent): Promise<void> {
  await db.transaction(async (tx) => {
    // Cascade: content_item → passage/question/answer_key/attempt (+ trial_claim,
    // mistake_* по FK). Re-seed стартует с чистого item.
    await tx.delete(contentItem).where(eq(contentItem.sourceFilePath, c.sourceFilePath));

    const questionTypes = [...new Set(c.questions.map((q) => q.qtype as string))];

    await tx.insert(contentItem).values({
      id: c.id,
      section: c.section,
      category: c.category,
      title: c.title,
      sourceFilePath: c.sourceFilePath,
      durationSeconds: null,
      // Owner decision 2026-07-17: весь R/L бесплатен — tier_required='basic' везде.
      tierRequired: "basic",
      bandType: c.bandType,
      questionTypes,
      bandScale: null,
      runnerHtml: c.runnerHtml,
      // Сид отдаёт готовый к прохождению контент — сразу published + reviewed
      // (в отличие от импорта, где черновик ждёт ручного review-гейта).
      status: "published",
      reviewedAt: new Date(),
      importWarnings: null,
      createdBy: null,
    } satisfies ContentInsert);

    const [prow] = await tx
      .insert(passageT)
      .values({
        contentItemId: c.id,
        order: 1,
        title: null,
        bodyHtml: c.passageBodyHtml,
        audioPath: null,
        questionsHtml: null,
      } satisfies PassageInsert)
      .returning({ id: passageT.id });
    const passageId = prow!.id;

    for (const q of c.questions) {
      const [qrow] = await tx
        .insert(questionT)
        .values({
          contentItemId: c.id,
          passageId,
          number: q.number,
          qtype: q.qtype,
          promptHtml: q.promptHtml,
          options: q.options,
          groupKey: null,
          evidenceRef: null,
          order: q.number,
        } satisfies QuestionInsert)
        .returning({ id: questionT.id });

      await tx.insert(answerKey).values({
        questionId: qrow!.id,
        mode: q.answerMode,
        accept: q.accept,
        explanation: null,
        evidence: null,
      } satisfies AnswerKeyInsert);
    }
  });
}

/* -------------------------------------------------------------------------- */
/* Провижининг юзеров.                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Создаёт confirmed-юзера через admin API (идемпотентно — «already registered»
 * игнорируется), затем ставит tier UPDATE'ом. profile-строку создаёт auth-триггер
 * on_auth_user_created синхронно на insert в auth.users, поэтому UPDATE по email
 * после createUser всегда находит строку. Для premium premium_until=NULL —
 * effectiveTier трактует его как «без срока» (не понижает до basic).
 */
async function ensureUser(
  db: SeedDb,
  env: E2eEnv,
  email: string,
  password: string,
  tier: "basic" | "premium" | "ultra",
): Promise<void> {
  const admin = adminClient(env);
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error && !/already been registered|already exists/i.test(error.message)) {
    throw new Error(`e2e/seed: admin.createUser failed for ${email}: ${error.message}`);
  }
  await db.update(profile).set({ tier, premiumUntil: null }).where(eq(profile.email, email));
}

/* -------------------------------------------------------------------------- */
/* Cleanup-хелперы (спеки зовут напрямую).                                       */
/* -------------------------------------------------------------------------- */

/** id профиля по email (null, если юзера ещё нет). */
async function profileIdByEmail(db: SeedDb, email: string): Promise<string | null> {
  const [row] = await db.select({ id: profile.id }).from(profile).where(eq(profile.email, email)).limit(1);
  return row?.id ?? null;
}

/**
 * Удаляет in_progress-попытки юзера (по email). Спеки reading/mock зовут перед
 * прогоном: переиспользуемый аккаунт мог оставить незакрытую попытку (упал до
 * Submit), из-за которой клик по карточке резюмит её вместо чистого старта.
 */
export async function deleteInProgressAttemptsByEmail(email: string): Promise<void> {
  await withDb(loadE2eEnv(), async (db) => {
    const uid = await profileIdByEmail(db, email);
    if (!uid) return;
    await db
      .delete(attempt)
      .where(and(eq(attempt.userId, uid), eq(attempt.status, "in_progress")));
  });
}

/**
 * Удаляет ВСЕ попытки юзера (по email) — cap-тест должен стартовать с нулевого
 * счётчика (кап в access.ts считает все attempt-строки в окне, независимо от статуса).
 */
export async function deleteAllAttemptsByEmail(email: string): Promise<void> {
  await withDb(loadE2eEnv(), async (db) => {
    const uid = await profileIdByEmail(db, email);
    if (!uid) return;
    await db.delete(attempt).where(eq(attempt.userId, uid));
  });
}

/**
 * Предзаряжает счётчик practice-стартов юзера `count` строками (started_at=сейчас,
 * status='submitted' — чтобы не упереться в partial-индекс 0007 «одна in_progress
 * на (user,item)» и не считаться резюмом). Даёт cap-спеке детерминированно
 * подвести юзера к лимиту без UI-жонглирования несколькими item'ами: очистить
 * счётчик → предзарядить BASIC_PRACTICE_DAILY_LIMIT → следующий реальный старт из
 * UI обязан быть заблокирован (redirect /app/practice?limit=practice).
 * Возвращает число реально вставленных строк.
 */
export async function preloadPracticeStarts(email: string, count: number): Promise<number> {
  return withDb(loadE2eEnv(), async (db) => {
    const uid = await profileIdByEmail(db, email);
    if (!uid) throw new Error(`e2e/seed: no profile for ${email} — create the cap user first`);
    const now = new Date();
    const rows = Array.from({ length: count }, () => ({
      userId: uid,
      contentItemId: SEED_ATOMIZED_READING_ID,
      mode: "practice" as const,
      status: "submitted" as const,
      startedAt: now,
      submittedAt: now,
    }));
    if (rows.length === 0) return 0;
    const inserted = await db.insert(attempt).values(rows).returning({ id: attempt.id });
    return inserted.length;
  });
}

/* -------------------------------------------------------------------------- */
/* Точка входа сида (зовётся из global-setup ПОСЛЕ ensureSmokeUserConfirmed).    */
/* -------------------------------------------------------------------------- */

/**
 * Полный сид: контент (оба item идемпотентно), юзеры (smoke→premium, cap→basic),
 * очистка in_progress smoke-юзера. Одно соединение на весь прогон. `env` —
 * тот же resolved-объект, что уже прошёл гейт в global-setup (не резолвим
 * заново — см. комментарий в шапке файла).
 */
export async function seedStatefulE2e(env: E2eEnv): Promise<void> {
  await withDb(env, async (db) => {
    // Троттл signup-velocity (anti-cheat.ts, таблица signup_throttle, лимит
    // 10 логинов/10мин с IP) считает и УСПЕШНЫЕ логины. Полный сьют делает их
    // ~8 (auth/cap/reading/mock-iframe/smoke) — повторный прогон в течение
    // 10 минут с тем же IP упирался бы в чужой (прошлого прогона) бюджет и
    // флакал (внешний ревью, находка C). Это прод-защита от abuse, не предмет
    // теста — на тест-стенде, уже за гейтом isStatefulE2eAllowed, каждый
    // прогон обязан стартовать с нулевого счётчика.
    await db.delete(signupThrottle);

    for (const c of SEED_CONTENT) {
      await seedOneContent(db, c);
    }
    // smoke-юзер уже создан в global-setup (ensureSmokeUserConfirmed) — здесь
    // только поднимаем tier до premium (без cap-флака в exam-спеках). cap-юзер
    // создаётся тут же.
    await ensureUser(db, env, SMOKE_EMAIL, SMOKE_PASSWORD, "premium");
    await ensureUser(db, env, CAP_EMAIL, CAP_PASSWORD, "basic");

    // Чистим незакрытые попытки smoke-юзера: re-seed уже снёс их на seed-item'ах
    // (cascade), но на любых других item (остатки прежних прогонов) — нет.
    const uid = await profileIdByEmail(db, SMOKE_EMAIL);
    if (uid) {
      await db.delete(attempt).where(and(eq(attempt.userId, uid), eq(attempt.status, "in_progress")));
    }
  });
}
