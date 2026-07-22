import type { CheerioAPI, Cheerio } from "cheerio";
import type { AnyNode, Element } from "domhandler";

/**
 * Общий контракт извлечения Inspera drag-and-drop данных (Matching Headings /
 * Sentence Endings) для verbatim-захвата вопрос-панели (`capture-questions.ts`).
 * Оба call site (`parse-test.ts` single-passage, `parse-reading-full.ts` full)
 * пользуются этим модулем, чтобы селекторы банков/целей и вывод буквы абзаца были
 * согласованы (тот же fallback-цепочки, что у атомизатора).
 *
 * Формат `DropOption` — то, что кладётся в `data-options` слота: канон-значение `v`
 * (буква/роман — ИМЕННО оно грейдится, паритет с `bridge.ts __collect`) и `label`
 * БЕЗ ведущего канон-префикса (в токенах он часто уже есть: «i …», «<b>A</b> …»);
 * рендерер (`QuestionHtml`) сам показывает «v — label».
 */
export interface DropOption {
  v: string;
  label: string;
}

/** Цель Matching Headings: номер вопроса + буква абзаца, к которому она привязана. */
export interface HeadingTarget {
  number: number;
  paragraph: string;
}

export interface CaptureDnd {
  headingTargets: HeadingTarget[];
  headingBank: DropOption[];
  endingBank: DropOption[];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Убирает ведущий канон-префикс из текста токена, ЕСЛИ он там уже есть
 * («<b>A</b> is due…» → «is due…», «i A craft…» → «A craft…»). Префикс должен быть
 * отдельным токеном — за ним разделитель или конец строки, иначе слово вроде «Is…»
 * при каноне «i» не режется (lookahead после канона требует не-букву).
 */
function stripCanonPrefix(canon: string, text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (!canon) return t;
  const re = new RegExp(
    `^${escapeRegExp(canon)}(?=[\\s.):,\\-–—]|$)[\\s.):,\\-–—]*`,
    "i",
  );
  return t.replace(re, "").trim();
}

function find($: CheerioAPI, sel: string, scope?: Cheerio<AnyNode>) {
  return scope ? scope.find(sel) : $(sel);
}

// Анти-утечка ключа (BRIEF §6.1): текст токена банка идёт в клиентский `data-options`
// как label. Источник может прятать правильный ответ ВНУТРИ токена в скрытом лишь
// CSS `.analysis`/`[data-analysis]` (тот же вектор, что чистит capture-questions на
// уровне узлов). Вырезаем такие узлы из КЛОНА до извлечения текста — зеркало списка
// гигиены capture-questions.ts.
const LEAK_NODES =
  ".analysis, [data-analysis], .review-flag, .cdi-placeholder, .qnum, .dz-num, " +
  "script, style, link, meta, iframe, object, embed, noscript";

/** Текст токена банка без leak-узлов и без служебного `.roman`. */
function tokenText($: CheerioAPI, el: Element): string {
  const clone = $(el).clone();
  clone.find(LEAK_NODES).remove();
  clone.find(".roman").remove();
  return clone.text();
}

/** Банк «List of Headings» (роман-значения). Скоуп — вся секция вопросов пассажа. */
export function extractHeadingBank(
  $: CheerioAPI,
  scope?: Cheerio<AnyNode>,
): DropOption[] {
  return find(
    $,
    ".heading-bank .heading-token[data-heading], .heading-bank .heading-option[data-heading]",
    scope,
  )
    .toArray()
    .map((t) => {
      const v = ($(t).attr("data-heading") ?? "").trim();
      return { v, label: stripCanonPrefix(v, tokenText($, t as Element)) };
    })
    .filter((o) => o.v);
}

/** Банк «List of Endings» (буквенные значения); покрывает ending-* и dd-* варианты. */
export function extractEndingBank(
  $: CheerioAPI,
  scope?: Cheerio<AnyNode>,
): DropOption[] {
  return find($, ".ending-token[data-ending], .dd-token[data-letter]", scope)
    .toArray()
    .map((t) => {
      const v = ($(t).attr("data-ending") ?? $(t).attr("data-letter") ?? "").trim();
      return { v, label: stripCanonPrefix(v, tokenText($, t as Element)) };
    })
    .filter((o) => o.v);
}

/**
 * Буква абзаца для heading-drop: id строки `heading-line-X` → «X», иначе
 * `data-section`, иначе `data-para` соседнего абзаца в `.paragraph-block`.
 * "" (не извлекается) → caller обязан fail-close.
 */
export function headingParagraphLetter($: CheerioAPI, el: Element): string {
  const lineId = $(el).closest(".heading-drop-line").attr("id") ?? "";
  const prefix = "heading-line-";
  if (lineId.startsWith(prefix)) {
    const l = lineId.slice(prefix.length).trim();
    if (l) return l;
  }
  const section = ($(el).attr("data-section") ?? "").trim();
  if (section) return section;
  return (
    $(el).closest(".paragraph-block").find("[data-para]").first().attr("data-para") ?? ""
  ).trim();
}

/**
 * Цели Matching Headings из тела пассажа. Берём ВСЕ `.heading-drop` (не только с
 * `[data-q]`): цель без валидного data-q обязана дойти до capture как `number=NaN`,
 * иначе она бесследно исчезла бы, а leftover-guard её не видит (drop живёт в теле
 * пассажа, а не в блоках вопросов) → capture fail-close на NaN.
 */
export function extractHeadingTargets(
  $: CheerioAPI,
  scope?: Cheerio<AnyNode>,
): HeadingTarget[] {
  return find($, ".heading-drop", scope)
    .toArray()
    .map((el) => {
      const raw = $(el).attr("data-q") ?? "";
      const number = /^\d+$/.test(raw) ? Number.parseInt(raw, 10) : NaN;
      return { number, paragraph: headingParagraphLetter($, el as Element) };
    });
}
