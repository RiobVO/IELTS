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

  const MAX_Q = 500; // потолок номера вопроса (реальный IELTS ≤ 40; запас на будущее)
  // Number.isSafeInteger отсекает и NaN, и переполнение (400-значный номер → Infinity,
  // мимо простого `n <= 0`).
  const validQ = (n: number) => Number.isSafeInteger(n) && n > 0 && n <= MAX_Q;

  // --- choose-TWO/THREE (Inspera .mcq-block[data-mcq-group]) ---
  // Все чекбоксы блока делят один group_key; сервер грейдит КАЖДОГО члена группы полным
  // набором букв (mcq_set), поэтому физические чекбоксы → checkbox-слоты, ключенные на
  // ПЕРВЫЙ номер группы (ExamRunner toggle пишет итоговый набор во все члены). Номера
  // членов берём из чипов .mcq-q-num-box, НЕ из парса "N-M": группа "8-12" с чипами
  // 8..12 иначе потеряла бы 9-11. Для ОСТАЛЬНЫХ членов — синтетический group-anchor
  // (его видят slotNumbersIn → аффордансы и coverage-гейт questionsHtmlCoversAll).
  // groupNums — ОТДЕЛЬНЫЙ от одиночных вопросов set: radio/checkbox-опции обычного
  // вопроса легитимно делят один номер, общий seen-set сломал бы их. Fail-closed:
  // любой дефект блока → "" на весь пассаж (частичный захват не должен пройти coverage).
  const groupNums = new Set<number>();
  let groupBad = false;
  root.find(".mcq-block[data-mcq-group]").each((_, el) => {
    if (groupBad) return;
    const $block = $(el);
    // вложенная группа внутри группы — структура неоднозначна
    if ($block.find("[data-mcq-group]").length > 0) { groupBad = true; return; }
    // Опции — только чекбоксы внутри .mcq-row (зеркало атомайзера parse-test.ts:189-201:
    // optionsIn читает .mcq-row). Чекбокс в блоке ВНЕ .mcq-row расходится с атомайзером
    // → fail-closed (иначе verbatim показал бы опцию, которой нет в атомизированном ключе).
    const boxes = $block.find(".mcq-row input[type='checkbox']").toArray();
    if (boxes.length === 0) { groupBad = true; return; }
    if ($block.find("input[type='checkbox']").length !== boxes.length) { groupBad = true; return; }
    // номера-члены — из чипов; ≥2 уникальных валидных
    const memberNums = [
      ...new Set(
        $block
          .find(".mcq-q-num-box")
          .toArray()
          .map((c) => Number.parseInt($(c).text().trim(), 10))
          .filter(validQ),
      ),
    ];
    if (memberNums.length < 2) { groupBad = true; return; }
    // каждый чекбокс — опция группы (без своего data-q / name=qN) с непустым уникальным value
    const seenVal = new Set<string>();
    for (const box of boxes) {
      const $box = $(box);
      const ownQ = $box.attr("data-q");
      const nm = $box.attr("name") ?? "";
      if ((ownQ && /^\d+$/.test(ownQ)) || /^q\d+$/i.test(nm)) { groupBad = true; return; }
      const v = ($box.attr("value") ?? "").trim();
      if (!v || seenVal.has(v)) { groupBad = true; return; }
      seenVal.add(v);
    }
    // пересечение номеров этой группы с уже увиденными группами
    for (const n of memberNums) {
      if (groupNums.has(n)) { groupBad = true; return; }
    }
    const first = Math.min(...memberNums);
    for (const n of memberNums) groupNums.add(n);
    for (const box of boxes) {
      $(box).replaceWith(slot(first, "checkbox", $(box).attr("value") ?? ""));
    }
    // якоря остальных членов — ВНУТРИ того же top-level .question (sibling .mcq-block),
    // иначе slotNumbersIn/coverage их не увидят.
    const anchors = memberNums
      .filter((n) => n !== first)
      .sort((a, b) => a - b)
      .map((n) => `<span class="q-slot" data-q="${n}" data-qtype="group-anchor"></span>`)
      .join("");
    if (anchors) $block.after(anchors);
  });
  if (groupBad) return "";

  // text gaps: заменяем целиком .blank-wrapper (чтобы убрать cdi-placeholder/флаг внутри), иначе сам input.
  // groupNums.has(n) → номер уже занят choose-TWO группой: пересечение = битый источник, fail-closed.
  root.find("input[type='text'], textarea, input:not([type])").each((_, el) => {
    const n = num(el);
    if (n == null || groupNums.has(n)) { unmapped = true; return; }
    const wrap = $(el).closest(".blank-wrapper");
    (wrap.length ? wrap : $(el)).replaceWith(slot(n, "text"));
  });
  root.find("input[type='radio']").each((_, el) => {
    const n = num(el);
    if (n == null || groupNums.has(n)) { unmapped = true; return; }
    $(el).replaceWith(slot(n, "radio", $(el).attr("value") ?? ""));
  });
  root.find("input[type='checkbox']").each((_, el) => {
    const n = num(el);
    if (n == null || groupNums.has(n)) { unmapped = true; return; }
    $(el).replaceWith(slot(n, "checkbox", $(el).attr("value") ?? ""));
  });
  if (unmapped) return "";

  // --- drag-and-drop: Sentence Endings (в блоке) + Matching Headings (синтез) ---
  // Fail-closed чеклист (любой провал → "" на весь пассаж): каждая цель имеет строго
  // положительный safe-integer data-q в разумном диапазоне (validQ, объявлен выше);
  // заменена ровно одним слотом; банк непуст и каждый токен несёт непустое канон-
  // значение; номера не дублируются между собой.
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
