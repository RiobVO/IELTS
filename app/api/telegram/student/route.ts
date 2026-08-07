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
  loadQuestionOptions,
  pickDailyQuestion,
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
    // Ключа больше нет (тест переимпортировали/удалили). Человек ответил и обязан
    // получить хоть что-то, а причина — попасть в лог, а не в пустоту.
    await logError({
      source: "server",
      message: "student bot: no answer key for the answered question",
      userId,
      context: { op: "replyVerdict", contentItemId, questionNumber },
    });
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
    const pick = await pickDailyQuestion(userId);
    if (pick.question) {
      await deliverQuestion(token, chatId, userId, pick.question);
      return;
    }
    // Решаемого в чате нет. Но, может, есть задания, которым нужен пассаж, — тогда
    // честнее позвать на сайт, чем сказать «всё чисто».
    await sendStudentMessage(
      token,
      chatId,
      pick.dueTotal > 0
        ? msg.mistakesOnSiteMessage(pick.dueTotal, mistakesUrl())
        : msg.nothingDueMessage(practiceUrl()),
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
    await answerStudentCallback(token, callbackId); // не наша кнопка — молча гасим часики
    return;
  }

  // ПЕРВОЕ нажатие побеждает. Заявка на ответ атомарна (SELECT ... FOR UPDATE), и
  // берётся ТОЛЬКО на тот вопрос, по которому нажали, — поэтому ни повтор по тем же
  // кнопкам, ни тап по вчерашнему сообщению вердикта уже не дают. Без этого
  // правильный ответ вскрывался перебором: три нажатия — три вердикта.
  const claimed = await takePendingQuestion(userId, {
    contentItemId: cb.contentItemId,
    questionNumber: cb.questionNumber,
  });
  if (!claimed) {
    await answerStudentCallback(token, callbackId, "Already answered");
    if (messageId != null) await clearInlineKeyboard(token, chatId, messageId);
    return;
  }

  // Грейдится `value` варианта, а не его подпись: у matching_headings ключ — «iii»,
  // а на кнопке стоит текст заголовка.
  const options = await loadQuestionOptions(cb.contentItemId, cb.questionNumber);
  const value = options?.[cb.optionIndex]?.value;
  await answerStudentCallback(token, callbackId);
  if (messageId != null) await clearInlineKeyboard(token, chatId, messageId);

  if (!value) {
    // Молчание тут выглядит как «бот проглотил ответ»: человек нажал, кнопки
    // исчезли, вердикта нет. Пишем причину и говорим об этом вслух.
    await logError({
      source: "server",
      message: "student bot: callback without a resolvable option",
      userId,
      context: {
        op: "handleCallback",
        contentItemId: cb.contentItemId,
        questionNumber: cb.questionNumber,
        optionIndex: cb.optionIndex,
        optionsCount: options?.length ?? null,
      },
    });
    await sendStudentMessage(token, chatId, msg.nothingDueMessage(practiceUrl()));
    return;
  }

  await replyVerdict(token, chatId, userId, cb.contentItemId, cb.questionNumber, value);
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
