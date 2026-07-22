import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import type { CaptureDnd, DropOption } from "./dnd-capture";

/**
 * Захват ОРИГИНАЛЬНОГО HTML вопрос-панели для verbatim-рендера (как реальный
 * computer-IELTS): инструкции группы, под-заголовки заметок, списки, таблицы.
 * Каждый интерактивный `<input>` заменяется на нейтральный слот
 * `<span class="q-slot" data-q data-qtype data-value>`, по которому рендерер
 * подставляет УПРАВЛЯЕМЫЙ React-инпут (ответ всё так же пишется в answers[number]
 * → грейдинг не меняется).
 *
 * DRAG-AND-DROP (Inspera Matching Headings / Sentence Endings, `dnd`-аргумент):
 *  - Sentence Endings: каждый `.ending-drop[data-q]` В БЛОКЕ → drop-слот
 *    (`data-qtype="drop"` + `data-options` = банк концовок); банк остаётся в
 *    захвате инертным референсом.
 *  - Matching Headings: цели живут в ТЕЛЕ ПАССАЖА (не в блоках) — вызывающий
 *    парсер отдаёт список {number, paragraph}; синтезируем строки «Question N —
 *    Paragraph X: [slot]» в конец захвата, банк рубрики остаётся референсом.
 * Drop-слот несёт то же канон-значение (буква/роман), что мост `bridge.ts` →
 * грейдинг не меняется.
 *
 * БЕЗОПАСНОСТЬ/ФОЛЛБЭК: возвращает "" (→ раннер рисует текущий атомизированный
 * список), если разметку нельзя отрисовать корректно:
 *  - хоть один text/radio/checkbox не маппится на номер вопроса;
 *  - присутствует непроводимый drag-drop (.dropzone/.dd-drop/[data-dropzone]);
 *  - DnD-ветка не проходит fail-closed чеклист (см. ниже) — частичный захват в
 *    presence-only mock-путь (page.tsx) просачиваться НЕ должен.
 */
export function captureQuestions(
  blocks: string[],
  dnd?: CaptureDnd,
): string {
  if (blocks.length === 0) return "";
  const $ = cheerio.load(`<div class="q-panel">${blocks.join("\n")}</div>`, null, false);
  const root = $(".q-panel");

  // Непроводимый drag-drop → фоллбэк (heading-drop/ending-drop проводятся ниже).
  if (root.find(".dropzone, .dd-drop, [data-dropzone]").length > 0) {
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

  // --- drag-and-drop: Sentence Endings (в блоке) + Matching Headings (синтез) ---
  // Fail-closed чеклист (любой провал → "" на весь пассаж): каждая цель имеет строго
  // положительный safe-integer data-q в разумном диапазоне; заменена ровно одним
  // слотом; банк непуст и каждый токен несёт непустое канон-значение; номера не
  // дублируются между собой.
  const MAX_Q = 500; // потолок номера вопроса (реальный IELTS ≤ 40; запас на будущее)
  // Number.isSafeInteger отсекает и NaN, и переполнение (400-значный data-q → Infinity,
  // мимо простого `n <= 0`).
  const validQ = (n: number) => Number.isSafeInteger(n) && n > 0 && n <= MAX_Q;
  const seenDnd = new Set<number>();
  const dropSlot = (n: number, options: DropOption[]) => {
    const span = $("<span></span>");
    // Класс СТРОГО "q-slot" — coverage-гейт (question-html-coverage.ts) матчит его
    // точным regex'ом. data-options — cheerio сериализует JSON с ОДНИМ уровнем
    // эскейпинга (НЕ прогонять через esc() поверх).
    span.attr("class", "q-slot");
    span.attr("data-q", String(n));
    span.attr("data-qtype", "drop");
    span.attr("data-options", JSON.stringify(options));
    return span;
  };
  const bankInvalid = (bank: DropOption[]) =>
    bank.length === 0 || bank.some((o) => !o.v);

  const endingDrops = root.find(".ending-drop[data-q]");
  if (endingDrops.length > 0) {
    const bank = dnd?.endingBank ?? [];
    if (bankInvalid(bank)) return "";
    let bad = false;
    endingDrops.each((_, el) => {
      const raw = $(el).attr("data-q") ?? "";
      const n = /^\d+$/.test(raw) ? Number.parseInt(raw, 10) : NaN;
      if (!validQ(n) || seenDnd.has(n)) { bad = true; return; }
      seenDnd.add(n);
      $(el).replaceWith(dropSlot(n, bank));
    });
    if (bad) return "";
  }

  const targets = dnd?.headingTargets ?? [];
  const headingBank = dnd?.headingBank ?? [];
  // Банк заголовков есть, а целей ноль → в пассаже потеряли drop-зоны (капчер
  // частичный). Fail-closed, иначе presence-only mock показал бы битую панель.
  if (headingBank.length > 0 && targets.length === 0) return "";
  if (targets.length > 0) {
    if (bankInvalid(headingBank)) return "";
    const lines = $('<div class="heading-match-lines"></div>');
    for (const t of targets) {
      if (!validQ(t.number) || seenDnd.has(t.number) || !t.paragraph) {
        return "";
      }
      seenDnd.add(t.number);
      const row = $('<div class="heading-match-line"></div>');
      row.append($('<span class="hm-num"></span>').text(String(t.number)));
      row.append($('<span class="hm-para"></span>').text(`Paragraph ${t.paragraph}`));
      row.append(dropSlot(t.number, headingBank));
      lines.append(row);
    }
    root.append(lines);
  }

  // Банк-референс (список концовок/заголовков) остаётся в захвате как read-only —
  // снимаем интерактивность оригинала (draggable/tabindex/role).
  root.find(".heading-token, .ending-token, .heading-slot, .ending-slot, [draggable]").each((_, el) => {
    $(el).removeAttr("draggable").removeAttr("tabindex").removeAttr("role");
  });

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

  // fail-closed: любая непроведённая drop-зона (heading-drop из блока без цели,
  // цель с плохим data-q, пропущенная ветка) не должна утечь в presence-only mock.
  if (root.find(".heading-drop, .ending-drop, .dropzone, .dd-drop, [data-dropzone]").length > 0) {
    return "";
  }

  // должен остаться хотя бы один слот, иначе смысла нет
  if (root.find(".q-slot").length === 0) return "";
  return (root.html() ?? "").trim();
}
