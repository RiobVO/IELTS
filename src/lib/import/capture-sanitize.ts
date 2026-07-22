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
 * Reveal-маркеры ответа по CLASS-ТОКЕНАМ — источник может прятать ключ не только в
 * санкционированном `[data-analysis]` (Inspera-канон), но и под чужим классом
 * (`<div class="correct-answer">Correct answer: …</div>`). Сравнение СТРОГО по токенам
 * класс-листа (split по whitespace, точное равенство), НЕ подстрокой: иначе легитимные
 * `cstat answered`/`map-answers`/`answer-input` реального корпуса дали бы ложные срабатывания.
 */
const LEAK_CLASS_TOKENS = new Set([
  "analysis",
  "correct",
  "correct-answer",
  "answer-key",
  "solution",
  "reveal",
]);

/**
 * Fail-closed детектор утечки ключа в захваченной панели: возвращает первый найденный
 * подозрительный class-токен (или null). Санкционированный `[data-analysis]`-блок и его
 * потомков пропускаем — их штатно вырезает `stripCapturedLeaks` (и read-time route.ts);
 * любой ДРУГОЙ элемент с reveal-токеном = чужой/обфусцированный маркер → вызывающий
 * возвращает пустую панель + warning, вся часть уходит в атомизированный фоллбэк.
 * Тихое удаление (как у `stripCapturedLeaks`) здесь опасно: могло бы вырезать легитимный
 * контент и скрыть проблему, а fail-closed безопасен по построению (атомизация не
 * использует raw HTML). См. блокер B1.
 */
export function findLeakClassToken($: CheerioAPI, root: Cheerio<AnyNode>): string | null {
  let token: string | null = null;
  root.find("*").each((_, el) => {
    if (token || !("attribs" in el)) return;
    // Известная легитимная структура — санкционированный Inspera reveal (сам блок + дети).
    if ($(el).closest("[data-analysis]").length > 0) return;
    const cls = el.attribs["class"];
    if (!cls) return;
    for (const t of cls.split(/\s+/)) {
      if (t && LEAK_CLASS_TOKENS.has(t)) {
        token = t;
        return;
      }
    }
  });
  return token;
}

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
