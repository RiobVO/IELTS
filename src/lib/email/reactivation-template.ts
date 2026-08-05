/**
 * Письмо возврата (G2-4). Отдельный шаблон, а не ветка дайджеста: дайджест
 * рассказывает о неделе, которая БЫЛА, а здесь недели не было — отчитываться не о
 * чем, и единственная честная причина написать это то, что появилось нового и
 * сколько человек уже сделал до паузы.
 *
 * ЧИСТЫЙ модуль (без server-only/db/env), как digest-template.ts: собирается и
 * тестируется без почтового провайдера.
 */

export interface ReactivationEmailInput {
  /** Дней тишины — определяет тон: 7 «на этой неделе», 14 «две недели». */
  daysSilent: number;
  /** Сколько тестов опубликовано за последнюю неделю; 0 — крючка о новинках нет. */
  newTestsThisWeek: number;
  /** Стрик на момент ухода — то, что человек потерял, если он был. */
  lastStreak: number;
  /** Куда вести (уже с ?src= для атрибуции); null — ссылки не будет. */
  practiceUrl: string | null;
  unsubscribeUrl: string | null;
}

/** Минимальный HTML-эскейп (копия дисциплины digest-template: данные в письмо
 *  подставляем только экранированными). */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Тема письма. Без фальшивой срочности и без вины («ты забросил») — обещание
 * конкретной пользы: то, что появилось, пока человека не было.
 */
export function reactivationSubject(input: ReactivationEmailInput): string {
  if (input.newTestsThisWeek > 0) {
    return input.newTestsThisWeek === 1
      ? "A new IELTS test is waiting for you"
      : `${input.newTestsThisWeek} new IELTS tests are waiting for you`;
  }
  return input.daysSilent >= 14 ? "Your IELTS practice is on pause" : "Pick your IELTS practice back up";
}

export function buildReactivationEmail(input: ReactivationEmailInput): {
  subject: string;
  html: string;
} {
  const subject = reactivationSubject(input);

  const leadLine =
    input.daysSilent >= 14
      ? "It's been two weeks since your last test."
      : "It's been a week since your last test.";

  const newTestsLine =
    input.newTestsThisWeek > 0
      ? `<p style="margin:0 0 12px;font-size:15px;color:#333333;"><strong>${input.newTestsThisWeek}</strong> new test${input.newTestsThisWeek === 1 ? " has" : "s have"} been published since then.</p>`
      : "";

  // Стрик упоминаем только если он был: «you had a 0-day streak» — насмешка.
  const streakLine =
    input.lastStreak > 0
      ? `<p style="margin:0 0 12px;font-size:15px;color:#333333;">You were on a ${input.lastStreak}-day streak. One test starts a new one.</p>`
      : `<p style="margin:0 0 12px;font-size:15px;color:#333333;">One test is enough to get moving again — Reading and Listening stay free.</p>`;

  const ctaHtml = input.practiceUrl
    ? `<p style="margin:20px 0 0;"><a href="${escapeHtml(input.practiceUrl)}" style="display:inline-block;padding:12px 20px;background-color:#5b4fe0;color:#ffffff;border-radius:6px;text-decoration:none;font-size:15px;">Practice now &rarr;</a></p>`
    : "";

  const unsubscribeHtml = input.unsubscribeUrl
    ? `<p style="margin:8px 0 0;"><a href="${escapeHtml(input.unsubscribeUrl)}" style="color:#999999;">Unsubscribe</a></p>`
    : "";

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background-color:#f4f4f7;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f7;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#ffffff;border-radius:8px;">
            <tr>
              <td style="padding:32px 24px;">
              <h1 style="margin:0 0 16px;font-size:20px;color:#1a1a2e;">${escapeHtml(leadLine)}</h1>
              ${newTestsLine}
              ${streakLine}
              ${ctaHtml}
              <div style="margin:24px 0 0;padding-top:16px;border-top:1px solid #eeeeee;">
              <p style="margin:0;font-size:12px;color:#999999;">You're getting this because you have a bando account.</p>
              ${unsubscribeHtml}
              </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, html };
}
