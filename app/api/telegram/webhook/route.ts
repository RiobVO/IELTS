import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { contentItem } from "@/db/schema";
import { telegramConfig } from "@/env";
import {
  answerCallback,
  downloadFileText,
  getFilePath,
  sendMessage,
  sendUploadResult,
} from "@/lib/telegram/client";
import { parseTest } from "@/lib/import/parse-test";
import { persistTest, RegradeRequiredError } from "@/lib/import/persist";

/**
 * Telegram-бот импорта контента (admin-канал, аналог /admin). Админ кидает боту
 * HTML-файл теста — бот парсит тем же детерминированным pipeline
 * (parseTest -> persistTest) и сохраняет как draft, затем показывает inline-кнопку
 * «Опубликовать»; нажатие переводит тест в published (как /admin setStatus) — без
 * захода на сайт.
 *
 * Middleware исключает /api/telegram из auth-сессии: запрос идёт от Telegram, а не
 * от залогиненного юзера. Граница безопасности — secret-token (от Telegram) +
 * whitelist по user_id для message И callback_query: бот пишет owner-путём (в
 * обход RLS), поэтому принимаем действия ТОЛЬКО от доверенных id. Всегда отвечаем
 * 200 (кроме неверного secret), чтобы Telegram не ретраил апдейт (идемпотентность
 * импорта — по sourceFilePath в persistTest).
 */
export const dynamic = "force-dynamic";

interface TgDocument {
  file_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}
interface TgMessage {
  chat: { id: number };
  from?: { id: number };
  document?: TgDocument;
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
    return ok(); // мусорное тело — ack без ретраев
  }

  // Нажата inline-кнопка «Опубликовать» под загруженным тестом.
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
  if (!doc) {
    await sendMessage(
      chatId,
      "Пришли HTML-файл теста — распарсю и сохраню как draft.",
    );
    return ok();
  }
  const name = doc.file_name ?? "test.html";
  const isHtml =
    name.toLowerCase().endsWith(".html") || doc.mime_type === "text/html";
  if (!isHtml) {
    await sendMessage(chatId, `Это не HTML-файл (${name}). Жду .html с тестом.`);
    return ok();
  }

  try {
    const path = await getFilePath(doc.file_id);
    const html = await downloadFileText(path);
    const parsed = parseTest(html);
    // createdBy опущен -> persistTest пишет null (у бота нет Supabase-сессии;
    // content_item.createdBy nullable). sourceFilePath даёт идемпотентность.
    const id = await persistTest(parsed, { sourceFilePath: name });
    const warn = parsed.warnings.length
      ? `\n⚠️ предупреждений: ${parsed.warnings.length} — проверь в /admin`
      : "";
    // Кнопка «Опубликовать» прямо под результатом — публикация без /admin.
    await sendUploadResult(
      chatId,
      `✅ «${parsed.title}» сохранён как draft.\n` +
        `${parsed.section} · вопросов: ${parsed.questions.length}${warn}`,
      id,
    );
  } catch (e) {
    if (e instanceof RegradeRequiredError) {
      await sendMessage(
        chatId,
        `У теста «${name}» уже есть попытки (${e.attemptCount}) — повторный импорт ` +
          `удалил бы их. Правка пройденного теста — через Re-grade.`,
      );
    } else {
      console.error("telegram import failed", e);
      await sendMessage(
        chatId,
        "Не удалось обработать файл (парсинг или сохранение). Проверь, что это корректный HTML-тест.",
      );
    }
  }

  return ok();
}

/**
 * Публикация теста по нажатию inline-кнопки (callback_data = "publish:<id>").
 * Зеркалит admin setStatus: owner-update статуса + revalidate тега каталога.
 * id приходит только от whitelisted-админа (проверено выше) и параметризуется
 * Drizzle, так что инъекции через callback_data нет.
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
