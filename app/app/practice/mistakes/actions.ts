"use server";

/**
 * P9-rich «вариант B»: резолюция ошибки («Mark learned»). ЕДИНСТВЕННЫЙ путь записи в
 * mistake_resolution — owner-path серверным экшеном (клиентских INSERT/UPDATE grant у
 * authenticated нет, RLS + revoke). Гейт по эталону practice-actions: user_id берётся
 * ТОЛЬКО из auth-сессии, из формы НЕ принимается. Открытые ошибки НЕ материализуются —
 * этот экшен лишь добавляет факт «отработано», вычитаемый на чтении (getOpenMistakes).
 */

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { mistakeResolution, question } from "@/db/schema";
import { getUser } from "@/lib/auth";
import { isUuid } from "@/lib/uuid";

/**
 * Отметить ошибку отработанной. Best-effort: невалидный вход / сбой → тихий no-op
 * (в клиент не бросаем). qtype клиенту НЕ доверяем — берём авторитетно из question
 * по (content_item, number); нет такого вопроса → no-op (заодно отсекает forged-вызовы
 * с произвольными номерами). Резолюция впрок безвредна и без этого: деривация гасит
 * ошибку только когда resolved_at >= submitted_at попытки (см. deriveOpenMistakes).
 * ON CONFLICT DO UPDATE resolved_at (не DO NOTHING): переоткрытая ошибка (новая
 * wrong-попытка после старого «Mark learned») должна перегасываться свежим
 * resolved_at, иначе старая дата держит карточку открытой навсегда. Семантика —
 * «последнее закрытие»; unique(user_id, content_item_id, number) не даёт задвоиться.
 */
export async function resolveMistake(
  contentItemId: string,
  questionNumber: number,
): Promise<void> {
  const user = await getUser();
  if (!user) return; // не авторизован — user_id только из сессии, форме не доверяем
  // client-reachable: кривой uuid не должен ронять uuid-колонку (22P02) — screen заранее.
  if (!isUuid(contentItemId)) return;
  if (!Number.isInteger(questionNumber) || questionNumber < 1) return;

  try {
    const [q] = await db
      .select({ qtype: question.qtype })
      .from(question)
      .where(and(eq(question.contentItemId, contentItemId), eq(question.number, questionNumber)))
      .limit(1);
    if (!q) return; // вопроса нет в тесте — резолюцию не пишем

    await db
      .insert(mistakeResolution)
      .values({ userId: user.id, contentItemId, questionNumber, qtype: q.qtype })
      .onConflictDoUpdate({
        target: [mistakeResolution.userId, mistakeResolution.contentItemId, mistakeResolution.questionNumber],
        set: { resolvedAt: new Date() },
      });
    revalidatePath("/app/practice/mistakes");
  } catch (e) {
    console.error("resolveMistake failed", e);
  }
}
