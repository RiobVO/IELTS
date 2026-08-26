/**
 * Разбор входящего от студенческого бота (G2-1) — ЧИСТЫЙ слой: что человек прислал
 * и на что нажал. Держится отдельно от вебхука, потому что именно здесь проходит
 * граница доверия: `callback_data` и текст сообщения приходят от кого угодно, и
 * прежде чем идти с ними в БД, их нужно опознать и отбраковать.
 */

export type StudentCommand = "start" | "stop" | "help" | "question" | "none";

/** Команда из текста сообщения. `/start` с кодом разбирает parseStartPayload. */
export function parseCommand(text: string | null | undefined): StudentCommand {
  if (typeof text !== "string") return "none";
  const first = text.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  // Telegram в группах дописывает @botname — срезаем, чтобы команда узнавалась.
  const cmd = first.replace(/@\w+$/, "");
  switch (cmd) {
    case "/start":
      return "start";
    case "/stop":
      return "stop";
    case "/help":
      return "help";
    case "/question":
      return "question";
    default:
      return "none";
  }
}

/** Нажатие на вариант ответа: тест, номер вопроса и индекс выбранного варианта. */
export interface DailyQuestionCallback {
  contentItemId: string;
  questionNumber: number;
  optionIndex: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Разбор `callback_data` вида `dq:<uuid>:<qnum>:<optIdx>`. Формат прибит к 64-байтному
 * лимиту Telegram: uuid (36) + два малых числа укладываются с запасом.
 * `null` на всё, что не соответствует форме — включая чужие/склеенные данные.
 */
export function parseDailyQuestionCallback(
  data: string | null | undefined,
): DailyQuestionCallback | null {
  if (typeof data !== "string") return null;
  const parts = data.split(":");
  if (parts.length !== 4 || parts[0] !== "dq") return null;
  const [, id, qnumRaw, optRaw] = parts;
  if (!UUID.test(id)) return null;
  const questionNumber = Number(qnumRaw);
  const optionIndex = Number(optRaw);
  if (!Number.isInteger(questionNumber) || questionNumber <= 0) return null;
  if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex > 99) return null;
  return { contentItemId: id, questionNumber, optionIndex };
}

/** Сборка callback_data под кнопку варианта. */
export function buildDailyQuestionCallback(cb: DailyQuestionCallback): string {
  return `dq:${cb.contentItemId}:${cb.questionNumber}:${cb.optionIndex}`;
}
