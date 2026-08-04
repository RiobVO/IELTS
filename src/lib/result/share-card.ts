/**
 * Публичная share-карточка результата (growth-волна 1, G1-5). Чистая часть: что
 * именно попадает на картинку и какими словами.
 *
 * Инвариант приватности: карточка публична (её тянет краулер Telegram без сессии),
 * поэтому в неё едут ТОЛЬКО band/процент, название теста и слабейший тип вопросов.
 * Никогда — ответы, ключ, e-mail, имя владельца или id попытки.
 */

/** Разбивка попытки по типам вопросов (attempt.per_type_breakdown). */
export type ShareBreakdown = Record<string, { correct: number; total: number }> | null;

/**
 * Слабейший тип вопросов попытки: минимальная доля правильных. Ничьи решаются
 * первым встреченным (порядок объекта = порядок вставки грейдингом), полностью
 * правильная попытка слабого типа НЕ имеет — тогда на карточке живёт похвала, а
 * не выдуманная слабость.
 *
 * Битые/нечисловые листья пропускаются (тот же null-guard, что в aggregateWeakness):
 * одна кривая строка не должна ронять публичный рендер.
 */
export function weakestType(breakdown: ShareBreakdown): string | null {
  if (!breakdown || typeof breakdown !== "object") return null;
  let worst: string | null = null;
  let worstRatio = Infinity;
  let allCorrect = true;
  for (const [type, v] of Object.entries(breakdown)) {
    if (!v || typeof v !== "object") continue;
    const correct = Number(v.correct);
    const total = Number(v.total);
    if (!Number.isFinite(correct) || !Number.isFinite(total) || total <= 0) continue;
    if (correct < total) allCorrect = false;
    const ratio = correct / total;
    if (ratio < worstRatio) {
      worstRatio = ratio;
      worst = type;
    }
  }
  return allCorrect ? null : worst;
}

/**
 * Крупная строка карточки: band, если тест 40-вопросный (band_scale есть), иначе
 * процент. Никаких «7.0+» и округлений вверх — то же число, что юзер видит в разборе.
 */
export function shareScoreLabel(band: number | null, correctPct: number): string {
  return band != null ? band.toFixed(1) : `${correctPct}%`;
}

/** Подпись под числом: что это за метрика (band vs процент). */
export function shareScoreCaption(band: number | null): string {
  return band != null ? "IELTS band" : "correct answers";
}

/**
 * Заголовок публичной страницы и og:title. Слабый тип называем прямо — это и есть
 * крючок: карточка обещает не «я молодец», а «вот что мне мешает», и читателю
 * хочется узнать своё.
 */
export function shareTitle(scoreLabel: string, band: number | null): string {
  return band != null ? `IELTS band ${scoreLabel} on bando` : `${scoreLabel} correct on bando`;
}

/** og:description — тест + слабейший тип (или похвала за чистую попытку). */
export function shareDescription(testTitle: string, weakLabel: string | null): string {
  return weakLabel
    ? `${testTitle} — weakest question type: ${weakLabel}. Take the same test free and find yours.`
    : `${testTitle} — every question type clean. Take the same test free and see where you land.`;
}
