"use server";

import { revalidatePath } from "next/cache";
import { studentBotConfig } from "@/env";
import { requireUser } from "@/lib/auth";
import { logError } from "@/lib/monitoring/log-error";
import { buildDeepLink } from "@/lib/telegram/student/link-code";
import { issueLinkCode, unlinkByUser } from "@/lib/telegram/student/store";

/**
 * Привязка/отвязка студенческого Telegram-бота из профиля (G2-1).
 *
 * Это и есть граница безопасности бота: код рождается ТОЛЬКО здесь, в контексте
 * залогиненного владельца (requireUser), и живёт 15 минут. Никакой другой путь не
 * может связать чат с аккаунтом — вебхук лишь обменивает предъявленный код.
 */

export type ConnectTelegramResult =
  | { ok: true; deepLink: string }
  | { ok: false; reason: "unavailable" | "failed" };

export async function connectTelegram(): Promise<ConnectTelegramResult> {
  const user = await requireUser();
  const cfg = studentBotConfig();
  // Без токена или имени бота ссылку не построить — честно говорим «недоступно»
  // вместо битого t.me/null.
  if (!cfg?.botUsername) return { ok: false, reason: "unavailable" };

  try {
    const code = await issueLinkCode(user.id);
    const deepLink = buildDeepLink(cfg.botUsername, code);
    if (!deepLink) return { ok: false, reason: "unavailable" };
    revalidatePath("/app/profile");
    return { ok: true, deepLink };
  } catch (e) {
    await logError({
      source: "server",
      message: `connectTelegram failed: ${e instanceof Error ? e.message : String(e)}`,
      stack: e instanceof Error ? e.stack : null,
      userId: user.id,
      context: { op: "connectTelegram" },
    });
    return { ok: false, reason: "failed" };
  }
}

export async function disconnectTelegram(): Promise<{ ok: boolean }> {
  const user = await requireUser();
  try {
    await unlinkByUser(user.id);
    revalidatePath("/app/profile");
    return { ok: true };
  } catch (e) {
    await logError({
      source: "server",
      message: `disconnectTelegram failed: ${e instanceof Error ? e.message : String(e)}`,
      stack: e instanceof Error ? e.stack : null,
      userId: user.id,
      context: { op: "disconnectTelegram" },
    });
    return { ok: false };
  }
}
