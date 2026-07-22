import type { CheerioAPI, Cheerio } from "cheerio";
import type { AnyNode } from "domhandler";

/**
 * Узлы, целиком вырезаемые из захваченной вопрос-панели ДО отправки на клиент.
 * Verbatim-рендер (`QuestionHtml`) реэмитит все атрибуты, а источник может прятать
 * правильный ответ или активный контент в узле, скрытом лишь исходным CSS (который
 * захват не переносит):
 *  - `.qnum`/`.dz-num` — видимые маркеры номера вопроса (шум, слот сам несёт номер);
 *  - `.review-flag`/`.cdi-placeholder` — служебные overlay-элементы;
 *  - `.analysis`/`[data-analysis]` — answer-reveal (Inspera reading) И дашборд
 *    результатов listening: оба несут ПРАВИЛЬНЫЙ ОТВЕТ в тексте, скрытый только
 *    `.analysis{display:none}` — в practice-панели не нужны и опасны;
 *  - любой активный/интерактивный тег (script/style/link/…/form/button).
 */
const LEAK_NODES =
  ".review-flag, .cdi-placeholder, .qnum, .dz-num, .analysis, [data-analysis], " +
  "script, style, link, meta, iframe, object, embed, noscript, form, button";

/**
 * Единая leak-гигиена вопрос-панели: reading (`capture-questions`) и listening
 * (`capture-listening`) делят её, чтобы строгость анти-утечки ключа (BRIEF §6.1)
 * была ИДЕНТИЧНОЙ на обоих путях. Вырезает leak-узлы (`LEAK_NODES`) и вычищает
 * опасные атрибуты каждого оставшегося узла:
 *  - `on*`-обработчики и `style` — снимаем всегда;
 *  - любой атрибут с `correct`/`answer`/`solution` в имени (источник несёт ключ в
 *    `data-correct`/`data-answer` — слоты `data-q/data-qtype/data-value` создаём мы
 *    сами, они чисты);
 *  - `javascript:`/`data:`/`vbscript:` в `href`/`src`/`xlink:href`/`formaction`/
 *    `action` (заодно нейтрализует base64-`data:`-картинки — они не должны раздувать
 *    сохранённый HTML).
 */
export function stripCapturedLeaks($: CheerioAPI, root: Cheerio<AnyNode>): void {
  root.find(LEAK_NODES).remove();
  root.find("*").each((_, el) => {
    if (!("attribs" in el)) return;
    for (const name of Object.keys(el.attribs)) {
      if (/^on/i.test(name) || name === "style" || /(correct|answer|solution)/i.test(name)) {
        $(el).removeAttr(name);
      } else if (
        /^(href|src|xlink:href|formaction|action)$/i.test(name) &&
        /^\s*(javascript|data|vbscript):/i.test(el.attribs[name] ?? "")
      ) {
        $(el).removeAttr(name);
      }
    }
  });
}
