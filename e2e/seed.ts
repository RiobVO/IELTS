import { createClient } from "@supabase/supabase-js";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  answerKey,
  attempt,
  contentItem,
  passage as passageT,
  profile,
  question as questionT,
  savedWord,
  signupThrottle,
  speakingAudioEvent,
  speakingFeedback,
  speakingSubmission,
  speakingTask,
  vocabCard,
  vocabDeck,
  vocabProgress,
  writingFeedback,
  writingSubmission,
  writingTask,
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

// Admin-юзер (волна 3b) — role='admin' проставляется отдельным UPDATE после
// provisioning (ensureUser сам знает только про tier). Пароль — тот же образец.
export const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "e2e-admin@bando-test.local";
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "admin-test-password-1";

// Draft content_item (клон ATOMIZED_READING, другой source-ключ) для admin-import.spec —
// НЕобзорено (reviewed_at=null) на каждом ре-сиде, чтобы review→publish проходился с чистого
// листа. QTYPE-чистый (те же qtype/answerMode, что у ATOMIZED_READING) — publish-гейт
// (isUnresolvedQuestionTypeWarning) не блокирует: importWarnings у сида всегда null.
export const SEED_ADMIN_DRAFT_ID = "0e2e0000-0000-4000-8000-000000000a04";
const SEED_ADMIN_DRAFT_SOURCE = "e2e-seed/admin-draft-reading-v1";
export const SEED_ADMIN_DRAFT_TITLE = "E2E Seed — Admin Draft Reading";

// Published vocab-дек + 3 карты (волна 3b) для vocab.spec — review-сессия и «My words».
export const SEED_VOCAB_DECK_ID = "0e2e0000-0000-4000-8000-000000000a05";
const SEED_VOCAB_DECK_SOURCE = "e2e-seed/vocab-deck-v1";
export const SEED_VOCAB_DECK_TITLE = "E2E Seed — Vocabulary Due";
const SEED_VOCAB_CARD_IDS = [
  "0e2e0000-0000-4000-8000-000000000b01",
  "0e2e0000-0000-4000-8000-000000000b02",
  "0e2e0000-0000-4000-8000-000000000b03",
] as const;
const SEED_VOCAB_WORDS = [
  { word: "DILIGENT", definition: "Showing care and effort in work or duties." },
  { word: "CONCUR", definition: "To agree with an opinion or decision." },
  { word: "MERIDIAN", definition: "The point of highest development or achievement." },
] as const;

// Ultra-юзер (волна 3b) для speaking.spec — Speaking = Ultra (SPEAKING_MIN_TIER).
// Ultra минует preview-лимит (только дневной кап 10), поэтому повторные прогоны
// детерминированно зелёные даже без идеальной чистки. Пароль — тот же образец.
export const ULTRA_EMAIL = process.env.ULTRA_EMAIL ?? "e2e-ultra@bando-test.local";
export const ULTRA_PASSWORD = process.env.ULTRA_PASSWORD ?? "ultra-test-password-1";

// Published Writing Task 2 (волна 3b) для writing.spec. tier_required='premium' —
// smoke-юзер (premium) проходит per-task тир-гейт createWritingSubmission. У
// writing_task НЕТ source_file_path → идемпотентность через фикс-id (delete-by-id
// с FK-cascade на submissions/feedback, затем insert).
export const SEED_WRITING_TASK_ID = "0e2e0000-0000-4000-8000-000000000c01";

// Published Speaking Part 2 cue-card (волна 3b) для speaking.spec. tier_required='ultra'
// (SPEAKING_MIN_TIER) — ultra-юзер проходит. Идемпотентность — как у writing_task.
export const SEED_SPEAKING_TASK_ID = "0e2e0000-0000-4000-8000-000000000c02";

// Приватный бакет аудио Speaking. КАНОН — scripts/lib/storage-provisioning.ts
// (speaking-audio: private / 10 MB / [audio/webm, audio/mp4]). Хардкодим строку,
// чтобы не тянуть server-only src/lib/speaking/storage.ts в Playwright-процесс.
const SPEAKING_BUCKET = "speaking-audio";
const SPEAKING_BUCKET_SIZE_LIMIT = 10 * 1024 * 1024;
const SPEAKING_BUCKET_MIME = ["audio/webm", "audio/mp4"];

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
  /** Default "published" (reviewed_at=now). "draft" leaves reviewed_at null — admin-import.spec's
   *  review→publish starting point. */
  status?: "draft" | "published";
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

// Item 3 — admin-import draft (волна 3b): байт-в-байт структура ATOMIZED_READING
// (тот же qtype-набор, тем самым QTYPE-гейт публикации точно не блокирует), но
// status="draft" — admin-import.spec approve'ит и публикует его через реальный /admin UI.
const ADMIN_DRAFT: SeedContent = {
  id: SEED_ADMIN_DRAFT_ID,
  sourceFilePath: SEED_ADMIN_DRAFT_SOURCE,
  section: "reading",
  category: "passage_1",
  bandType: "reading_academic",
  title: SEED_ADMIN_DRAFT_TITLE,
  runnerHtml: null,
  status: "draft",
  passageBodyHtml:
    "<p>Draft seed passage for the admin review→publish flow. Mentions climate and water " +
    "so the completion answers below have textual anchors.</p>",
  questions: [
    {
      number: 1,
      qtype: "tfng",
      promptHtml: "<p>This draft exists to exercise the admin publish gate.</p>",
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

const SEED_CONTENT = [ATOMIZED_READING, RUNNER_MOCK, ADMIN_DRAFT];

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
      // (в отличие от импорта, где черновик ждёт ручного review-гейта). ADMIN_DRAFT
      // (status:"draft") — исключение: reviewed_at остаётся null, чтобы
      // admin-import.spec проходил approve→publish через реальный UI-гейт.
      status: c.status ?? "published",
      reviewedAt: (c.status ?? "published") === "published" ? new Date() : null,
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

/**
 * Пишет published vocab_deck + 3 vocab_card в транзакции (волна 3b). Идемпотентность —
 * тот же приём, что seedOneContent: DELETE по source_file_path (FK cascade сносит
 * vocab_card → vocab_progress этого дека любого пользователя), затем INSERT с
 * фиксированными id. tier_required='basic' (дефолт схемы) — smoke-юзер (premium)
 * проходит тир-гейт тривиально, но и basic-юзер видел бы дек не locked.
 */
async function seedVocabDeck(db: SeedDb): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(vocabDeck).where(eq(vocabDeck.sourceFilePath, SEED_VOCAB_DECK_SOURCE));

    await tx.insert(vocabDeck).values({
      id: SEED_VOCAB_DECK_ID,
      title: SEED_VOCAB_DECK_TITLE,
      description: "E2E seed deck for the vocabulary review-session spec.",
      level: "B1",
      sourceFilePath: SEED_VOCAB_DECK_SOURCE,
      wordCount: SEED_VOCAB_WORDS.length,
      levelBand: "B1",
      status: "published",
    });

    await tx.insert(vocabCard).values(
      SEED_VOCAB_WORDS.map((w, i) => ({
        id: SEED_VOCAB_CARD_IDS[i],
        deckId: SEED_VOCAB_DECK_ID,
        order: i + 1,
        word: w.word,
        definition: w.definition,
      })),
    );
  });
}

/**
 * Published Writing Task 2 (волна 3b). Идемпотентно: delete-by-id (FK-cascade сносит
 * submissions/feedback прежней версии), затем insert с фикс-id. tier_required='premium'
 * — иначе premium smoke-юзер упёрся бы в per-task тир-гейт createWritingSubmission
 * (default writing_task.tier_required='ultra'). Минимум колонок: остальное nullable,
 * карточка деградирует в нейтральный вид.
 */
async function seedWritingTask(db: SeedDb): Promise<void> {
  await db.delete(writingTask).where(eq(writingTask.id, SEED_WRITING_TASK_ID));
  await db.insert(writingTask).values({
    id: SEED_WRITING_TASK_ID,
    category: "academic",
    taskPart: "task2",
    prompt:
      "Some people think technology makes life more complex. To what extent do you " +
      "agree or disagree? (E2E seed prompt.)",
    tierRequired: "premium",
    status: "published",
  });
}

/**
 * Published Speaking Part 2 cue-card (волна 3b). Идемпотентно как seedWritingTask.
 * tier_required='ultra' (SPEAKING_MIN_TIER) — ultra-юзер проходит. prep_seconds оставляем
 * штатные (спека жмёт «Skip to recording», не ждёт таймер); max_speak_seconds с запасом.
 */
async function seedSpeakingTask(db: SeedDb): Promise<void> {
  await db.delete(speakingTask).where(eq(speakingTask.id, SEED_SPEAKING_TASK_ID));
  await db.insert(speakingTask).values({
    id: SEED_SPEAKING_TASK_ID,
    part: "part2",
    prompt: "Describe a skill you would like to learn. (E2E seed cue card.)",
    bullets: ["what the skill is", "why you want to learn it", "how you would learn it"],
    closingPrompt: "and explain how this skill would help you.",
    prepSeconds: 60,
    maxSpeakSeconds: 120,
    tierRequired: "ultra",
    status: "published",
  });
}

/**
 * Идемпотентно гарантирует приватный бакет speaking-audio на тест-стенде (волна 3b) —
 * иначе signed-PUT загрузка аудио из speaking.spec упала бы. Значения из канона
 * (storage-provisioning.ts). Owner-политику НЕ ставим: весь storage-путь Speaking
 * (sign/size/download/delete) идёт service-role'ом в обход RLS — политика не задействована
 * этим e2e. getBucket-first делает createBucket идемпотентным (createBucket на существующем
 * вернул бы ошибку). Wave 2 уже провижинила бакет; это belt-and-braces на чистый стенд.
 */
async function ensureSpeakingBucket(env: E2eEnv): Promise<void> {
  const admin = adminClient(env);
  const { data: existing } = await admin.storage.getBucket(SPEAKING_BUCKET);
  if (existing) return;
  const { error } = await admin.storage.createBucket(SPEAKING_BUCKET, {
    public: false,
    fileSizeLimit: SPEAKING_BUCKET_SIZE_LIMIT,
    allowedMimeTypes: SPEAKING_BUCKET_MIME,
  });
  if (error) throw new Error(`e2e/seed: createBucket(${SPEAKING_BUCKET}) failed: ${error.message}`);
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

/**
 * Ставит role='admin' на уже провижененного юзера (ensureUser не знает про role —
 * тир и роль независимые оси). requireAdmin/isAdminProfile (src/lib/auth.ts) читают
 * ровно эту колонку; без неё admin-import.spec упёрся бы в redirect("/app").
 */
async function grantAdminRole(db: SeedDb, email: string): Promise<void> {
  await db.update(profile).set({ role: "admin" }).where(eq(profile.email, email));
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
/**
 * Чистит IP-бюджет auth-троттла (10 логинов/10мин, общий на стенд). Сид делает
 * это на старте прогона, но сьют вырос до ~13 логинов — с 13-го теста лимит
 * кончается ВНУТРИ прогона. Зовётся из loginAs перед каждым логином: троттл —
 * прод-защита, не предмет e2e (его контракт держат юнит-тесты), а на тест-стенде
 * за гейтом чистка легитимна.
 */
export async function purgeAuthThrottle(): Promise<void> {
  await withDb(loadE2eEnv(), async (db) => {
    await db.delete(signupThrottle);
  });
}

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

/**
 * (Пере)ставит SMOKE_EMAIL «due сейчас» на `dueCount` из SEED_VOCAB_CARD_IDS (порядок
 * колоды — первые N карт). Удаляет прежние строки прогресса юзера на этих картах перед
 * вставкой — идемпотентно, повторный вызов не плодит дублей (unique(user_id,card_id) всё
 * равно защитил бы, но явный delete детерминирует «сколько именно карт due» при повторном
 * прогоне с другим dueCount). due_at на час в прошлом — гарантированно ≤ now() без гонки
 * с часами теста; last_reviewed_at на день в прошлом — карта НЕ «новая» (SM-2 гейт Easy
 * в UI/сервере читает по наличию строки, не по last_reviewed_at, но реалистичный «уже
 * виденная карта» стейт ближе к типичному due-повтору, чем свежесозданная).
 */
export async function seedVocabDueForSmoke(dueCount: number): Promise<void> {
  const env = loadE2eEnv();
  await withDb(env, async (db) => {
    const uid = await profileIdByEmail(db, SMOKE_EMAIL);
    if (!uid) throw new Error("e2e/seed: no profile for SMOKE_EMAIL — global-setup must run first");
    await db
      .delete(vocabProgress)
      .where(and(eq(vocabProgress.userId, uid), inArray(vocabProgress.cardId, [...SEED_VOCAB_CARD_IDS])));

    const now = Date.now();
    const dueAt = new Date(now - 60 * 60 * 1000); // час назад — точно ≤ now()
    const lastReviewedAt = new Date(now - 24 * 60 * 60 * 1000);
    const rows = SEED_VOCAB_CARD_IDS.slice(0, dueCount).map((cardId) => ({
      userId: uid,
      cardId,
      ease: 2.5,
      intervalDays: 1,
      repetitions: 1,
      lapses: 0,
      dueAt,
      lastReviewedAt,
    }));
    if (rows.length > 0) await db.insert(vocabProgress).values(rows);
  });
}

/**
 * (Пере)создаёт РОВНО ОДНО saved_word для SMOKE_EMAIL (P11 личный словарь). vocab.spec
 * ассертит ГЛОБАЛЬНЫЙ счётчик "1 saved · 1 due" на /app/vocabulary — delete-by-key
 * (только совпадающее слово) чистил не всё: любое ДРУГОЕ saved_word того же
 * переиспользуемого smoke-юзера (остаток другого спека/ручного прогона) детерминированно
 * ломало ассерт (внешнее ревью). Поэтому чистим ВСЕ saved_word юзера перед вставкой —
 * после этого хелпера у SMOKE_EMAIL гарантированно ровно одно слово.
 */
export async function seedSavedWordForSmoke(
  word = "PERSEVERANCE",
  context = "Success on this exam requires perseverance and daily practice.",
): Promise<void> {
  await withDb(loadE2eEnv(), async (db) => {
    const uid = await profileIdByEmail(db, SMOKE_EMAIL);
    if (!uid) throw new Error("e2e/seed: no profile for SMOKE_EMAIL — global-setup must run first");
    await db.delete(savedWord).where(eq(savedWord.userId, uid));
    await db.insert(savedWord).values({ userId: uid, word, context, sourceContentItemId: null });
  });
}

/**
 * Cleanup-хелпер: сносит ВСЕ saved_word SMOKE_EMAIL. vocab.spec зовёт его в afterAll —
 * не оставлять "1 saved" на следующий прогон/сторонний спек, использующий того же
 * переиспользуемого smoke-юзера (симметрично чистке внутри seedSavedWordForSmoke выше).
 */
export async function deleteAllSavedWordsForSmoke(): Promise<void> {
  await withDb(loadE2eEnv(), async (db) => {
    const uid = await profileIdByEmail(db, SMOKE_EMAIL);
    if (!uid) return;
    await db.delete(savedWord).where(eq(savedWord.userId, uid));
  });
}

/**
 * Возвращает SEED_ADMIN_DRAFT_ID в исходное draft/unreviewed состояние. Global-setup
 * УЖЕ делает это на каждый прогон (seedOneContent пересоздаёт item с reviewed_at=null),
 * но admin-import.spec держит свой afterAll на тот же образец, что cap.spec.ts
 * (belt-and-braces): другой спек того же файла-набора не должен унаследовать уже
 * опубликованный клон, если когда-нибудь появится второй тест в этом же файле после
 * publish-теста без промежуточного global-setup.
 */
export async function resetAdminDraftItem(): Promise<void> {
  await withDb(loadE2eEnv(), async (db) => {
    await db
      .update(contentItem)
      .set({ status: "draft", reviewedAt: null })
      .where(eq(contentItem.id, SEED_ADMIN_DRAFT_ID));
  });
}

/* -------------------------------------------------------------------------- */
/* Writing/Speaking: инъекция готового фидбека + чистка (волна 3b).             */
/* -------------------------------------------------------------------------- */

/**
 * Удаляет ВСЕ writing-сабмишны юзера (по email) — FK-cascade сносит writing_feedback +
 * writing_feedback_debug. Спека зовёт перед прогоном (идемпотентный старт) и в afterAll:
 * completed-строка иначе сожгла бы basic-preview (для premium — нет, но чистим
 * симметрично) и накопила бы историю между прогонами.
 */
export async function deleteWritingSubmissionsByEmail(email: string): Promise<void> {
  await withDb(loadE2eEnv(), async (db) => {
    const uid = await profileIdByEmail(db, email);
    if (!uid) return;
    await db.delete(writingSubmission).where(eq(writingSubmission.userId, uid));
  });
}

/**
 * Инъекция «завершённого эвала» для Writing: находит последний pending/evaluating сабмишн
 * юзера, пишет writing_feedback напрямую и переводит сабмишн в completed — то же, что
 * делает persistFeedback в проде, но без Gemini. Формы фидбека — по evaluator/types.ts
 * (criteria×4, rewrite, checklist); writing_feedback_debug НЕ трогаем (hard-lock, result
 * его не читает). Возвращает submissionId (спека ждёт редирект на /result/<id>).
 *
 * blocker BandHero берёт по наименьшему midpoint band → task_response (5.0–5.5) заведомо
 * ниже прочих (6.5–7.0); его mainIssue несёт маркер E2E_WRITING_BLOCKER для ассерта.
 */
export async function injectCompletedWritingFeedback(email: string): Promise<string> {
  return withDb(loadE2eEnv(), async (db) => {
    const uid = await profileIdByEmail(db, email);
    if (!uid) throw new Error(`e2e/seed: no profile for ${email} — writing user missing`);
    const [row] = await db
      .select({ id: writingSubmission.id })
      .from(writingSubmission)
      .where(
        and(
          eq(writingSubmission.userId, uid),
          inArray(writingSubmission.status, ["pending", "evaluating"]),
        ),
      )
      .orderBy(desc(writingSubmission.createdAt))
      .limit(1);
    if (!row) throw new Error(`e2e/seed: no in-flight writing submission for ${email} to complete`);

    // Транзакция + guarded update: статус переводим В completed ТОЛЬКО из тех же
    // transient-состояний, что нашёл SELECT выше (WHERE, не доверие к прочитанному
    // id) — иначе гонка с реальным прод-путём (реаппер/поздний ответ эвалюатора)
    // между SELECT и UPDATE могла бы перевести failed/completed сабмишн в completed,
    // чего прод-код никогда не делает (finalize идёт только pending/evaluating→
    // completed|failed). .returning() + throw при ≠1 строке откатывает и вставленный
    // фидбек (rollback всей транзакции), не оставляя feedback-сироту без апдейта.
    return db.transaction(async (tx) => {
      await tx.insert(writingFeedback).values({
        submissionId: row.id,
        bandLow: "6.0",
        bandHigh: "7.0",
        confidence: "medium",
        criteria: [
          {
            name: "task_response",
            bandLow: 5,
            bandHigh: 5.5,
            strength: "A clear position is stated in the introduction.",
            mainIssue: "E2E_WRITING_BLOCKER: not all parts of the prompt are addressed.",
            nextStep: "Cover every part of the question with a distinct paragraph.",
          },
          {
            name: "coherence_cohesion",
            bandLow: 6.5,
            bandHigh: 7,
            strength: "Ideas are grouped into logical paragraphs.",
            mainIssue: "Some linking words are mechanical.",
            nextStep: "Vary your cohesive devices.",
          },
          {
            name: "lexical_resource",
            bandLow: 6.5,
            bandHigh: 7,
            strength: "Good range of topic vocabulary.",
            mainIssue: "Occasional word-choice slips.",
            nextStep: "Check collocations before submitting.",
          },
          {
            name: "grammar_accuracy",
            bandLow: 6.5,
            bandHigh: 7,
            strength: "A range of sentence structures is used.",
            mainIssue: "A few article errors remain.",
            nextStep: "Proofread articles and prepositions.",
          },
        ],
        topFixes: [
          "Address every part of the prompt.",
          "Tighten your paragraph linking.",
          "Proofread grammar before submitting.",
        ],
        annotations: [],
        rewrite: {
          thesisOld: "Technology is good for us.",
          thesis: "Technology reshapes daily routines in ways worth weighing carefully.",
          paragraph: "A rewritten paragraph injected for the end-to-end result screen.",
          replacements: [],
        },
        checklist: ["Re-read the prompt and underline every task before writing."],
        provider: "e2e",
        model: "e2e-inject",
        promptVersion: "e2e",
      });

      const updated = await tx
        .update(writingSubmission)
        .set({ status: "completed", updatedAt: new Date() })
        .where(and(eq(writingSubmission.id, row.id), inArray(writingSubmission.status, ["pending", "evaluating"])))
        .returning({ id: writingSubmission.id });
      if (updated.length !== 1) {
        throw new Error(
          `e2e/seed: writing submission ${row.id} left pending/evaluating before injection could complete it ` +
            `(raced with a real transition) — rolling back the injected feedback`,
        );
      }
      return row.id;
    });
  });
}

/**
 * Инъекция «завершённого эвала» для Speaking: находит последний активный
 * (uploading/pending/evaluating) сабмишн юзера, пишет speaking_feedback и переводит в
 * completed — зеркало persistFeedback без Gemini. transcript НЕпустой (несёт маркер
 * E2E_SPEAKING_TRANSCRIPT для ассерта И оставляет включённой delete-ветку — на пустом
 * транскрипте result сразу показал бы «removed»). debug НЕ трогаем (hard-lock).
 */
export async function injectCompletedSpeakingFeedback(email: string): Promise<string> {
  return withDb(loadE2eEnv(), async (db) => {
    const uid = await profileIdByEmail(db, email);
    if (!uid) throw new Error(`e2e/seed: no profile for ${email} — speaking user missing`);
    const [row] = await db
      .select({ id: speakingSubmission.id })
      .from(speakingSubmission)
      .where(
        and(
          eq(speakingSubmission.userId, uid),
          inArray(speakingSubmission.status, ["uploading", "pending", "evaluating"]),
        ),
      )
      .orderBy(desc(speakingSubmission.createdAt))
      .limit(1);
    if (!row) throw new Error(`e2e/seed: no in-flight speaking submission for ${email} to complete`);

    // Транзакция + guarded update (тот же приём, что injectCompletedWritingFeedback):
    // completed допустим только из uploading/pending/evaluating, ДОПОЛНИТЕЛЬНО
    // delete_requested_at IS NULL — прод-путь никогда не завершает сабмишн, на
    // котором пользователь уже нажал delete (deleteSpeakingRecording). ≠1
    // обновлённой строки → throw → rollback вставленного feedback.
    return db.transaction(async (tx) => {
      await tx.insert(speakingFeedback).values({
        submissionId: row.id,
        bandLow: "6.0",
        bandHigh: "7.0",
        confidence: "medium",
        criteria: [
          {
            name: "fluency_coherence",
            bandLow: 5,
            bandHigh: 5.5,
            strength: "You kept the long turn going without stopping.",
            mainIssue: "E2E_SPEAKING_BLOCKER: frequent hesitation breaks the flow.",
            nextStep: "Practise linking ideas with discourse markers.",
          },
          {
            name: "lexical_resource",
            bandLow: 6.5,
            bandHigh: 7,
            strength: "Relevant topic vocabulary is used.",
            mainIssue: "Common words are repeated.",
            nextStep: "Paraphrase key nouns.",
          },
          {
            name: "grammar_accuracy",
            bandLow: 6.5,
            bandHigh: 7,
            strength: "Simple structures are accurate.",
            mainIssue: "Few complex forms are attempted.",
            nextStep: "Use subordinate clauses.",
          },
          {
            name: "pronunciation",
            bandLow: 6.5,
            bandHigh: 7,
            strength: "Generally clear and intelligible.",
            mainIssue: "Intonation is sometimes flat.",
            nextStep: "Stress the key content words.",
          },
        ],
        transcript:
          "E2E_SPEAKING_TRANSCRIPT this is a synthetic transcript injected for the end to end " +
          "result screen so the annotated transcript block renders and the delete flow can run.",
        annotations: [],
        transcriptTimings: [],
        rewrites: [],
        topFixes: ["Reduce hesitation between ideas.", "Vary your vocabulary."],
        drills: ["Shadow a two-minute monologue every day."],
        provider: "e2e",
        model: "e2e-inject",
        promptVersion: "e2e",
      });

      const updated = await tx
        .update(speakingSubmission)
        .set({ status: "completed", updatedAt: new Date() })
        .where(
          and(
            eq(speakingSubmission.id, row.id),
            inArray(speakingSubmission.status, ["uploading", "pending", "evaluating"]),
            isNull(speakingSubmission.deleteRequestedAt),
          ),
        )
        .returning({ id: speakingSubmission.id });
      if (updated.length !== 1) {
        throw new Error(
          `e2e/seed: speaking submission ${row.id} left its transient state (or delete was requested) ` +
            `before injection could complete it — rolling back the injected feedback`,
        );
      }
      return row.id;
    });
  });
}

/**
 * Полная чистка Speaking-состояния юзера (по email): объекты в бакете под ${uid}/ +
 * speaking_submission (cascade feedback/debug) + speaking_audio_event (его FK — SET NULL,
 * не cascade → чистим явно, иначе аудит копится с осиротевшим submission_id). Storage
 * первым — иначе потеряли бы uid-префикс. Оставлять сирот в бакете нельзя (1 GB Free).
 */
export async function deleteSpeakingSubmissionsByEmail(email: string): Promise<void> {
  const env = loadE2eEnv();
  const uid = await withDb(env, (db) => profileIdByEmail(db, email));
  if (!uid) return;

  const admin = adminClient(env);
  const { data: objects, error } = await admin.storage.from(SPEAKING_BUCKET).list(uid);
  if (error) throw new Error(`e2e/seed: listing ${SPEAKING_BUCKET}/${uid} for cleanup failed: ${error.message}`);
  if (objects && objects.length > 0) {
    const { error: rmErr } = await admin.storage
      .from(SPEAKING_BUCKET)
      .remove(objects.map((o) => `${uid}/${o.name}`));
    if (rmErr) throw new Error(`e2e/seed: removing ${SPEAKING_BUCKET}/${uid} objects failed: ${rmErr.message}`);
  }

  await withDb(env, async (db) => {
    await db.delete(speakingSubmission).where(eq(speakingSubmission.userId, uid));
    await db.delete(speakingAudioEvent).where(eq(speakingAudioEvent.userId, uid));
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
    await seedVocabDeck(db);
    // W/S задания (волна 3b) — published, идемпотентно.
    await seedWritingTask(db);
    await seedSpeakingTask(db);

    // smoke-юзер уже создан в global-setup (ensureSmokeUserConfirmed) — здесь
    // только поднимаем tier до premium (без cap-флака в exam-спеках). cap-юзер
    // создаётся тут же.
    await ensureUser(db, env, SMOKE_EMAIL, SMOKE_PASSWORD, "premium");
    await ensureUser(db, env, CAP_EMAIL, CAP_PASSWORD, "basic");
    // admin-юзер (волна 3b) — tier не важен для доступа к /admin (requireAdmin
    // судит только по role), basic держит его на минимальных правах студента.
    await ensureUser(db, env, ADMIN_EMAIL, ADMIN_PASSWORD, "basic");
    await grantAdminRole(db, ADMIN_EMAIL);
    // ultra-юзер (волна 3b) для speaking.spec + consent на запись (иначе attempt
    // показал бы ConsentModal вместо prep-экрана; спека жмёт «Skip to recording»).
    await ensureUser(db, env, ULTRA_EMAIL, ULTRA_PASSWORD, "ultra");
    await db
      .update(profile)
      .set({ recordingConsentAt: new Date() })
      .where(eq(profile.email, ULTRA_EMAIL));

    // Чистим незакрытые попытки smoke-юзера: re-seed уже снёс их на seed-item'ах
    // (cascade), но на любых других item (остатки прежних прогонов) — нет.
    const uid = await profileIdByEmail(db, SMOKE_EMAIL);
    if (uid) {
      await db.delete(attempt).where(and(eq(attempt.userId, uid), eq(attempt.status, "in_progress")));
    }
  });

  // Бакет speaking-audio — вне withDb (storage API, не Drizzle). Идемпотентно.
  await ensureSpeakingBucket(env);
}
