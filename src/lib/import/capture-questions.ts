import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";

/**
 * Захват ОРИГИНАЛЬНОГО HTML вопрос-панели для verbatim-рендера (как реальный
 * computer-IELTS): инструкции группы, под-заголовки заметок, списки, таблицы.
 * Каждый интерактивный `<input>` заменяется на нейтральный слот
 * `<span class="q-slot" data-q data-qtype data-value>`, по которому рендерер
 * подставляет УПРАВЛЯЕМЫЙ React-инпут (ответ всё так же пишется в answers[number]
 * → грейдинг не меняется).
 *
 * БЕЗОПАСНОСТЬ/ФОЛЛБЭК: возвращает "" (→ раннер рисует текущий атомизированный
 * список), если разметку нельзя отрисовать корректно:
 *  - хоть один text/radio/checkbox не маппится на номер вопроса;
 *  - присутствует drag-drop (.dropzone/.heading-drop/.ending-drop/.dd-drop) —
 *    его проводка отдельной фазой.
 * Так verbatim-путь включается только для «чистых» тестов (completion / TFNG /
 * MCQ-single / matching-радио с именованными инпутами), а всё остальное — фоллбэк.
 */
export function captureQuestions(
  blocks: string[],
): string {
  if (blocks.length === 0) return "";
  const $ = cheerio.load(`<div class="q-panel">${blocks.join("\n")}</div>`, null, false);
  const root = $(".q-panel");

  // Drag-drop пока не проводим — фоллбэк.
  if (root.find(".dropzone, .heading-drop, .ending-drop, .dd-drop, [data-dropzone]").length > 0) {
    return "";
  }

  let unmapped = false;
  const num = (el: AnyNode): number | null => {
    const $el = $(el);
    const name = $el.attr("name");
    if (name && /^q\d+$/i.test(name)) return Number.parseInt(name.slice(1), 10);
    const dq = $el.attr("data-q");
    if (dq && /^\d+$/.test(dq)) return Number.parseInt(dq, 10);
    const id = $el.closest("[id^='question-']").attr("id");
    const m = id ? /(\d+)/.exec(id) : null;
    return m ? Number.parseInt(m[1]!, 10) : null;
  };
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const slot = (n: number, type: string, value?: string) =>
    `<span class="q-slot" data-q="${n}" data-qtype="${type}"${value != null ? ` data-value="${esc(value)}"` : ""}></span>`;

  // text gaps: заменяем целиком .blank-wrapper (чтобы убрать cdi-placeholder/флаг внутри), иначе сам input
  root.find("input[type='text'], textarea, input:not([type])").each((_, el) => {
    const n = num(el);
    if (n == null) { unmapped = true; return; }
    const wrap = $(el).closest(".blank-wrapper");
    (wrap.length ? wrap : $(el)).replaceWith(slot(n, "text"));
  });
  root.find("input[type='radio']").each((_, el) => {
    const n = num(el);
    if (n == null) { unmapped = true; return; }
    $(el).replaceWith(slot(n, "radio", $(el).attr("value") ?? ""));
  });
  root.find("input[type='checkbox']").each((_, el) => {
    const n = num(el);
    if (n == null) { unmapped = true; return; }
    $(el).replaceWith(slot(n, "checkbox", $(el).attr("value") ?? ""));
  });
  if (unmapped) return "";

  // чистим шум: маркеры номеров, флаги, активный контент, on*-атрибуты
  // .analysis/[data-analysis] (Inspera Style источник, 2026-07-21): несёт ПРАВИЛЬНЫЙ
  // ОТВЕТ в тексте (<strong>TRUE</strong> и т.п.), скрыт только исходным CSS
  // (.analysis{display:none}), который verbatim-захват не переносит → текст
  // отрисовался бы видимым на клиенте. Вырезаем элементы целиком.
  root
    .find(".review-flag, .cdi-placeholder, .qnum, .dz-num, .analysis, [data-analysis], script, style, link, meta, iframe, object, embed, noscript, form, button")
    .remove();
  root.find("*").each((_, el) => {
    if (!("attribs" in el)) return;
    for (const name of Object.keys(el.attribs)) {
      // Анти-утечка ключа (BRIEF §6.1): захваченный HTML рендерится на клиенте
      // (QuestionHtml реэмитит атрибуты). Источник несёт правильный ответ в
      // data-correct/data-answer — вырезаем любой атрибут с correct/answer/solution
      // в имени. Слоты (data-q/data-qtype/data-value) создаём мы сами, они чисты.
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

  // должен остаться хотя бы один слот, иначе смысла нет
  if (root.find(".q-slot").length === 0) return "";
  return (root.html() ?? "").trim();
}
