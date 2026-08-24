import * as cheerio from "cheerio";
import { findLeakMarkerToken, stripCapturedLeaks } from "./capture-sanitize";
import type { DropOption } from "./dnd-capture";

/**
 * Verbatim-захват вопрос-панели ОДНОЙ listening-части (`.part`) — listening-аналог
 * reading `captureQuestions`. Слушательный шаблон (§4.2) — это форма/таблица/заметки/
 * карта с пятью механизмами ответа, у каждого свой селектор:
 *  - `input.gap[data-q]`              — completion → text-слот;
 *  - `.mcq[data-q] input[type=radio]` — single MCQ / map-mcq → radio-слоты;
 *  - `.mcq.multi[data-qs] checkbox`   — choose-TWO/THREE → checkbox-слоты (все на
 *    ПЕРВОМ номере группы, как reading `.mcq-block`) + group-anchor остальным членам;
 *  - `.dropzone[data-q]` в `.match-row` — matching → drop-слот (банк концовок из
 *    ближайшего `.dd-wrap .chip-bank`, референс остаётся read-only);
 *  - `.place-chip[data-q]`            — map labelling → синтез строки «N место [select]»
 *    (опции — буквы зон `.map-dz[data-letter]`); сама карта-картинка вырезается.
 *
 * Каждый контрол → нейтральный слот `<span class="q-slot" data-q data-qtype
 * [data-value|data-options]>` — ТОТ ЖЕ, что понимают coverage-гейт
 * (`questionsHtmlCoversAll`) и рендерер (`QuestionHtml`); ответ по-прежнему пишется в
 * `answers[number]`, ключ/грейдинг/mock не трогаются (choose-TWO мост в ExamRunner
 * генерик по номеру первого члена группы — новой логики не требует).
 *
 * Возвращает ВНУТРЕННИЙ HTML части (её прямые дети — top-level блоки: инструкции,
 * формы, таблицы, mcq — чтобы practice-аффордансы монтировались после КАЖДОГО блока,
 * а не одним комом под всей частью).
 *
 * FAIL-CLOSED ("" → раннер рисует атомизированный список): любой интерактивный
 * элемент без валидного/уникального номера, дефект choose-TWO блока, пустой банк,
 * непреобразованный остаток (leftover `.dropzone`/`.place-chip`/`.map-dz`/`input`/
 * `select`), либо reveal-маркер ответа под чужим классом (`onLeak` — см. B1). Частичная
 * или содержащая ключ панель в practice/mock просочиться не должна.
 */
export function captureListeningPart(
  html: string,
  onLeak?: (token: string) => void,
): string {
  if (!html.trim()) return "";
  const $ = cheerio.load(`<div class="q-panel">${html}</div>`, null, false);
  const root = $(".q-panel");
  // Баннер части дублирует passage.body_html — не тащим его в панель.
  root.find(".part-banner").remove();

  const MAX_Q = 500; // потолок номера (реальный IELTS ≤ 40; запас, как в capture-questions)
  const validQ = (n: number) => Number.isSafeInteger(n) && n > 0 && n <= MAX_Q;
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const slot = (n: number, type: string, value?: string) =>
    `<span class="q-slot" data-q="${n}" data-qtype="${type}"${value != null ? ` data-value="${esc(value)}"` : ""}></span>`;
  // data-options — cheerio сериализует JSON с ОДНИМ уровнем эскейпинга (не гонять esc()
  // поверх); класс СТРОГО "q-slot" — coverage-гейт матчит его точным regex'ом.
  const dropSlot = (n: number, options: DropOption[]) => {
    const span = $("<span></span>");
    span.attr("class", "q-slot");
    span.attr("data-q", String(n));
    span.attr("data-qtype", "drop");
    span.attr("data-options", JSON.stringify(options));
    return span;
  };
  const parseNum = (raw: string | undefined): number => {
    const t = (raw ?? "").trim();
    return /^\d+$/.test(t) ? Number.parseInt(t, 10) : NaN;
  };

  // Каждый номер принадлежит РОВНО одному вопросу-механизму; radio-опции одного
  // `.mcq[data-q]` делят номер блока легитимно (клеймим на уровне блока, не опции).
  const claimed = new Set<number>();
  let bad = false;
  const claim = (n: number): boolean => {
    if (!validQ(n) || claimed.has(n)) {
      bad = true;
      return false;
    }
    claimed.add(n);
    return true;
  };
  const dedupeByV = (opts: DropOption[]): DropOption[] => {
    const seen = new Set<string>();
    return opts.filter((o) => (seen.has(o.v) ? false : (seen.add(o.v), true)));
  };

  // --- 1) choose-TWO/THREE (.mcq.multi[data-qs]) — до одиночных чекбоксов/радио ---
  // Все чекбоксы блока делят group_key; сервер грейдит каждого члена (ExamRunner
  // toggle раздаёт набор на первый номер). Физические чекбоксы → checkbox-слоты на
  // ПЕРВОМ номере; остальные члены — group-anchor (их видят coverage-гейт и аффордансы).
  root.find(".mcq.multi[data-qs]").each((_, el) => {
    if (bad) return;
    const $block = $(el);
    const memberNums = [
      ...new Set(($block.attr("data-qs")?.match(/\d+/g) ?? []).map((n) => Number.parseInt(n, 10)).filter(validQ)),
    ];
    if (memberNums.length < 2) {
      bad = true;
      return;
    }
    for (const n of memberNums) {
      if (claimed.has(n)) {
        bad = true;
        return;
      }
    }
    const boxes = $block.find("input[type='checkbox']").toArray();
    if (boxes.length === 0) {
      bad = true;
      return;
    }
    const seenVal = new Set<string>();
    for (const box of boxes) {
      const v = ($(box).attr("value") ?? "").trim();
      if (!v || seenVal.has(v)) {
        bad = true;
        return;
      }
      seenVal.add(v);
    }
    const first = Math.min(...memberNums);
    for (const n of memberNums) claimed.add(n);
    for (const box of boxes) {
      $(box).replaceWith(slot(first, "checkbox", $(box).attr("value") ?? ""));
    }
    // anchor'ы — ВНУТРИ того же блока (он и есть top-level для slotNumbersIn).
    const anchors = memberNums
      .filter((n) => n !== first)
      .sort((a, b) => a - b)
      .map((n) => `<span class="q-slot" data-q="${n}" data-qtype="group-anchor"></span>`)
      .join("");
    if (anchors) $block.append(anchors);
  });
  if (bad) return "";

  // --- 2) matching: .dropzone[data-q] в .match-row → drop-слот ---
  // Банк концовок берём из ближайшего .dd-wrap (per-group), иначе — все чипы части
  // (parse-listening делает так же). Референсный .chip-bank оставляем read-only.
  root.find(".dropzone[data-q]").each((_, el) => {
    if (bad) return;
    const $dz = $(el);
    if (!claim(parseNum($dz.attr("data-q")))) return;
    const scope = $dz.closest(".dd-wrap");
    const chipSel = ".chip-bank .chip[data-letter], .chip[data-letter]";
    const chips = (scope.length ? scope.find(chipSel) : root.find(chipSel))
      .toArray()
      .map((c) => ({
        v: ($(c).attr("data-letter") ?? "").trim(),
        label: $(c).text().replace(/\s+/g, " ").trim(),
      }))
      .filter((o) => o.v);
    if (chips.length === 0) {
      bad = true;
      return;
    }
    $dz.replaceWith(dropSlot(parseNum($dz.attr("data-q")), dedupeByV(chips)));
  });
  if (bad) return "";

  // --- 3) map labelling: .place-chip[data-q] → строка «N место [select]» ---
  // Опции — буквы зон .map-dz (aria-label как подпись). Саму карту-картинку
  // (.map-stage: base64-img + оверлеи) вырезаем ниже — без исходного CSS позиции
  // зон бессмысленны, а base64 раздул бы сохранённый HTML.
  const mapOptions = dedupeByV(
    root
      .find(".map-dz[data-letter]")
      .toArray()
      .map((z) => {
        const v = ($(z).attr("data-letter") ?? "").trim();
        const label = ($(z).attr("aria-label") ?? v).replace(/\s+/g, " ").trim();
        return { v, label: label || v };
      })
      .filter((o) => o.v),
  );
  root.find(".place-chip[data-q]").each((_, el) => {
    if (bad) return;
    const $chip = $(el);
    if (!claim(parseNum($chip.attr("data-q")))) return;
    if (mapOptions.length === 0) {
      bad = true;
      return;
    }
    const line = $('<div class="lst-map-line"></div>');
    const numTxt = $chip.find(".pc-num").text().trim();
    const placeTxt = $chip.find(".pc-text").text().replace(/\s+/g, " ").trim();
    if (numTxt) line.append($('<span class="lst-map-num"></span>').text(numTxt));
    line.append($('<span class="lst-map-place"></span>').text(placeTxt));
    line.append(dropSlot(parseNum($chip.attr("data-q")), mapOptions));
    $chip.replaceWith(line);
  });
  if (bad) return "";

  // --- 4) completion gaps: input.gap[data-q] → text-слот ---
  root.find("input.gap[data-q]").each((_, el) => {
    if (bad) return;
    const n = parseNum($(el).attr("data-q"));
    if (!claim(n)) return;
    $(el).replaceWith(slot(n, "text"));
  });
  if (bad) return "";

  // --- 5) single MCQ / map-mcq: .mcq[data-q] radio-опции → radio-слоты ---
  // Номер — с блока .mcq[data-q] (общий для всех radio внутри). .mcq.multi исключён
  // (у него data-qs, не data-q; обработан выше) — guard hasClass на всякий случай.
  root.find(".mcq[data-q]").each((_, el) => {
    if (bad) return;
    const $block = $(el);
    if ($block.hasClass("multi")) return;
    const n = parseNum($block.attr("data-q"));
    if (!claim(n)) return;
    const radios = $block.find("input[type='radio']").toArray();
    if (radios.length === 0) {
      bad = true;
      return;
    }
    for (const r of radios) {
      $(r).replaceWith(slot(n, "radio", $(r).attr("value") ?? ""));
    }
  });
  if (bad) return "";

  // Карту-картинку и любой аудио/видео-плеер части убираем до гигиены.
  root.find(".map-stage, audio, video").remove();

  // Fail-closed на reveal-маркер ответа под чужим class/id (вне `[data-analysis]`, B1):
  // тихий стрип мог бы убить легитимный контент и скрыть утечку — уводим часть в
  // атомизацию и сигналим ревью-экрану через onLeak.
  const leak = findLeakMarkerToken($, root);
  if (leak) {
    onLeak?.(leak);
    return "";
  }

  // Общая leak-гигиена (идентична reading-захвату).
  stripCapturedLeaks($, root);

  // Референсные банки (.chip-bank) остаются как read-only список — снимаем draggable-
  // интерактивность оригинала.
  root.find("[draggable]").each((_, el) => {
    $(el).removeAttr("draggable").removeAttr("tabindex").removeAttr("role");
  });

  // Fail-closed на любой непреобразованный интерактив: частичная панель недопустима.
  if (root.find(".dropzone, .place-chip, .map-dz, input, select, textarea").length > 0) {
    return "";
  }
  if (root.find(".q-slot").length === 0) return "";

  // Возвращаем ВНУТРЕННОСТЬ .part (прямые дети = top-level блоки для аффордансов).
  const part = root.children().first();
  return ((part.length ? part.html() : root.html()) ?? "").trim();
}
