import { NextResponse } from "next/server";
import { studentBotConfig } from "@/env";
import { captureServer } from "@/lib/analytics/server";
import { logError } from "@/lib/monitoring/log-error";
import { webhookSecretValid } from "@/lib/telegram/auth";
import {
  answerStudentCallback,
  clearInlineKeyboard,
  sendStudentMessage,
} from "@/lib/telegram/student/client";
import { parseCommand, parseDailyQuestionCallback } from "@/lib/telegram/student/commands";
import {
  checkDailyAnswer,
  countDueMistakes,
  pickDailyQuestion,
  type DailyQuestion,
} from "@/lib/telegram/student/daily-question";
import { deliverQuestion, mistakesUrl, practiceUrl } from "@/lib/telegram/student/deliver";
import { parseStartPayload } from "@/lib/telegram/student/link-code";
import * as msg from "@/lib/telegram/student/messages";
import {
  findUserByChat,
  redeemLinkCode,
  takePendingQuestion,
  unlinkByChat,
} from "@/lib/telegram/student/store";

/**
 * Вебхук СТУДЕНЧЕСКОГО бота (G2-1) — напоминания и «вопрос дня».
 *
 * ЧЕМ ОН ОТЛИЧАЕТСЯ ОТ БОТА ИМПОРТА (app/api/telegram/webhook). Тот стоит на
 * whitelist'е Telegram user_id, потому что публикует контент. Этот открыт всем: сюда
 * может написать кто угодно, поэтому chat_id сам по себе не даёт НИЧЕГО. Всё, что
 * бот отвечает незнакомому чату, — приглашение связать аккаунт; данные появляются
 * только после обмена одноразового кода, выданного залогиненным владельцем.
 *
 * Секрет вебхука обязателен в проде (fail closed, как у бота импорта). Всегда 200,
 * кроме неверного секрета: Telegram ретраит на любой не-2xx, а повтор апдейта нам
 * ничего не чинит.
 */
export const dynamic = "force-dynamic";

interface TgUpdate {
  message?: {
    chat: { id: number };
    text?: string;
  };
  callback_query?: {
    id: string;
    data?: string;
    message?: { chat: { id: number }; message_id?: number };
  };
}

const ok = () => NextResponse.json({ ok: true });

function isProduction(): boolean {
  return process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
}

/** Отдаёт вердикт и убирает ожидание. Общий хвост кнопок и текстового ответа. */
async function replyVerdict(
  token: string,
  chatId: number,
  userId: string,
  contentItemId: string,
  questionNumber: number,
  value: string,
): Promise<void> {
  const verdict = await checkDailyAnswer(contentItemId, questionNumber, value);
  if (!verdict) {
    await sendStudentMessage(token, chatId, msg.nothingDueMessage(practiceUrl()));
    return;
  }
  await sendStudentMessage(
    token,
    chatId,
    msg.verdictMessage({
      correct: verdict.correct,
      expected: verdict.expected,
      reviewUrl: mistakesUrl(),
    }),
  );
  await captureServer("nudge_open", userId, { channel: "telegram", kind: "daily_question" });
}

async function handleMessage(token: string, chatId: number, text: string): Promise<void> {
  // 1) Привязка — единственное, что доступно НЕсвязанному чату.
  const startCode = parseStartPayload(text);
  if (startCode) {
    const userId = await redeemLinkCode(startCode, chatId);
    await sendStudentMessage(token, chatId, userId ? msg.linkedMessage() : msg.invalidCodeMessage());
    return;
  }

  const userId = await findUserByChat(chatId);
  if (!userId) {
    await sendStudentMessage(token, chatId, msg.notLinkedMessage());
    return;
  }

  const command = parseCommand(text);
  if (command === "stop") {
    await unlinkByChat(chatId);
    await sendStudentMessage(token, chatId, msg.stoppedMessage());
    return;
  }
  if (command === "help" || command === "start") {
    await sendStudentMessage(
      token,
      chatId,
      command === "start" ? msg.alreadyLinkedMessage() : msg.helpMessage(),
    );
    return;
  }
  if (command === "question") {
    const q = await pickDailyQuestion(userId);
    if (q) {
      await deliverQuestion(token, chatId, userId, q);
      return;
    }
    // Решаемого в чате нет — но, может, есть matching-задания, которым нужен пассаж.
    const due = await countDueMistakes(userId);
    await sendStudentMessage(
      token,
      chatId,
      due > 0 ? msg.mistakesOnSiteMessage(due, mistakesUrl()) : msg.nothingDueMessage(practiceUrl()),
    );
    return;
  }

  // 2) Свободный текст: ответ на заданный вопрос, если бот его ждёт. Иначе — подсказка.
  const pending = await takePendingQuestion(userId);
  if (!pending) {
    await sendStudentMessage(token, chatId, msg.helpMessage());
    return;
  }
  await replyVerdict(token, chatId, userId, pending.contentItemId, pending.questionNumber, text.trim());
}

async function handleCallback(
  token: string,
  callbackId: string,
  chatId: number,
  messageId: number | null,
  data: string,
): Promise<void> {
  const userId = await findUserByChat(chatId);
  if (!userId) {
    await answerStudentCallback(token, callbackId);
    await sendStudentMessage(token, chatId, msg.notLinkedMessage());
    return;
  }

  const cb = parseDailyQuestionCallback(data);
  if (!cb) {
    await answerStudentCallback(token, callbackId);
    return; // не наша кнопка — молча игнорируем
  }

  // ПЕРВЫЙ ответ побеждает: takePendingQuestion снимает ожидание одним UPDATE ...
  // RETURNING, поэтому повторные нажатия по тем же кнопкам (или гонка двух нажатий)
  // вердикта уже не получают — иначе правильный ответ вскрывался бы перебором.
  const pending = await takePendingQuestion(userId);
  const isThisQuestion =
    pending?.contentItemId === cb.contentItemId && pending?.questionNumber === cb.questionNumber;
  if (!pending || !isThisQuestion) {
    await answerStudentCallback(token, callbackId, "Already answered");
    if (messageId != null) await clearInlineKeyboard(token, chatId, messageId);
    return;
  }

  // Значение варианта восстанавливаем из САМОГО вопроса, а не из callback_data:
  // в 64 байта лимита текст ответа не влезает, да и доверять содержимому кнопки,
  // пришедшему от клиента, незачем — индекс проверяется по серверному списку.
  const q = await pickDailyQuestionFor(userId, cb.contentItemId, cb.questionNumber);
  const value = q?.options?.[cb.optionIndex]?.value;
  await answerStudentCallback(token, callbackId);
  if (messageId != null) await clearInlineKeyboard(token, chatId, messageId);
  if (!value) return;

  await replyVerdict(token, chatId, userId, cb.contentItemId, cb.questionNumber, value);
}

/** Вопрос из очереди юзера по (тест, номер) — гарантия, что кнопка относится к его
 *  собственной ошибке, а не к произвольному вопросу каталога, подставленному руками. */
async function pickDailyQuestionFor(
  userId: string,
  contentItemId: string,
  questionNumber: number,
): Promise<DailyQuestion | null> {
  const q = await pickDailyQuestion(userId);
  if (q && q.contentItemId === contentItemId && q.questionNumber === questionNumber) return q;
  return null;
}

export async function POST(request: Request): Promise<NextResponse> {
  const cfg = studentBotConfig();
  if (!cfg) return ok(); // бот не сконфигурирован — no-op

  if (cfg.webhookSecret) {
    if (!webhookSecretValid(request.headers.get("x-telegram-bot-api-secret-token"), cfg.webhookSecret)) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }
  } else if (isProduction()) {
    // Fail closed: открытый вебхук в проде принимал бы апдейты от кого угодно.
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let update: TgUpdate;
  try {
    update = (await request.json()) as TgUpdate;
  } catch {
    return ok(); // тело не разобрать — ретрай не поможет
  }

  try {
    if (update.message?.text && update.message.chat?.id) {
      await handleMessage(cfg.token, update.message.chat.id, update.message.text);
    } else if (update.callback_query?.message?.chat?.id) {
      await handleCallback(
        cfg.token,
        update.callback_query.id,
        update.callback_query.message.chat.id,
        update.callback_query.message.message_id ?? null,
        update.callback_query.data ?? "",
      );
    }
  } catch (e) {
    await logError({
      source: "server",
      message: `student bot update failed: ${e instanceof Error ? e.message : String(e)}`,
      stack: e instanceof Error ? e.stack : null,
      url: request.url,
      context: { route: "/api/telegram/student" },
    });
  }

  return ok();
}
