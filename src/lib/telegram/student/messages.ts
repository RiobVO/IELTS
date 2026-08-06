/**
 * Тексты студенческого бота (G2-1). ЧИСТЫЕ функции, EN — как весь продуктовый
 * интерфейс (админский бот импорта говорит по-русски, потому что его аудитория —
 * владелец, а не студенты).
 *
 * Тон: бот напоминает и проверяет, а не отчитывает. Он приходит к человеку, который
 * УЖЕ ошибся в этом вопросе, — «wrong again» здесь стоило бы отписки.
 */

/** Успешная привязка чата. */
export function linkedMessage(): string {
  return [
    "You're connected.",
    "",
    "Each evening I'll send you one question you got wrong before, so it stops being a weak spot.",
    "Answer right here — /question asks for one now, /stop disconnects.",
  ].join("\n");
}

/** Чат уже связан с этим же аккаунтом — повторный /start не должен пугать. */
export function alreadyLinkedMessage(): string {
  return "This chat is already connected. /question for one now, /stop to disconnect.";
}

/** Код не подошёл: не найден, просрочен или уже использован. */
export function invalidCodeMessage(): string {
  return [
    "That link has expired or was already used.",
    "Open your profile on bando.study and tap Connect Telegram to get a fresh one.",
  ].join("\n");
}

/** Сообщение чату, который боту незнаком. */
export function notLinkedMessage(): string {
  return [
    "I don't know which account this chat belongs to yet.",
    "Open your profile on bando.study and tap Connect Telegram — it takes one tap.",
  ].join("\n");
}

/** Отключение. Без уговоров остаться: это подрывает доверие к кнопке отписки. */
export function stoppedMessage(): string {
  return "Disconnected. I won't message you again. You can reconnect any time from your profile.";
}

export function helpMessage(): string {
  return [
    "What I can do:",
    "",
    "/question — one question you previously got wrong",
    "/stop — disconnect this chat",
    "",
    "Full practice, mocks and explanations live on bando.study.",
  ].join("\n");
}

/** Нечего спросить: due-очередь пуста. */
export function nothingDueMessage(practiceUrl: string | null): string {
  const tail = practiceUrl ? `\n\nTake a test and I'll have something: ${practiceUrl}` : "";
  return `Nothing due for review right now — your mistakes are all caught up.${tail}`;
}

/**
 * Повторить есть что, но не в чате: matching-задания адресуют кусок пассажа, и без
 * текста они нерешаемы. Честно зовём на сайт вместо задачи без условия.
 */
export function mistakesOnSiteMessage(count: number, mistakesUrl: string | null): string {
  const head =
    count === 1
      ? "1 mistake is due for review — it needs the passage in front of you."
      : `${count} mistakes are due for review — they need the passage in front of you.`;
  return mistakesUrl ? `${head}\n\n${mistakesUrl}` : head;
}

/** Приглашение к вопросу дня. Номер и тест — контекст, чтобы вопрос не висел в пустоте. */
export function questionMessage(q: {
  prompt: string;
  testTitle: string;
  questionNumber: number;
  hasOptions: boolean;
}): string {
  const head = `${q.testTitle} · Q${q.questionNumber}`;
  const tail = q.hasOptions ? "" : "\n\nReply with your answer.";
  return `${head}\n\n${q.prompt}${tail}`;
}

/** Вердикт. Неверный ответ показывает правильный: это ошибка самого юзера, он уже
 *  видел её разбор на сайте, и повтор без ответа — просто щелчок по носу. */
export function verdictMessage(input: {
  correct: boolean;
  expected: string | null;
  reviewUrl: string | null;
}): string {
  const lines: string[] = [];
  if (input.correct) {
    lines.push("Correct.");
  } else {
    lines.push(input.expected ? `Not quite — the answer is: ${input.expected}` : "Not quite.");
  }
  if (input.reviewUrl) {
    lines.push("", `Close it properly with the full explanation: ${input.reviewUrl}`);
  }
  return lines.join("\n");
}

/** Стрик под угрозой — второй по приоритету повод написать. */
export function streakMessage(streak: number, practiceUrl: string | null): string {
  const head = `Your ${streak}-day streak ends today unless you practise.`;
  return practiceUrl ? `${head}\n\n${practiceUrl}` : head;
}
