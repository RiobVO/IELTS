import { NextResponse } from "next/server";
import { telegramConfig } from "@/env";
import {
  downloadFileText,
  getFilePath,
  sendMessage,
} from "@/lib/telegram/client";
import { parseTest } from "@/lib/import/parse-test";
import { persistTest, RegradeRequiredError } from "@/lib/import/persist";

/**
 * Telegram-бот импорта контента (admin-канал, аналог /admin upload). Админ кидает
 * боту HTML-файл теста — бот парсит тем же детерминированным pipeline
 * (parseTest -> persistTest) и сохраняет как draft. Публикация — в /admin (или
 * командой бота, этап 3).
 *
 * Middleware исключает /api/telegram из auth-сессии: запрос идёт от Telegram, а не
 * от залогиненного юзера. Граница безопасности — secret-token (от Telegram) +
 * whitelist по user_id: бот пишет owner-путём (в обход RLS), поэтому принимаем
 * файлы ТОЛЬКО от доверенных id. Всегда отвечаем 200 (кроме неверного secret),
 * чтобы Telegram не ретраил один и тот же апдейт (идемпотентность импорта — по
 * sourceFilePath в persistTest).
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
interface TgUpdate {
  message?: TgMessage;
}

const ok = () => NextResponse.json({ ok: true });

export async function POST(request: Request) {
  const cfg = telegramConfig();
  if (!cfg) return ok(); // бот не сконфигурирован — no-op

  // 1. Secret-token: если задан — обязан совпасть (отсекаем посторонние POST'ы,
  //    которые знают URL, но не секрет).
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

  const msg = update.message;
  if (!msg?.from) return ok();

  // 2. Whitelist: только доверенные админы. Бот пишет в БД owner-путём, поэтому
  //    круг отправителей — и есть граница доступа. Чужих игнорируем молча.
  if (!cfg.adminIds.includes(msg.from.id)) return ok();

  const chatId = msg.chat.id;

  // 3. Ждём HTML-документ теста.
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

  // 4. Скачать -> распарсить -> сохранить (draft). Любая ошибка уходит в чат, а
  //    апдейту всё равно отвечаем 200 (ретрай только размножил бы импорт).
  try {
    const path = await getFilePath(doc.file_id);
    const html = await downloadFileText(path);
    const parsed = parseTest(html);
    // createdBy опущен -> persistTest пишет null (у бота нет Supabase-сессии;
    // content_item.createdBy nullable). sourceFilePath даёт идемпотентность.
    await persistTest(parsed, { sourceFilePath: name });
    const warn = parsed.warnings.length
      ? `\n⚠️ предупреждений: ${parsed.warnings.length} — проверь в /admin`
      : "";
    await sendMessage(
      chatId,
      `✅ «${parsed.title}» сохранён как draft.\n` +
        `${parsed.section} · вопросов: ${parsed.questions.length}${warn}\n` +
        `Опубликовать — в /admin.`,
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
