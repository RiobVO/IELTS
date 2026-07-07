import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profile } from "@/db/schema";
import { cronSecret } from "@/env";
import { verifyUnsubscribeToken } from "@/lib/email/unsubscribe-token";
import { isUuid } from "@/lib/uuid";

/**
 * Публичный one-click unsubscribe (BRIEF §11/§12.1) — ссылка из weekly digest
 * (weekly-digest.ts), кликается без логина, поэтому auth = HMAC-токен, не сессия.
 * Секрет тот же, что подписывает ссылку (cronSecret() — общий с cron-роутами,
 * отдельного env не заводим). Middleware исключает /api/email из auth-сессии
 * (см. matcher) — иначе разлогиненного получателя письма редиректнуло бы на /auth
 * раньше, чем этот handler вообще увидит запрос.
 *
 * Анти-энумерация: невалидный/просроченный токен и несуществующий userId дают
 * ОДИНАКОВЫЙ ответ (400 с нейтральным телом либо 200 с нейтральным телом) — по
 * ответу нельзя понять, существует ли аккаунт. uuid-формат u проверяется ДО
 * похода в БД/HMAC (дёшево отсекает мусор, парирует 22P02 на кривом id).
 */
export const dynamic = "force-dynamic";

function htmlResponse(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

const INVALID_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Unsubscribe</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 480px; margin: 64px auto; padding: 0 16px; color: #1a1a1a;">
  <p>This unsubscribe link is invalid or expired.</p>
</body>
</html>`;

const SUCCESS_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Unsubscribed</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 480px; margin: 64px auto; padding: 0 16px; color: #1a1a1a;">
  <p>You've been unsubscribed from the weekly digest.</p>
  <p>You can turn it back on anytime in your profile settings.</p>
</body>
</html>`;

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const u = url.searchParams.get("u");
  const t = url.searchParams.get("t");

  // uuid-формат проверяем до любого похода в БД — мусорный u никогда не долетает
  // до eq(profile.id, u) (Postgres иначе бросил бы 22P02 на кривом uuid-каст).
  if (!isUuid(u)) {
    return htmlResponse(INVALID_HTML, 400);
  }

  // Fail-closed: verifyUnsubscribeToken сама возвращает false без секрета в конфиге.
  if (!verifyUnsubscribeToken(u, t ?? "", cronSecret())) {
    return htmlResponse(INVALID_HTML, 400);
  }

  try {
    // Идемпотентно: повторный клик просто повторяет тот же UPDATE. Ноль
    // затронутых строк (юзер удалён) — не ошибка, не палим существование аккаунта.
    await db
      .update(profile)
      .set({ weeklyDigestOptOut: true })
      .where(eq(profile.id, u));
  } catch (e) {
    console.error("unsubscribe route: db update failed", e);
    return htmlResponse(INVALID_HTML, 500);
  }

  return htmlResponse(SUCCESS_HTML, 200);
}
