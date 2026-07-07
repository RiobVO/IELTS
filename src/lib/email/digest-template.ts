/**
 * Билдер weekly digest письма — чистая функция (без БД/сети), продукт на английском
 * (язык интерфейса). Инлайн-стили + одна колонка без внешних ресурсов/картинок —
 * так почтовые клиенты не режут вёрстку и не блокируют deliverability.
 */
export type DigestStats = {
  testsCount: number;
  avgBand: number | null; // средний band (только full-40Q attempts)
  avgPercent: number | null; // средний % правильных
  rating: number;
  ratingDelta: number | null; // null на первой неделе (нет прошлой точки сравнения)
  weekStart: string; // ISO date (UTC)
  weekEnd: string;
  unsubscribeUrl: string | null;
};

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * Даты в DigestStats — YYYY-MM-DD, а `new Date("YYYY-MM-DD")` парсит их как UTC-
 * полночь (ECMA-402 Date Time String Format) — ровно то, что нужно без библиотек
 * и без риска съехать на локальный TZ сервера.
 */
function formatUtcDate(iso: string): { month: string; day: number; year: number } {
  const d = new Date(iso);
  return {
    month: MONTH_NAMES[d.getUTCMonth()],
    day: d.getUTCDate(),
    year: d.getUTCFullYear(),
  };
}

/** "Jun 30 – Jul 6, 2026"; год у старта опускаем, если совпадает с концом недели. */
function formatWeekRange(weekStart: string, weekEnd: string): string {
  const start = formatUtcDate(weekStart);
  const end = formatUtcDate(weekEnd);
  const startStr =
    start.year === end.year
      ? `${start.month} ${start.day}`
      : `${start.month} ${start.day}, ${start.year}`;
  const endStr = `${end.month} ${end.day}, ${end.year}`;
  return `${startStr} – ${endStr}`;
}

/** Экранирование для HTML-атрибута (href) — амперсанды в подписанном токене иначе рвут разметку. */
function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatRatingLine(rating: number, delta: number | null): string {
  if (delta === null) return `Rating: ${rating}`;
  const sign = delta >= 0 ? "+" : "-";
  return `Rating: ${rating} (${sign}${Math.abs(delta)})`;
}

export function buildDigestEmail(stats: DigestStats): { subject: string; html: string } {
  const subject = `Your IELTS week: ${stats.testsCount} tests`;
  const weekRange = formatWeekRange(stats.weekStart, stats.weekEnd);

  const statLines: string[] = [];
  if (stats.avgBand !== null) {
    statLines.push(`Average band ${stats.avgBand.toFixed(1)}`);
  }
  if (stats.avgPercent !== null) {
    statLines.push(`Average score ${Math.round(stats.avgPercent)}%`);
  }
  statLines.push(formatRatingLine(stats.rating, stats.ratingDelta));

  const statsHtml = statLines
    .map((line) => `<p style="margin:0 0 8px;font-size:15px;color:#333333;">${line}</p>`)
    .join("\n              ");

  const unsubscribeHtml =
    stats.unsubscribeUrl !== null
      ? `<p style="margin:8px 0 0;"><a href="${escapeHtmlAttr(stats.unsubscribeUrl)}" style="color:#999999;">Unsubscribe</a></p>`
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
              <h1 style="margin:0 0 16px;font-size:20px;color:#1a1a2e;">Your IELTS week</h1>
              <p style="margin:0 0 16px;font-size:14px;color:#666666;">${weekRange}</p>
              <p style="margin:0 0 12px;font-size:15px;color:#333333;"><strong>${stats.testsCount}</strong> test${stats.testsCount === 1 ? "" : "s"} completed this week</p>
              ${statsHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 24px;border-top:1px solid #eeeeee;font-size:12px;color:#999999;">
              <p style="margin:0;">You're receiving this because you have an IELTS account with the weekly digest enabled.</p>
              ${unsubscribeHtml}
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
