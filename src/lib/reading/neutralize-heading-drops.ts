import { load } from "cheerio";

/**
 * Нейтрализует пассажные Matching-Headings drop-зоны для practice-verbatim пути.
 *
 * Зачем: в verbatim-practice сами heading-вопросы рендерятся управляемыми `<select>`
 * в панели вопросов (`QuestionHtml`), поэтому `.heading-drop` в теле пассажа —
 * дублирующая, к тому же неинтерактивная (обработчик drag-drop живёт только в
 * iframe-mock). Оставляем номерную метку видимой, но снимаем интерактивную
 * семантику: `role`/`tabindex`/`aria-label`/`data-type`/`data-identifier` убираем,
 * ставим `aria-hidden` + класс `.hd-passive` (стиль — PassagePane).
 *
 * Применяется ТОЛЬКО на practice-verbatim пути (mode='practice' ∧ есть questions_html);
 * mock-путь (`/app/exam` iframe и `/app/reading` mode='mock') не трогается — вызов
 * гейтится на стороне page.tsx, а `normalize-passage` (общий) не меняется.
 */
export function neutralizeHeadingDrops(html: string): string {
  const $ = load(html, null, false);
  const drops = $(".heading-drop");
  if (drops.length === 0) return html;
  drops.each((_, el) => {
    $(el)
      .removeAttr("role")
      .removeAttr("tabindex")
      .removeAttr("aria-label")
      .removeAttr("data-type")
      .removeAttr("data-identifier")
      .attr("aria-hidden", "true")
      .addClass("hd-passive");
  });
  return $.html();
}
