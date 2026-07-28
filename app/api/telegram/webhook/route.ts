import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { contentItem, passage } from "@/db/schema";
import { telegramConfig } from "@/env";
import {
  answerCallback,
  downloadFileBytes,
  downloadFileText,
  getFilePath,
  sendMessage,
  sendUploadResult,
} from "@/lib/telegram/client";
import { uploadAudio } from "@/lib/telegram/storage";
import { importRunner } from "@/lib/import/runner/import-runner";
import { setRunnerAudioSrc } from "@/lib/import/runner/sanitize-runner";
import { RegradeRequiredError } from "@/lib/import/persist";

/**
 * Telegram-бот импорта контента (admin-канал, аналог /admin). Умеет:
 *  - HTML-файл теста  -> importRunner (iframe-движок: parse->persist->sanitize->
 *    runner_html, аудио из HTML само) (draft) + кнопка «Опубликовать»;
 *  - mp3-файл         -> кладёт в Supabase Storage, привязывает к последнему
 *    Listening-тесту (audio_path + подмена <audio src> в runner_html), затем кнопка;
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

export async function POST(request: Request) {
  const cfg = telegramConfig();
  if (!cfg) return ok(); // бот не сконфигурирован — no-op

  // Secret-token: если задан — обязан совпасть (отсекаем посторонние POST'ы).
  if (cfg.webhookSecret) {
    const sent = request.headers.get("x-telegram-bot-api-secret-token");
    if (sent !== cfg.webhookSecret) {
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
      await answerCallback(cq.id, "Нет доступа");
      return ok();
    }
    await handlePublish(cq);
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
      await handleHtmlUpload(chatId, doc, name);
    } else if (lower.endsWith(".mp3") || (doc.mime_type ?? "").startsWith("audio/")) {
      await handleAudioUpload(chatId, doc);
    } else {
      await sendMessage(
        chatId,
        `Не понял файл (${name}). Жду .html (тест) или .mp3 (аудио для Listening).`,
      );
    }
  } else if (audio) {
    await handleAudioUpload(chatId, audio);
  } else {
    await sendMessage(
      chatId,
      "Пришли HTML-файл теста или mp3 (аудио для Listening).",
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
    } else {
      console.error("telegram html import failed", e);
      await sendMessage(
        chatId,
        "Не удалось обработать файл (парсинг или сохранение). Проверь, что это корректный HTML-тест.",
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
  const [test] = await db
    .select({ id: contentItem.id, title: contentItem.title, runnerHtml: contentItem.runnerHtml })
    .from(contentItem)
    .where(eq(contentItem.section, "listening"))
    .orderBy(desc(contentItem.createdAt))
    .limit(1);
  if (!test) {
    await sendMessage(
      chatId,
      "Нет Listening-теста для привязки. Сначала пришли HTML Listening-теста, потом mp3.",
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
    revalidateTag("content_item");
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
 * Публикация по нажатию inline-кнопки (callback_data = "publish:<id>"). Зеркалит
 * admin setStatus: owner-update статуса + revalidate тега каталога. id приходит
 * только от whitelisted-админа и параметризуется Drizzle — инъекции нет.
 */
async function handlePublish(cq: TgCallbackQuery): Promise<void> {
  const data = cq.data ?? "";
  if (!data.startsWith("publish:")) {
    await answerCallback(cq.id, "Неизвестная команда");
    return;
  }
  const id = data.slice("publish:".length);
  try {
    const updated = await db
      .update(contentItem)
      .set({ status: "published" })
      .where(eq(contentItem.id, id))
      .returning({ id: contentItem.id, title: contentItem.title });
    if (updated.length === 0) {
      await answerCallback(cq.id, "Тест не найден");
      return;
    }
    revalidateTag("content_item");
    await answerCallback(cq.id, "Опубликовано ✅");
    if (cq.message) {
      await sendMessage(
        cq.message.chat.id,
        `📢 «${updated[0]!.title}» опубликован — виден ученикам в каталоге.`,
      );
    }
  } catch (e) {
    console.error("telegram publish failed", e);
    await answerCallback(cq.id, "Ошибка публикации");
  }
}
