import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import { captureQuestions } from "./capture-questions";
import {
  extractEndingBank,
  extractHeadingBank,
  extractHeadingTargets,
} from "./dnd-capture";
import { extractData, extractFunctionTable, isExecutableScriptType } from "./extract-js";
import {
  canonQuestionType,
  blankTypeWarning,
  unknownTypeWarning,
  UNKNOWN_TYPE_FALLBACK,
} from "./question-types";
import type {
  ParsedAnswerKey,
  ParsedOption,
  ParsedPassage,
  ParsedQuestion,
  ParsedTest,
} from "./types";

/**
 * Deterministic parser for the Full Reading template (BRIEF §4.2) — 3 passages,
 * 40 questions. Differs from the single-passage template: passages are
 * `.passage-section[data-part]` (not one #passageContent), the key uses
 * `acceptableVariants` (not acceptableAnswers), band is the function `getBand`,
 * and matching/classification render as `table.matching-table` radio rows.
 * Question number -> passage via the surrounding `[data-part]` section.
 */
export async function parseFullReading(html: string): Promise<ParsedTest> {
  const $ = cheerio.load(html);
  const warnings: string[] = [];

  const script = $("script")
    .toArray()
    .map((s) => $(s).html() ?? "")
    .join("\n");
  // Исполняемые JS-блоки БЕЗ склейки для extractFunctionTable (каждый блок независим,
  // как отдельный <script>); склеенный `script` остаётся входом extractData (поиск литералов).
  const scriptBlocks = $("script")
    .toArray()
    .filter((s) => isExecutableScriptType($(s).attr("type")))
    .map((s) => $(s).html() ?? "");
  const correctAnswers: Record<string, string> =
    (await extractData(script, "correctAnswers")) ?? {};
  const acceptableVariants: Record<string, string[]> =
    (await extractData(script, "acceptableVariants")) ?? {};
  const acceptableAnswers: Record<string, string[]> =
    (await extractData(script, "acceptableAnswers")) ?? {};
  const acceptable: Record<string, string[]> =
    Object.keys(acceptableVariants).length > 0
      ? acceptableVariants
      : acceptableAnswers;
  const questionTypesRaw: Record<string, string> =
    (await extractData(script, "questionTypes")) ?? {};
  // Inspera Style: getBandFor40 делегирует к getBandFor13 (`return getBandFor13(s)`). Весь
  // скрипт исполняется в изоляции — обе декларации в одном eval-скоупе, делегатор вызывается
  // без ReferenceError (deps не нужны). Самостоятельная legacy 13-шкала без getBandFor40 не
  // извлекается как 0..40 (getBandFor40 не объявлена → null), упоминание в комментарии/regex
  // ничего не materializes (регресс 2026-07-21).
  const bandScale =
    (await extractFunctionTable(scriptBlocks, "getBand", 0, 40)) ??
    (await extractFunctionTable(scriptBlocks, "getBandFor40", 0, 40));
  if (!bandScale) warnings.push("getBand function not found — no band scale.");

  const title =
    $("#passageContent h1").first().text().trim() ||
    $("title")
      .text()
      .replace(/\s*[-–|].*$/, "")
      .trim() ||
    "IELTS Reading (Full)";

  // --- passages: one per .passage-section[data-part] or .passage-part[data-part] ---
  const passages: ParsedPassage[] = [];
  const passageSelector =
    $(".passage-section[data-part]").length > 0
      ? ".passage-section[data-part]"
      : ".passage-part[data-part]";
  $(passageSelector).each((_, el) => {
    const $el = $(el);
    const order = Number.parseInt($el.attr("data-part") ?? "", 10);
    if (!Number.isFinite(order)) return;
    sanitize($, $el);
    // Inspera Style обёртывает пассаж в .passageContent (#passageContent-p*) вместо
    // .passage-content; без этого фолбэка bodyHtml забирал бы всю секцию с обёрткой.
    const content = $el.find(".passage-content, .passageContent");
    const bodyHtml = ((content.length ? content.html() : $el.html()) ?? "").trim();
    const pTitle = $el.find(".sectionRubric h2").first().text().trim() || `Passage ${order}`;
    // DnD: heading-цели — в теле этого пассажа ($el); банки концовок/заголовков — в
    // секции вопросов той же части.
    const qSection = $(
      `.questions-section[data-part='${order}'], .questions-part[data-part='${order}']`,
    );
    const questionsHtml =
      captureQuestions(
        qSection.find(".question").toArray().map((b) => $.html(b)),
        {
          headingTargets: extractHeadingTargets($, $el),
          headingBank: extractHeadingBank($, qSection),
          endingBank: extractEndingBank($, qSection),
        },
      ) || null;
    passages.push({ order, title: pTitle, bodyHtml, audioPath: null, questionsHtml });
  });

  const byNumber = new Map<number, ParsedQuestion>();
  const partOf = (node: Parameters<typeof $>[0]): number => {
    const dp = $(node)
      .closest(
        ".questions-section[data-part], .questions-part[data-part], .passage-section[data-part], .passage-part[data-part]",
      )
      .attr("data-part");
    const n = Number.parseInt(dp ?? "1", 10);
    return Number.isFinite(n) ? n : 1;
  };

  // TFNG / YNNG (radio statements)
  $(".tfng-question[id^='question-']").each((_, el) => {
    const $el = $(el);
    const num = Number.parseInt(($el.attr("id") ?? "").replace(/\D+/g, ""), 10);
    if (!Number.isFinite(num)) return;
    const prompt = $el.find(".tfng-statement-text").text().trim();
    const options = $el
      .find('input[type="radio"]')
      .toArray()
      .map((r) => ({ value: $(r).attr("value") ?? "", label: $(r).attr("value") ?? "" }));
    byNumber.set(num, blank(num, partOf(el), prompt, options));
  });

  // completion (text inputs: flow-chart / notes / summary / sentence)
  $('input[type="text"][name^="q"]').each((_, el) => {
    const num = Number.parseInt(($(el).attr("name") ?? "").slice(1), 10);
    if (!Number.isFinite(num) || byNumber.has(num)) return;
    const ctx = $(el).closest(".flow-row, .flow-box, .notes-item, li, p");
    const clone = (ctx.length ? ctx : $(el).parent()).clone();
    clone.find(".review-flag").remove();
    clone.find("input").replaceWith(" ____ ");
    const prompt = clone.text().replace(/\s+/g, " ").trim();
    byNumber.set(num, blank(num, partOf(el), prompt, null));
  });

  // completion blanks rendered as drag-and-drop spans.
  $(".dd-blank[data-q]").each((_, el) => {
    const num = Number.parseInt($(el).attr("data-q") ?? "", 10);
    if (!Number.isFinite(num) || byNumber.has(num)) return;
    const ctx = $(el).closest(".flow-row, .flow-box, .notes-item, li, p");
    const clone = (ctx.length ? ctx : $(el).parent()).clone();
    clone.find(".blank-wrapper").replaceWith(" ____ ");
    clone.find(".dd-blank, .review-flag, .placeholder").remove();
    const prompt = clone.text().replace(/\s+/g, " ").trim();
    byNumber.set(num, blank(num, partOf(el), prompt, null));
  });

  // matching / classification (radio rows in a matching-table)
  $("table.matching-table tr[id^='question-']").each((_, el) => {
    const $el = $(el);
    const num = Number.parseInt(($el.attr("id") ?? "").replace(/\D+/g, ""), 10);
    if (!Number.isFinite(num) || byNumber.has(num)) return;
    const prompt = $el.find(".q-text, .stmt-text").first().text().trim();
    const options = $el
      .find('input[type="radio"]')
      .toArray()
      .map((r) => ({ value: $(r).attr("value") ?? "", label: $(r).attr("value") ?? "" }));
    byNumber.set(num, blank(num, partOf(el), prompt, options));
  });

  // matching headings: heading-drop boxes can live inside passage paragraphs,
  // while the shared heading bank lives in the question section.
  const headingBank: ParsedOption[] = $(
    ".heading-bank .heading-token[data-heading], .heading-bank .heading-option[data-heading]",
  )
    .toArray()
    .map((t) => {
      const value = $(t).attr("data-heading") ?? "";
      const clone = $(t).clone();
      clone.find(".roman").remove();
      const label = clone.text().replace(/\s+/g, " ").trim();
      return { value, label: label ? `${value} ${label}` : value };
    });
  if (headingBank.length > 0) {
    $(".heading-drop[data-q]").each((_, el) => {
      const num = Number.parseInt($(el).attr("data-q") ?? "", 10);
      if (!Number.isFinite(num) || byNumber.has(num)) return;
      const section = $(el).attr("data-section") ?? "";
      // Inspera Style: нет .drop-value/data-section — paragraph выводится из id
      // родителя heading-line-A -> "Paragraph A" (как single-парсер parse-test.ts).
      const para = ($(el).closest(".heading-drop-line").attr("id") ?? "").replace(
        "heading-line-",
        "",
      );
      const prompt =
        $(el).find(".drop-value").text().replace(/\s+/g, " ").trim() ||
        (para ? `Paragraph ${para}` : "") ||
        (section ? `Section ${section}` : "");
      byNumber.set(num, blank(num, partOf(el), prompt, headingBank));
    });
  }

  // matching sentence endings: drop zones finish sentence stems; the option
  // bank can use either the ending-* or dd-* naming variant.
  const endingBank: ParsedOption[] = $(
    ".ending-token[data-ending], .dd-token[data-letter]",
  )
    .toArray()
    .map((t) => ({
      value: $(t).attr("data-ending") ?? $(t).attr("data-letter") ?? "",
      label: $(t).text().replace(/\s+/g, " ").trim(),
    }));
  if (endingBank.length > 0) {
    $(".ending-drop[data-q], .dd-drop[data-q]").each((_, el) => {
      const num = Number.parseInt($(el).attr("data-q") ?? "", 10);
      if (!Number.isFinite(num) || byNumber.has(num)) return;
      const line = $(el).closest(".ending-line, .dd-sentence, p, li");
      const clone = (line.length ? line : $(el).parent()).clone();
      // .q-num-box (Inspera Style) — ведущий номер вопроса; без выреза prompt тащит "33 ".
      clone.find(".ending-drop, .dd-drop, .review-flag, .placeholder, .q-num-box").remove();
      const prompt = clone.text().replace(/\s+/g, " ").trim();
      byNumber.set(num, blank(num, partOf(el), prompt, endingBank));
    });
  }

  // MCQ single: .mcq-block with a nested .mcq-single radio list.
  $(".mcq-block").each((_, el) => {
    const $el = $(el);
    if ($el.find(".mcq-single").length === 0) return;
    const num = Number.parseInt(($el.attr("id") ?? "").replace(/\D+/g, ""), 10);
    if (!Number.isFinite(num) || byNumber.has(num)) return;
    const prompt = $el
      .find(".mcq-stem, .tfng-statement-text, .stem")
      .first()
      .text()
      .replace(/\s+/g, " ")
      .trim();
    const options: ParsedOption[] = $el
      .find('.mcq-single input[type="radio"]')
      .toArray()
      .map((r) => {
        const value = $(r).attr("value") ?? "";
        const label = $(r).closest("label").text().replace(/\s+/g, " ").trim();
        return { value, label: label || value };
      });
    byNumber.set(num, blank(num, partOf(el), prompt, options));
  });

  // MCQ single (Inspera Style): standalone .mcq-single[id="question-N"] carrying its
  // own .mcq-stem + .mcq-row radios (no enclosing .mcq-block). Prompt is the per-question
  // stem, not the group rubric (which would repeat "Choose the correct letter" for all).
  $(".mcq-single[id^='question-']").each((_, el) => {
    const $el = $(el);
    const num = Number.parseInt(($el.attr("id") ?? "").replace(/\D+/g, ""), 10);
    if (!Number.isFinite(num) || byNumber.has(num)) return;
    const prompt = $el
      .find(".mcq-stem, .tfng-statement-text, .stem")
      .first()
      .text()
      .replace(/\s+/g, " ")
      .trim();
    const options: ParsedOption[] = $el
      .find(".mcq-row")
      .toArray()
      .map((row) => {
        const value = $(row).find("input").attr("value") ?? "";
        const label = $(row).find("span").last().text().replace(/\s+/g, " ").trim();
        return { value, label: label || value };
      });
    byNumber.set(num, blank(num, partOf(el), prompt, options));
  });

  // MCQ single: .mc-question without data-mcq-group (radio options).
  $(".mc-question").each((_, el) => {
    const $el = $(el);
    if ($el.attr("data-mcq-group") || $el.find('input[type="radio"]').length === 0) return;
    const rawNum =
      ($el.attr("id") ?? "").replace(/\D+/g, "") ||
      ($el.find('input[type="radio"]').first().attr("name") ?? "").replace(/\D+/g, "");
    const num = Number.parseInt(rawNum, 10);
    if (!Number.isFinite(num) || byNumber.has(num)) return;
    const rawType = questionTypesRaw[String(num)] ?? "";
    const commonPrompt = $el
      .closest(".question")
      .find(".question-rubric p")
      .last()
      .text()
      .replace(/\s+/g, " ")
      .trim();
    const prompt =
      (isMultiChoiceSetLabel(rawType) ? commonPrompt : "") ||
      $el
        .find(".tfng-statement-text, .mcq-stem, .stem")
        .first()
        .text()
        .replace(/\s+/g, " ")
        .trim();
    const options: ParsedOption[] = $el
      .find('input[type="radio"]')
      .toArray()
      .map((r) => {
        const value = $(r).attr("value") ?? "";
        const label = $(r).closest("label").text().replace(/\s+/g, " ").trim();
        return { value, label: label || value };
      });
    byNumber.set(num, blank(num, partOf(el), prompt, options));
  });

  // MCQ multi: checkbox groups without data-mcq-group, keyed by question ids.
  $(".mcq-block").each((_, el) => {
    const $el = $(el);
    if ($el.find(".mcq-multi").length === 0) return;
    const ids = [
      $el.attr("id") ?? "",
      ...$el
        .find("[id^='question-']")
        .toArray()
        .map((n) => $(n).attr("id") ?? ""),
    ];
    const nums = [
      ...new Set(
        ids
          .map((id) => Number.parseInt(id.replace(/\D+/g, ""), 10))
          .filter((n) => Number.isFinite(n)),
      ),
    ].sort((a, b) => a - b);
    if (nums.length === 0) return;
    const groupKey = `${nums[0]}-${nums[nums.length - 1]}`;
    const correct = [
      ...new Set(
        nums.flatMap((n) =>
          String(correctAnswers[String(n)] ?? "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        ),
      ),
    ];
    const prompt = $el
      .closest(".question")
      .find(".question-rubric p")
      .last()
      .text()
      .replace(/\s+/g, " ")
      .trim();
    const options: ParsedOption[] = $el
      .find('input[type="checkbox"]')
      .toArray()
      .map((c) => {
        const value = $(c).attr("value") ?? "";
        const label = $(c).closest("label").text().replace(/\s+/g, " ").trim();
        return { value, label: label || value };
      });
    for (const num of nums) {
      if (byNumber.has(num)) continue;
      const q = blank(num, partOf(el), prompt, options);
      q.groupKey = groupKey;
      q.qtype = "mcq_multi";
      q.answer = { mode: "mcq_set", accept: correct, explanation: null, evidence: null };
      byNumber.set(num, q);
    }
  });

  // MCQ "choose TWO" (checkbox group, data-correct holds the letter set)
  $(".mc-question[data-mcq-group]").each((_, el) => {
    const $el = $(el);
    const groupKey = $el.attr("data-mcq-group") || null;
    const correct = ($el.attr("data-correct") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const prompt = $el.find(".tfng-statement-text").text().trim();
    const options: ParsedOption[] = $el
      .find('input[type="checkbox"]')
      .toArray()
      .map((c) => ({
        value: $(c).attr("value") ?? "",
        label: $(c).closest("label").text().replace(/\s+/g, " ").trim(),
      }));
    $el.find(".review-flag[data-q]").each((__, b) => {
      const num = Number.parseInt($(b).attr("data-q") ?? "", 10);
      if (!Number.isFinite(num)) return;
      const q = blank(num, partOf(el), prompt, options);
      q.groupKey = groupKey;
      q.qtype = "mcq_multi";
      q.answer = { mode: "mcq_set", accept: correct, explanation: null, evidence: null };
      byNumber.set(num, q);
    });
  });

  const multiChoiceNums = [...byNumber.keys()]
    .filter((num) => isMultiChoiceSetLabel(questionTypesRaw[String(num)] ?? ""))
    .sort((a, b) => a - b);
  let multiChoiceGroup: number[] = [];
  const flushMultiChoiceGroup = (): void => {
    if (multiChoiceGroup.length < 2) return;
    const groupKey = `${multiChoiceGroup[0]}-${multiChoiceGroup[multiChoiceGroup.length - 1]}`;
    const correct = [
      ...new Set(
        multiChoiceGroup.flatMap((num) => {
          const direct = correctAnswers[String(num)];
          if (direct != null) {
            return String(direct)
              .split(",")
              .map((s) => NORM(s))
              .filter(Boolean);
          }
          return (acceptable[String(num)] ?? []).map((s) => NORM(s));
        }),
      ),
    ];
    const prompt =
      multiChoiceGroup
        .map((num) => byNumber.get(num)?.promptHtml ?? "")
        .find((p) => p && !/^(first|second|third)\s+answer$/i.test(p)) ?? "";
    for (const num of multiChoiceGroup) {
      const q = byNumber.get(num);
      if (!q) continue;
      q.qtype = "mcq_multi";
      q.groupKey = groupKey;
      if (prompt) q.promptHtml = prompt;
      q.answer = { mode: "mcq_set", accept: correct, explanation: null, evidence: null };
    }
  };
  for (const num of multiChoiceNums) {
    const last = multiChoiceGroup[multiChoiceGroup.length - 1];
    if (multiChoiceGroup.length === 0 || num === last! + 1) {
      multiChoiceGroup.push(num);
      continue;
    }
    flushMultiChoiceGroup();
    multiChoiceGroup = [num];
  }
  flushMultiChoiceGroup();

  // assign canon type (skip mcq_multi, already typed) + route the answer key
  for (const [num, q] of byNumber) {
    if (q.qtype !== "mcq_multi") {
      const raw = questionTypesRaw[String(num)] ?? "";
      const { type, confident } = canonQuestionType(raw);
      if (type) {
        q.qtype = type;
        if (!confident) warnings.push(`Q${num}: fuzzy type "${raw}" -> ${type}`);
      } else {
        // Канонический envelope (как parse-runner): только его матчит publish-гейт
        // isUnresolvedQuestionTypeWarning; самодельная строка проскакивала бы мимо.
        // Fallback вместо пустого qtype — вопрос не теряется, публикацию режет гейт.
        warnings.push(raw.trim() === "" ? blankTypeWarning(num) : unknownTypeWarning(num, raw));
        q.qtype = UNKNOWN_TYPE_FALLBACK;
      }
    }
    if (q.answer.accept.length === 0) q.answer = routeKey(num, correctAnswers, acceptable);
    warnEmptyPrompt(num, q.promptHtml, q.qtype, warnings);
  }

  const questions = [...byNumber.values()].sort((a, b) => a.number - b.number);
  const keyCount = Object.keys(correctAnswers).length;
  if (keyCount !== questions.length) {
    warnings.push(
      `Question/answer-key count mismatch: ${questions.length} questions vs ${keyCount} keyed.`,
    );
  }
  const missing = questions.filter((q) => q.answer.accept.length === 0);
  for (const q of missing) warnings.push(`Q${q.number}: no answer in the key.`);

  const questionTypes = [...new Set(questions.map((q) => q.qtype).filter(Boolean))];

  return {
    title,
    section: "reading",
    category: "full_reading",
    bandType: "reading_academic",
    durationSeconds: 3600, // IELTS Reading: 60 min
    questionTypes,
    bandScale: bandScale ?? null,
    passages,
    questions,
    warnings,
  };
}

const NORM = (s: string) => s.trim().toUpperCase().replace(/\s+/g, " ");

/**
 * Тихая порча: вопрос доходит сюда с пустым/обрезанным prompt, если его собрали из
 * незнакомой вёрстки — клон контейнера, не совпавшего ни с одним известным классом,
 * даёт "" (а выделенный элемент stem может отсутствовать). Ни gap-гейт (номер есть),
 * ни empty_key (ключ есть) этого не ловят — только warning в общий поток.
 * matching_headings синтезирует prompt ("Paragraph X") из буквы абзаца, а не из
 * контейнера, поэтому исключён (его пустота — иной класс дефекта).
 */
const PROMPT_MIN_LEN = 4;
function warnEmptyPrompt(
  num: number,
  promptHtml: string,
  qtype: string,
  warnings: string[],
): void {
  if (qtype === "matching_headings") return;
  if (promptHtml.trim().length < PROMPT_MIN_LEN) {
    warnings.push(`Q${num}: empty prompt`);
  }
}

function isMultiChoiceSetLabel(label: string): boolean {
  return /multiple\s+choice/i.test(label) && /(two|three|answers)/i.test(label);
}

function blank(
  number: number,
  passageOrder: number,
  promptHtml: string,
  options: ParsedOption[] | null,
): ParsedQuestion {
  return {
    number,
    passageOrder,
    qtype: "",
    promptHtml,
    options,
    groupKey: null,
    evidenceRef: null,
    answer: { mode: "exact", accept: [], explanation: null, evidence: null },
  };
}

function routeKey(
  num: number,
  correct: Record<string, string>,
  acceptable: Record<string, string[]>,
): ParsedAnswerKey {
  const key = String(num);
  if (acceptable[key]?.length) {
    return { mode: "text_accept", accept: acceptable[key], explanation: null, evidence: null };
  }
  if (correct[key] != null) {
    return { mode: "exact", accept: [NORM(String(correct[key]))], explanation: null, evidence: null };
  }
  return { mode: "exact", accept: [], explanation: null, evidence: null };
}

/** Strip active content from a passage section before serializing (XSS, §11). */
function sanitize($: CheerioAPI, scope: ReturnType<CheerioAPI>): void {
  scope.find("script, style, link, meta, iframe, object, embed, noscript, form, button").remove();
  scope.find("*").each((_, el) => {
    if (!("attribs" in el)) return;
    for (const name of Object.keys(el.attribs)) {
      if (/^on/i.test(name)) $(el).removeAttr(name);
      else if (
        /^(href|src|xlink:href|formaction|action)$/i.test(name) &&
        /^\s*(javascript|data|vbscript):/i.test(el.attribs[name] ?? "")
      ) {
        $(el).removeAttr(name);
      }
    }
  });
}
