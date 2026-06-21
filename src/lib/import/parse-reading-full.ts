import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import { captureQuestions } from "./capture-questions";
import { extractData, extractFunctionTable } from "./extract-js";
import { canonQuestionType } from "./question-types";
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
export function parseFullReading(html: string): ParsedTest {
  const $ = cheerio.load(html);
  const warnings: string[] = [];

  const script = $("script")
    .toArray()
    .map((s) => $(s).html() ?? "")
    .join("\n");
  const correctAnswers: Record<string, string> =
    extractData(script, "correctAnswers") ?? {};
  const acceptable: Record<string, string[]> =
    extractData(script, "acceptableVariants") ?? {};
  const questionTypesRaw: Record<string, string> =
    extractData(script, "questionTypes") ?? {};
  const bandScale = extractFunctionTable(script, "getBand", 0, 40);
  if (!bandScale) warnings.push("getBand function not found — no band scale.");

  const title =
    $("#passageContent h1").first().text().trim() ||
    $("title")
      .text()
      .replace(/\s*[-–|].*$/, "")
      .trim() ||
    "IELTS Reading (Full)";

  // --- passages: one per .passage-section[data-part] ---
  const passages: ParsedPassage[] = [];
  $(".passage-section[data-part]").each((_, el) => {
    const $el = $(el);
    const order = Number.parseInt($el.attr("data-part") ?? "", 10);
    if (!Number.isFinite(order)) return;
    sanitize($, $el);
    const bodyHtml = ($el.find(".passage-content").html() ?? $el.html() ?? "").trim();
    const pTitle = $el.find(".sectionRubric h2").first().text().trim() || `Passage ${order}`;
    const questionsHtml =
      captureQuestions(
        $(`.questions-section[data-part='${order}'] .question`).toArray().map((b) => $.html(b)),
      ) || null;
    passages.push({ order, title: pTitle, bodyHtml, audioPath: null, questionsHtml });
  });

  const byNumber = new Map<number, ParsedQuestion>();
  const partOf = (node: Parameters<typeof $>[0]): number => {
    const dp = $(node).closest(".questions-section[data-part]").attr("data-part");
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
    const ctx = $(el).closest(".flow-row, li, p");
    const clone = (ctx.length ? ctx : $(el).parent()).clone();
    clone.find(".review-flag").remove();
    clone.find("input").replaceWith(" ____ ");
    const prompt = clone.text().replace(/\s+/g, " ").trim();
    byNumber.set(num, blank(num, partOf(el), prompt, null));
  });

  // matching / classification (radio rows in a matching-table)
  $("table.matching-table tr[id^='question-']").each((_, el) => {
    const $el = $(el);
    const num = Number.parseInt(($el.attr("id") ?? "").replace(/\D+/g, ""), 10);
    if (!Number.isFinite(num) || byNumber.has(num)) return;
    const prompt = $el.find(".q-text").text().trim();
    const options = $el
      .find('input[type="radio"]')
      .toArray()
      .map((r) => ({ value: $(r).attr("value") ?? "", label: $(r).attr("value") ?? "" }));
    byNumber.set(num, blank(num, partOf(el), prompt, options));
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

  // assign canon type (skip mcq_multi, already typed) + route the answer key
  for (const [num, q] of byNumber) {
    if (q.qtype !== "mcq_multi") {
      const raw = questionTypesRaw[String(num)] ?? "";
      const { type, confident } = canonQuestionType(raw);
      if (type) {
        q.qtype = type;
        if (!confident) warnings.push(`Q${num}: fuzzy type "${raw}" -> ${type}`);
      } else {
        warnings.push(`Q${num}: unknown question type label "${raw}"`);
      }
    }
    if (q.answer.accept.length === 0) q.answer = routeKey(num, correctAnswers, acceptable);
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
