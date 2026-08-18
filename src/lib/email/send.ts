import "server-only";
import { logError } from "@/lib/monitoring/log-error";

const BREVO_URL = "https://api.brevo.com/v3/smtp/email";
const TIMEOUT_MS = 10_000;

/** Логируем адресата без локальной части почты (PII-гигиена) — тот же принцип,
 *  что stripQuery в src/lib/monitoring/log-error.ts для URL. */
function emailDomain(email: string): string {
  const at = email.indexOf("@");
  return at >= 0 ? email.slice(at + 1) : email;
}

/**
 * Отправка письма через Brevo transactional API. НИКОГДА не бросает — вызывающий
 * (cron/дайджест) не должен падать на разовом сбое провайдера/сети/таймауте;
 * возвращаем false и логируем через logError (structured console.error + строка
 * в error_log, см. log-error.ts). List-Unsubscribe-заголовки добавляются только
 * когда есть ссылка отписки (one-click unsubscribe в почтовых клиентах,
 * поддерживающих RFC 8058).
 */
export async function sendEmail(
  cfg: { apiKey: string; from: string; fromName?: string },
  msg: { to: string; subject: string; html: string; unsubscribeUrl?: string | null },
): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(BREVO_URL, {
      method: "POST",
      headers: {
        "api-key": cfg.apiKey,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        sender: { email: cfg.from, name: cfg.fromName },
        to: [{ email: msg.to }],
        subject: msg.subject,
        htmlContent: msg.html,
        headers: msg.unsubscribeUrl
          ? {
              "List-Unsubscribe": `<${msg.unsubscribeUrl}>`,
              "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
            }
          : undefined,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      await logError({
        source: "server",
        message: "sendEmail: brevo non-2xx",
        context: { op: "sendEmail", status: res.status, to: emailDomain(msg.to) },
      });
      return false;
    }
    return true;
  } catch (e) {
    await logError({
      source: "server",
      message: "sendEmail: request failed",
      stack: e instanceof Error ? e.stack : null,
      context: { op: "sendEmail", to: emailDomain(msg.to) },
    });
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
