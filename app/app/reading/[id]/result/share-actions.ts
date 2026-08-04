"use server";

/**
 * Выдача публичной ссылки на share-карточку (G1-5).
 *
 * Гейт — прямо в WHERE: владелец ∧ СДАННАЯ попытка. Чужой или незаконченный
 * attempt не получит токена даже при подделанном id (проверка не в JS, а в
 * условии UPDATE — вернётся пустой RETURNING).
 *
 * Токен выдаётся ЛЕНИВО и ИДЕМПОТЕНТНО: `coalesce(share_token, gen_random_uuid())`
 * — повторный клик по Share отдаёт ту же ссылку, а не плодит новые (иначе каждая
 * пересылка порождала бы мёртвые URL). Пока никто не делился, колонка NULL и
 * публичной страницы у попытки просто нет.
 */
import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { db } from "@/db";
import { attempt } from "@/db/schema";
import { publicSiteUrl } from "@/env";
import { getUser } from "@/lib/auth";
import { logError } from "@/lib/monitoring/log-error";
import { isUuid } from "@/lib/uuid";

/** Абсолютный origin для ссылки: доверенный public origin, иначе — хост запроса. */
async function resolveOrigin(): Promise<string> {
  const configured = publicSiteUrl();
  if (configured) return configured;
  const h = await headers();
  const host = h.get("host");
  const proto = host?.startsWith("localhost") || host?.startsWith("127.") ? "http" : "https";
  return `${proto}://${host}`;
}

/**
 * Возвращает публичный URL карточки этой попытки или `null`, если делиться нечем
 * (не владелец / попытка не сдана / сбой). Клиент на `null` откатывается на
 * прежний текстовый шеринг — виральная кнопка не должна ломаться из-за перка.
 */
export async function createShareLink(attemptId: string): Promise<string | null> {
  const user = await getUser();
  if (!user || !isUuid(attemptId)) return null;
  try {
    const [row] = await db
      .update(attempt)
      .set({ shareToken: sql`coalesce(${attempt.shareToken}, gen_random_uuid())` })
      .where(
        and(
          eq(attempt.id, attemptId),
          eq(attempt.userId, user.id),
          eq(attempt.status, "submitted"),
        ),
      )
      .returning({ token: attempt.shareToken });
    if (!row?.token) return null;
    // ?src= — атрибуция канала (P5): регистрации с расшаренных карточек видно
    // отдельно от постов в каналах. Реф-код едет НЕ здесь, а в CTA самой страницы
    // (её сервер знает код владельца) — так ссылка остаётся короткой и не палит,
    // кто именно поделился, до перехода.
    return `${await resolveOrigin()}/s/${row.token}?src=share_card`;
  } catch (e) {
    await logError({
      source: "server",
      message: `createShareLink failed: ${e instanceof Error ? e.message : String(e)}`,
      stack: e instanceof Error ? e.stack : null,
      userId: user.id,
      context: { op: "createShareLink", attemptId },
    });
    return null;
  }
}
