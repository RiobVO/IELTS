import { revalidateTag } from "next/cache";
import { after, NextResponse } from "next/server";
import { and, desc, eq, exists, isNotNull, not, sql } from "drizzle-orm";
import { db } from "@/db";
import { contentItem, passage, vocabDeck } from "@/db/schema";
import { telegramConfig, publicSiteUrl } from "@/env";
import {
  answerCallback,
  downloadFileBytes,
  downloadFileText,
  getFilePath,
  sendMessage,
  sendUploadResult,
} from "@/lib/telegram/client";
import { webhookSecretValid } from "@/lib/telegram/auth";
import { uploadAudio } from "@/lib/telegram/storage";
import { importRunner } from "@/lib/import/runner/import-runner";
import { setRunnerAudioSrc } from "@/lib/import/runner/sanitize-runner";
import { RegradeRequiredError, DuplicateTestError } from "@/lib/import/persist";
import { contentTag } from "@/lib/content/exam-content";
import { publishReviewedContentItem } from "@/lib/content/publish";
import { importVocabDeck } from "@/lib/import/vocab/persist-vocab";
import { MAX_FILE_BYTES, VocabParseError } from "@/lib/import/vocab/parse-vocab";

/**
 * Telegram-бот импорта контента (admin-канал, аналог /admin). Умеет:
 *  - HTML-файл теста  -> importRunner (iframe-движок: parse->persist->sanitize->
 *    runner_html, аудио из HTML само) (draft) + кнопка «Опубликовать»;
 *  - mp3-файл         -> кладёт в Supabase Storage, привязывает к последнему
 *    Listening-тесту (audio_path + подмена <audio src> в runner_html), затем кнопка;
 *  - JSON-колода слов -> importVocabDeck (тот же chokepoint, что /admin/vocabulary):
 *    аддитивный upsert по имени файла (draft, либо published — статус реимпорт не
 *    трогает) + ссылка на /admin/vocabulary;
 *  - нажатие кнопки   -> draft -> published (как /admin setStatus).
 *
 * Middleware исключает /api/telegram из auth: запрос от Telegram, не от юзера.
 * Граница безопасности — secret-token + whitelist по user_id для message И
 * callback_query: бот пишет owner-путём (в обход RLS), поэтому действия — только
 * от доверенных id. Всегда 200 (кроме неверного secret), чтобы Telegram не
 * ретраил (идемпотентность импорта — по sourceFilePath; аудио — upsert по тесту).
 */
export const dynamic = "force-dynamic";

interface TgFile {
  file_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}
interface TgMessage {
  chat: { id: number };
  from?: { id: number };
  document?: TgFile;
  audio?: TgFile;
}
interface TgCallbackQuery {
  id: string;
  from: { id: number };
  data?: string;
  message?: { chat: { id: number } };
}
interface TgUpdate {
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
}

const ok = () => NextResponse.json({ ok: true });

function deferTelegramWork(label: string, work: () => Promise<void>): void {
  after(async () => {
    try {
      await work();
    } catch (e) {
      console.error(`telegram ${label} failed`, e);
    }
  });
}

/** true в боевом окружении — там webhook без секрета запрещён (fail closed, #4). */
function isProduction(): boolean {
  return process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
}

export async function POST(request: Request) {
  const cfg = telegramConfig();
  if (!cfg) return ok(); // бот не сконфигурирован — no-op

  // Prod fail-closed (#4): без секрета единственный барьер — from.id из JSON
  // (attacker-controlled) → форж callback_query мог бы опубликовать draft. В production
  // ТРЕБУЕМ секрет (зеркало payments verifyWebhook). Вне production допускаем работу без
  // секрета для локального теста. Секрет задан в prod-env — гард лишь страхует от регресса.
  if (isProduction() && !cfg.webhookSecret) {
    console.error("telegram webhook: TELEGRAM_WEBHOOK_SECRET missing in production — refusing (fail closed)");
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  // Secret-token: если задан — обязан совпасть (отсекаем посторонние POST'ы).
  // Constant-time (N12): `!==` давал тайминг-оракул по длине совпавшего префикса.
  if (cfg.webhookSecret) {
    const sent = request.headers.get("x-telegram-bot-api-secret-token");
    if (!webhookSecretValid(sent, cfg.webhookSecret)) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }
  }

  let update: TgUpdate;
  try {
    update = (await request.json()) as TgUpdate;
  } catch {
    return ok();
  }

  // Нажата inline-кнопка «Опубликовать».
  const cq = update.callback_query;
  if (cq) {
    if (!cfg.adminIds.includes(cq.from.id)) {
      deferTelegramWork("forbidden callback", () => answerCallback(cq.id, "Нет доступа"));
      return ok();
    }
    deferTelegramWork("publish callback", () => handlePublish(cq));
    return ok();
  }

  const msg = update.message;
  if (!msg?.from) return ok();

  // Whitelist: только доверенные админы (бот пишет owner-путём в обход RLS).
  if (!cfg.adminIds.includes(msg.from.id)) return ok();

  const chatId = msg.chat.id;
  const doc = msg.document;
  const audio = msg.audio;

  if (doc) {
    const name = doc.file_name ?? "file";
    const lower = name.toLowerCase();
    if (lower.endsWith(".html") || doc.mime_type === "text/html") {
      deferTelegramWork("html import", () => handleHtmlUpload(chatId, doc, name));
    } else if (lower.endsWith(".mp3") || (doc.mime_type ?? "").startsWith("audio/")) {
      deferTelegramWork("audio import", () => handleAudioUpload(chatId, doc));
    } else if (lower.endsWith(".json") || doc.mime_type === "application/json") {
      deferTelegramWork("vocab import", () => handleVocabUpload(chatId, doc, name));
    } else {
      deferTelegramWork(
        "unknown file reply",
        () => sendMessage(
          chatId,
          `Не понял файл (${name}). Жду .html (тест), .mp3 (аудио для Listening) или .json (колода слов).`,
        ),
      );
    }
  } else if (audio) {
    deferTelegramWork("audio import", () => handleAudioUpload(chatId, audio));
  } else {
    deferTelegramWork(
      "help reply",
      () => sendMessage(
        chatId,
        "Пришли HTML-файл теста или mp3 (аудио для Listening).",
      ),
    );
  }

  return ok();
}

/** HTML-тест -> parse -> persist (draft) + кнопка публикации. */
async function handleHtmlUpload(
  chatId: number,
  doc: TgFile,
  name: string,
): Promise<void> {
  try {
    const path = await getFilePath(doc.file_id);
    const html = await downloadFileText(path);
    // importRunner = тот же путь, что /admin (iframe-движок + read-time ребренд).
    // createdBy опущен -> persistTest пишет null (у бота нет Supabase-сессии).
    // sourceFilePath даёт идемпотентность.
    const r = await importRunner(html, { sourceFilePath: name });
    // Реимпорт published-теста меняет id (persist: DELETE+INSERT) — без сброса тега
    // кэш каталога/exam-контента держал бы удалённый id до TTL (start → FK-500).
    // Зеркало uploadTest в /admin: широкий тег гасит все per-id энтри разом.
    revalidateTag("content_item");
    revalidateTag(contentTag(r.id));
    const warn = r.warnings ? `\n⚠️ предупреждений: ${r.warnings}` : "";
    const brand = r.brandWarnings.length
      ? `\n🚩 бренд не вычищен (новый источник?): ${r.brandWarnings.join("; ")} — проверь шапку в раннере.`
      : "";
    const isListening = r.hasAudio || /listening/i.test(r.title);
    const audioHint = !r.hasAudio && isListening
      ? "\n🎧 Это Listening без аудио в файле — пришли mp3 следующим файлом."
      : r.hasAudio
        ? "\n🎧 Аудио подхвачено из файла."
        : "";
    await sendUploadResult(
      chatId,
      `✅ «${r.title}» сохранён как draft.\n` +
        `вопросов: ${r.questions}${warn}${brand}${audioHint}`,
      r.id,
    );
  } catch (e) {
    if (e instanceof RegradeRequiredError) {
      await sendMessage(
        chatId,
        `У теста «${name}» уже есть попытки (${e.attemptCount}) — повторный импорт ` +
          `удалил бы их. Правка пройденного теста — через Re-grade.`,
      );
    } else if (e instanceof DuplicateTestError) {
      const ex = e.existing;
      await sendMessage(
        chatId,
        `«${name}» — дубль уже загруженного теста «${ex.title}» (${ex.status}` +
          (ex.sourceFilePath ? `, файл ${ex.sourceFilePath}` : "") +
          `). Переимпорт того же теста — пришли файл под ТЕМ ЖЕ именем; ` +
          `если это новый тест — проверь содержимое файла.`,
      );
    } else {
      console.error("telegram html import failed", e);
      // Причина в ответе (handoff 2026-07-02): generic-ответ прятал реальную ошибку
      // в Vercel-логах — QA-цикл вслепую. Чат admin-only, message не несёт секретов.
      const reason = String((e as Error)?.message ?? e).slice(0, 200);
      await sendMessage(
        chatId,
        `Не удалось обработать «${name}» (парсинг или сохранение).\nПричина: ${reason}`,
      );
    }
  }
}

/**
 * mp3 -> Supabase Storage -> привязка к последнему Listening-тесту. Аудио одно на
 * тест; пишем его в passage order=1 (страница экзамена берёт первый passage с
 * audio_path). Путь в bucket = `<contentItemId>.mp3` (upsert идемпотентен).
 */
async function handleAudioUpload(chatId: number, file: TgFile): Promise<void> {
  // Привязываем к новейшему Listening-тесту, КОТОРОМУ ЕЩЁ НУЖНО аудио (нет ни одного
  // passage с audio_path), а не к глобально-последнему listening. Иначе mp3 мог уехать
  // на уже укомплектованный/чужой тест (два админа / повторная загрузка / задержка).
  // Остаточная неоднозначность: при ДВУХ ждущих аудио черновиках берётся новейший —
  // для точной привязки шли HTML и его mp3 до следующего HTML.
  const [test] = await db
    .select({ id: contentItem.id, title: contentItem.title, runnerHtml: contentItem.runnerHtml })
    .from(contentItem)
    .where(
      and(
        eq(contentItem.section, "listening"),
        not(
          exists(
            db
              .select({ one: sql`1` })
              .from(passage)
              .where(
                and(
                  eq(passage.contentItemId, contentItem.id),
                  isNotNull(passage.audioPath),
                ),
              ),
          ),
        ),
      ),
    )
    .orderBy(desc(contentItem.createdAt))
    .limit(1);
  if (!test) {
    await sendMessage(
      chatId,
      "Нет Listening-теста, ожидающего аудио. Сначала пришли HTML Listening-теста " +
        "(без встроенного аудио), затем mp3.",
    );
    return;
  }
  try {
    const path = await getFilePath(file.file_id);
    const bytes = await downloadFileBytes(path);
    const url = await uploadAudio(
      `${test.id}.mp3`,
      bytes,
      file.mime_type ?? "audio/mpeg",
    );
    // passage.audio_path — для каталога/легаси-раннера; <audio src> в runner_html —
    // для iframe-движка (он читает звук ИЗ своего html, не из passage). Патчим оба.
    await db
      .update(passage)
      .set({ audioPath: url })
      .where(and(eq(passage.contentItemId, test.id), eq(passage.order, 1)));
    if (test.runnerHtml) {
      await db
        .update(contentItem)
        .set({ runnerHtml: setRunnerAudioSrc(test.runnerHtml, url) })
        .where(eq(contentItem.id, test.id));
    }
    // Аудио-привязка меняет кэшируемый passage.audio_path — сбрасываем каталог
    // (content_item) и per-id контент-кэши этого теста (getExamContent).
    revalidateTag("content_item");
    revalidateTag(contentTag(test.id));
    await sendUploadResult(
      chatId,
      `🎧 Аудио привязано к «${test.title}». Тест готов.`,
      test.id,
    );
  } catch (e) {
    console.error("telegram audio upload failed", e);
    await sendMessage(
      chatId,
      "Не удалось загрузить аудио. Проверь файл и попробуй ещё раз.",
    );
  }
}

/**
 * JSON-колода слов -> importVocabDeck (owner-путь, тот же chokepoint, что и
 * /admin/vocabulary) -> аддитивный upsert (draft для нового дека; статус НЕ
 * трогается при реимпорте — см. persist-vocab.ts) + ссылка на /admin/vocabulary.
 * sourceFilePath = имя файла — та же конвенция идемпотентности, что у HTML-тестов
 * (повторная загрузка под тем же именем обновляет дек, а не плодит дубль).
 */
async function handleVocabUpload(
  chatId: number,
  doc: TgFile,
  name: string,
): Promise<void> {
  // Ранний size-гейт ПО заявленному Telegram file_size — ДО скачивания: файл больше
  // MAX_FILE_BYTES парсер всё равно отклонит, не тратим round-trip getFilePath+download.
  if (typeof doc.file_size === "number" && doc.file_size > MAX_FILE_BYTES) {
    await sendMessage(
      chatId,
      `Файл «${name}» слишком большой (${doc.file_size} > ${MAX_FILE_BYTES} байт) — не скачиваю.`,
    );
    return;
  }
  try {
    const path = await getFilePath(doc.file_id);
    const text = await downloadFileText(path);
    const r = await importVocabDeck(text, name);
    // importVocabDeck не возвращает title/status (см. VocabImportResult) — статус
    // важен показать по факту: реимпорт уже опубликованного дека остаётся published.
    const [deck] = await db
      .select({ title: vocabDeck.title, status: vocabDeck.status })
      .from(vocabDeck)
      .where(eq(vocabDeck.id, r.deckId))
      .limit(1);
    const origin = publicSiteUrl();
    const link = origin
      ? `\n🔍 Review в админке: ${origin}/admin/vocabulary#${r.deckId}`
      : "";
    await sendMessage(
      chatId,
      `✅ «${deck?.title ?? name}» сохранена (${deck?.status ?? "draft"}).\n` +
        `слов: ${r.inserted} новых, ${r.updated} обновлено, ${r.totalCards} всего.${link}`,
    );
  } catch (e) {
    if (e instanceof VocabParseError) {
      await sendMessage(
        chatId,
        `Не удалось разобрать колоду «${name}»: ${e.message.slice(0, 200)}`,
      );
    } else {
      console.error("telegram vocab import failed", e);
      const reason = String((e as Error)?.message ?? e).slice(0, 200);
      await sendMessage(
        chatId,
        `Не удалось обработать «${name}» (парсинг или сохранение).\nПричина: ${reason}`,
      );
    }
  }
}

// Причина отказа publish-гейта → сообщение админу (паритет с admin setStatus).
// Держать в синхроне с PublishResult.reason в @/lib/content/publish.
const PUBLISH_FAIL_MSG: Record<string, string> = {
  not_reviewed: "Сначала подтверди ключ в /admin (review), затем публикуй.",
  empty_answer_key: "Нельзя опубликовать: у вопроса пустой ключ — почини импорт.",
  unresolved_question_type: "Нельзя опубликовать: тип вопроса не распознан (см. warnings) — почини импорт.",
  question_number_gap: "Нельзя опубликовать: дыра или дубль в номерах вопросов — почини импорт.",
  answer_key_count_mismatch: "Нельзя опубликовать: у вопроса нет ключа — почини импорт.",
  missing_listening_audio: "Нельзя опубликовать: у listening-теста ещё нет аудио — прикрепи mp3.",
};

/**
 * Публикация по нажатию inline-кнопки (callback_data = "publish:<id>"). Зеркалит
 * admin setStatus через общий publishReviewedContentItem: публикует ТОЛЬКО после
 * review (reviewed_at) — гейт ключа (BRIEF §4.2.1) обязан держаться и здесь, не только
 * в /admin. Неотревьюенное отклоняется (review делается в /admin). id приходит только
 * от whitelisted-админа и параметризуется Drizzle — инъекции нет.
 */
async function handlePublish(cq: TgCallbackQuery): Promise<void> {
  const data = cq.data ?? "";
  if (!data.startsWith("publish:")) {
    await answerCallback(cq.id, "Неизвестная команда");
    return;
  }
  const id = data.slice("publish:".length);
  try {
    const res = await publishReviewedContentItem(id);
    if (!res.ok) {
      await answerCallback(cq.id, PUBLISH_FAIL_MSG[res.reason] ?? "Тест не найден");
      return;
    }
    await answerCallback(cq.id, "Опубликовано ✅");
    if (cq.message) {
      await sendMessage(
        cq.message.chat.id,
        `📢 «${res.title}» опубликован — виден ученикам в каталоге.`,
      );
    }
  } catch (e) {
    console.error("telegram publish failed", e);
    await answerCallback(cq.id, "Ошибка публикации");
  }
}
