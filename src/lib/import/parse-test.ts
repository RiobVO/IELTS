import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import { extractData } from "./extract-js";
import { canonQuestionType } from "./question-types";
import type {
  ParsedAnswerKey,
  ParsedOption,
  ParsedQuestion,
  ParsedTest,
} from "./types";

interface KeyData {
  correctAnswers: Record<string, string>;
  acceptableAnswers: Record<string, string[]>;
  // Real files key mcq-multi by a RANGE ("8-12") -> the member numbers + the
  // shared correct letter-set (data-mcq-group / mcqGroups in the source JS).
  mcqGroups: Record<string, { qs: number[]; correct: string[] }>;
  explanations: Record<string, string>;
  evidence: Record<string, { para: string; snippet: string }>;
}

/**
 * Deterministic parser for the canonical IELTS test HTML template (BRIEF §4.2).
 * Handles the structures seen in the real files: note/sentence completion
 * (text inputs) and TRUE/FALSE/NOT GIVEN + YES/NO/NOT GIVEN (radio blocks).
 * MCQ / matching / map-labelling are routed by data when present and flagged
 * for review otherwise — finalized against their first real file (BRIEF §10).
 */
export function parseTest(html: string): ParsedTest {
  const $ = cheerio.load(html);
  const warnings: string[] = [];

  // --- embedded JS data objects ---
  const script = $("script")
    .toArray()
    .map((s) => $(s).html() ?? "")
    .join("\n");
  const data: KeyData = {
    correctAnswers: extractData(script, "correctAnswers") ?? {},
    acceptableAnswers: extractData(script, "acceptableAnswers") ?? {},
    mcqGroups: extractData(script, "mcqGroups") ?? {},
    explanations: extractData(script, "explanations") ?? {},
    evidence: extractData(script, "evidence") ?? {},
  };
  const questionTypesRaw: Record<string, string> =
    extractData(script, "questionTypes") ?? {};

  // Map each mcq-multi member question number -> its group key + shared correct
  // letter-set, so a "8-12" group keys all five questions as one mcq_set.
  const mcqByNum = new Map<number, { groupKey: string; correct: string[] }>();
  for (const [groupKey, g] of Object.entries(data.mcqGroups)) {
    for (const n of g?.qs ?? []) {
      mcqByNum.set(n, { groupKey, correct: g.correct ?? [] });
    }
  }

  // --- meta ---
  const h1 = $("#passageContent h1").first().text().trim();
  const title =
    h1 ||
    $("title")
      .text()
      .replace(/^.*?[-–]\s*/, "")
      .trim() ||
    "Untitled test";
  const rubricText = $(".sectionRubric").text();
  const category = detectCategory($, rubricText, warnings);
  const durationSeconds = detectDuration(rubricText);

  // --- passage(s) ---
  const bodyHtml = ($("#passageContent").html() ?? "").trim();
  if (!bodyHtml) warnings.push("Passage body (#passageContent) not found.");
  const passages = [
    { order: 1, title: h1 || null, bodyHtml, audioPath: null },
  ];

  // --- questions ---
  const byNumber = new Map<number, ParsedQuestion>();

  // completion: text inputs (name="qN") inside a notes/sentence stem
  $('input[type="text"][name^="q"]').each((_, el) => {
    const name = $(el).attr("name") ?? "";
    const num = Number.parseInt(name.slice(1), 10);
    if (!Number.isFinite(num)) return;
    const stem = $(el).closest('[id^="question-"]');
    const clone = $(stem).clone();
    clone.find(".blank-wrapper").replaceWith(" ____ ");
    clone.find(".review-flag, .cdi-placeholder").remove();
    const prompt = clone.text().replace(/\s+/g, " ").trim();
    byNumber.set(
      num,
      blank(num, prompt, null, grpKey($(el).closest(".question").attr("id"))),
    );
  });

  // TFNG / YNNG: statement + radio options
  $(".tfng-question").each((_, el) => {
    const id = $(el).attr("id") ?? "";
    const num = Number.parseInt(id.replace(/\D+/g, ""), 10);
    if (!Number.isFinite(num)) return;
    const prompt = $(el).find(".tfng-statement-text").text().trim();
    const options: ParsedOption[] = $(el)
      .find('input[type="radio"]')
      .toArray()
      .map((r) => {
        const value = $(r).attr("value") ?? "";
        return { value, label: value };
      });
    byNumber.set(
      num,
      blank(num, prompt, options, grpKey($(el).closest(".question").attr("id"))),
    );
  });

  // letter options (A, B, ...) from .mcq-row inputs of an MCQ block.
  const optionsIn = (block: cheerio.Cheerio<ReturnType<typeof $>[number]>) =>
    block
      .find(".mcq-row")
      .toArray()
      .map((row) => {
        const value = $(row).find("input").attr("value") ?? "";
        const label = $(row).find("span").last().text().trim();
        return { value, label: label || value };
      });
  // question stem shown above an MCQ block's options.
  const promptOf = (block: cheerio.Cheerio<ReturnType<typeof $>[number]>) =>
    block.closest(".question").find(".question-rubric p").last().text().trim();

  // MCQ single: one radio block per question (.mcq-single, id="question-N").
  $(".mcq-single").each((_, el) => {
    const $el = $(el);
    const num = Number.parseInt(($el.attr("id") ?? "").replace(/\D+/g, ""), 10);
    if (!Number.isFinite(num)) return;
    byNumber.set(
      num,
      blank(num, promptOf($el), optionsIn($el), grpKey($el.closest(".question").attr("id"))),
    );
  });

  // MCQ multi: one .mcq-block (data-mcq-group="8-12") covers several questions
  // (mcq-q-num-box) that share one option list and one correct letter-set.
  $(".mcq-block").each((_, el) => {
    const $el = $(el);
    const groupKey = $el.attr("data-mcq-group") || null;
    const options = optionsIn($el);
    const prompt = promptOf($el);
    $el.find(".mcq-q-num-box").each((__, box) => {
      const num = Number.parseInt($(box).text().trim(), 10);
      if (!Number.isFinite(num)) return;
      byNumber.set(num, blank(num, prompt, options, groupKey));
    });
  });

  // assign canon type + answer key per question
  for (const [num, q] of byNumber) {
    if (mcqByNum.has(num)) {
      // mcq-multi member: the type is unambiguous from the group structure.
      q.qtype = "mcq_multi";
    } else {
      const rawType = questionTypesRaw[String(num)] ?? "";
      const { type, confident } = canonQuestionType(rawType);
      if (type) {
        q.qtype = type;
        if (!confident)
          warnings.push(`Q${num}: fuzzy type match "${rawType}" -> ${type}`);
      } else {
        warnings.push(`Q${num}: unknown question type label "${rawType}"`);
      }
    }
    q.answer = routeAnswer(num, data, mcqByNum, warnings);
    q.evidenceRef = data.evidence[String(num)]?.para ?? null;
  }

  const questions = [...byNumber.values()].sort((a, b) => a.number - b.number);

  // sanity vs the answer key
  const keyCount = new Set([
    ...Object.keys(data.correctAnswers),
    ...Object.keys(data.acceptableAnswers),
    // mcqGroups are keyed by range ("8-12") — count their MEMBER numbers.
    ...Object.values(data.mcqGroups).flatMap((g) => (g?.qs ?? []).map(String)),
  ]).size;
  if (keyCount !== questions.length) {
    warnings.push(
      `Question/answer-key count mismatch: ${questions.length} questions vs ${keyCount} keyed.`,
    );
  }

  const questionTypes = [
    ...new Set(questions.map((q) => q.qtype).filter(Boolean)),
  ];

  return {
    title,
    section: "reading",
    category,
    bandType: "reading_academic",
    durationSeconds,
    questionTypes,
    passages,
    questions,
    warnings,
  };
}

/* ----------------------------- helpers --------------------------------- */

function blank(
  number: number,
  promptHtml: string,
  options: ParsedOption[] | null,
  groupKeyVal: string | null,
): ParsedQuestion {
  return {
    number,
    qtype: "",
    promptHtml,
    options,
    groupKey: groupKeyVal,
    evidenceRef: null,
    answer: { mode: "exact", accept: [], explanation: null, evidence: null },
  };
}

function grpKey(id: string | undefined): string | null {
  const m = /question-group-(.+)$/.exec(id ?? "");
  return m ? m[1]! : null;
}

const NORM = (s: string) => s.trim().toUpperCase().replace(/\s+/g, " ");

function routeAnswer(
  num: number,
  data: KeyData,
  mcqByNum: Map<number, { groupKey: string; correct: string[] }>,
  warnings: string[],
): ParsedAnswerKey {
  const key = String(num);
  const explanation = data.explanations[key] ?? null;
  const evidence = data.evidence[key] ?? null;

  const grp = mcqByNum.get(num);
  if (grp) {
    // mcq-multi member: graded as a set of letters (BRIEF §4.2 mcq_set).
    return { mode: "mcq_set", accept: grp.correct, explanation, evidence };
  }
  if (data.acceptableAnswers[key]) {
    return {
      mode: "text_accept",
      accept: data.acceptableAnswers[key],
      explanation,
      evidence,
    };
  }
  if (data.correctAnswers[key] != null) {
    return {
      mode: "exact",
      accept: [NORM(String(data.correctAnswers[key]))],
      explanation,
      evidence,
    };
  }
  warnings.push(`Q${num}: no answer found in the key.`);
  return { mode: "exact", accept: [], explanation, evidence };
}

function detectCategory(
  $: CheerioAPI,
  rubric: string,
  warnings: string[],
): string {
  if (/full\s+reading/i.test(rubric)) return "full_reading";
  const m = /reading\s+passage\s+([123])/i.exec(rubric);
  if (m) return `passage_${m[1]}`;
  warnings.push("Could not detect category from rubric; defaulted to passage_1.");
  return "passage_1";
}

function detectDuration(rubric: string): number | null {
  const m = /spend\s+about\s+(\d+)\s+minutes/i.exec(rubric);
  return m ? Number.parseInt(m[1]!, 10) * 60 : null;
}
