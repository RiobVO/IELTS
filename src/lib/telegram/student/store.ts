import "server-only";
import { and, eq, isNotNull, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { telegramLink } from "@/db/schema";
import { generateLinkCode, hashLinkCode, LINK_CODE_TTL_MINUTES } from "./link-code";

/**
 * Состояние связки чат↔аккаунт (G2-1), owner-path (Drizzle, минует RLS): пишут
 * только server action профиля и вебхук бота — у клиентских ролей на эту таблицу
 * есть лишь SELECT своих строк (0061).
 */

export interface LinkStatus {
  linked: boolean;
  linkedAt: Date | null;
}

/** Состояние для страницы профиля. */
export async function getLinkStatus(userId: string): Promise<LinkStatus> {
  const [row] = await db
    .select({ chatId: telegramLink.chatId, linkedAt: telegramLink.linkedAt })
    .from(telegramLink)
    .where(eq(telegramLink.userId, userId))
    .limit(1);
  return { linked: row?.chatId != null, linkedAt: row?.linkedAt ?? null };
}

/**
 * Выдаёт свежий код привязки. Возвращает САМ код (единственный момент, когда он
 * существует в открытом виде) — в БД уходит только его хеш.
 *
 * Перевыдача разрешена всегда и затирает предыдущий код: человек, потерявший
 * вкладку, должен уметь начать заново. Отдельный троттл не нужен — писать может
 * только залогиненный владелец, и все его перевыдачи бьются в ОДНУ строку (PK по
 * user_id), так что раздуть таблицу этим нельзя.
 */
export async function issueLinkCode(userId: string): Promise<string> {
  const code = generateLinkCode();
  const codeHash = hashLinkCode(code);
  const expires = sql`now() + make_interval(mins => ${LINK_CODE_TTL_MINUTES})`;

  await db
    .insert(telegramLink)
    .values({ userId, codeHash, codeExpiresAt: expires as unknown as Date })
    .onConflictDoUpdate({
      target: telegramLink.userId,
      // chat_id не трогаем: пока новый код не предъявлен, старая связка работает.
      set: { codeHash, codeExpiresAt: expires as unknown as Date },
    });

  return code;
}

/**
 * Обмен кода на связку. Атомарен: UPDATE ... WHERE code_hash = $1 AND не истёк
 * RETURNING — параллельный второй обмен тем же кодом не найдёт строку, потому что
 * код гасится (code_hash = NULL) в том же запросе.
 *
 * Возвращает userId связанного аккаунта или null (код неверен/просрочен/использован).
 */
export async function redeemLinkCode(code: string, chatId: number): Promise<string | null> {
  const codeHash = hashLinkCode(code);

  // Один чат = один аккаунт: прежняя связка этого chat_id снимается, иначе UNIQUE
  // не даст привязать его к новому аккаунту, и человек, сменивший аккаунт, застрял бы
  // с непонятной ошибкой.
  await db.delete(telegramLink).where(eq(telegramLink.chatId, chatId));

  const updated = await db
    .update(telegramLink)
    .set({
      chatId,
      linkedAt: sql`now()` as unknown as Date,
      codeHash: null,
      codeExpiresAt: null,
    })
    .where(
      and(
        eq(telegramLink.codeHash, codeHash),
        isNotNull(telegramLink.codeExpiresAt),
        sql`${telegramLink.codeExpiresAt} > now()`,
      ),
    )
    .returning({ userId: telegramLink.userId });

  return updated[0]?.userId ?? null;
}

/** Кому принадлежит чат. null — чат не связан. */
export async function findUserByChat(chatId: number): Promise<string | null> {
  const [row] = await db
    .select({ userId: telegramLink.userId })
    .from(telegramLink)
    .where(eq(telegramLink.chatId, chatId))
    .limit(1);
  return row?.userId ?? null;
}

/** Полное отключение по чату (/stop) — строка удаляется целиком, без «мягкой паузы»:
 *  отписка должна значить именно то, что обещает. */
export async function unlinkByChat(chatId: number): Promise<string | null> {
  const removed = await db
    .delete(telegramLink)
    .where(eq(telegramLink.chatId, chatId))
    .returning({ userId: telegramLink.userId });
  return removed[0]?.userId ?? null;
}

/** Отключение из профиля (кнопка Disconnect). */
export async function unlinkByUser(userId: string): Promise<void> {
  await db.delete(telegramLink).where(eq(telegramLink.userId, userId));
}

/** Запоминает, на какой вопрос бот ждёт свободный ответ текстом. */
export async function setPendingQuestion(
  userId: string,
  contentItemId: string,
  questionNumber: number,
): Promise<void> {
  await db
    .update(telegramLink)
    .set({
      pendingContentItemId: contentItemId,
      pendingQuestionNumber: questionNumber,
      pendingAskedAt: sql`now()` as unknown as Date,
    })
    .where(eq(telegramLink.userId, userId));
}

export interface PendingQuestion {
  contentItemId: string;
  questionNumber: number;
}

/** Забирает ожидание ответа и СРАЗУ его снимает: одно сообщение — один вердикт. */
export async function takePendingQuestion(userId: string): Promise<PendingQuestion | null> {
  const cleared = await db
    .update(telegramLink)
    .set({ pendingContentItemId: null, pendingQuestionNumber: null, pendingAskedAt: null })
    .where(and(eq(telegramLink.userId, userId), isNotNull(telegramLink.pendingQuestionNumber)))
    .returning({
      contentItemId: telegramLink.pendingContentItemId,
      questionNumber: telegramLink.pendingQuestionNumber,
    });
  const row = cleared[0];
  if (!row?.contentItemId || row.questionNumber == null) return null;
  return { contentItemId: row.contentItemId, questionNumber: row.questionNumber };
}

export interface NudgeTarget {
  userId: string;
  chatId: number;
}

/**
 * Кому сегодня ещё не писали (UTC-день). Условие «last_nudge_on отличается от
 * сегодня» и есть идемпотентность рассылки: повторный прогон крона в тот же день
 * вернёт пустой список.
 */
export async function listNudgeTargets(today: string, limit: number): Promise<NudgeTarget[]> {
  const rows = await db
    .select({ userId: telegramLink.userId, chatId: telegramLink.chatId })
    .from(telegramLink)
    .where(
      and(
        isNotNull(telegramLink.chatId),
        or(sql`${telegramLink.lastNudgeOn} is null`, ne(telegramLink.lastNudgeOn, today)),
      ),
    )
    .limit(limit);
  return rows.filter((r): r is NudgeTarget => r.chatId != null);
}

/** Отмечает день отправки — вторая половина идемпотентности рассылки. */
export async function markNudged(userId: string, today: string): Promise<void> {
  await db
    .update(telegramLink)
    .set({ lastNudgeOn: today })
    .where(eq(telegramLink.userId, userId));
}
