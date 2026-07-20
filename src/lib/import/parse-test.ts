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
  mcqGroups: Record<string, string[]>;
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

  // assign canon type + answer key per question
  for (const [num, q] of byNumber) {
    const rawType = questionTypesRaw[String(num)] ?? "";
    const { type, confident } = canonQuestionType(rawType);
    if (type) {
      q.qtype = type;
      if (!confident)
        warnings.push(`Q${num}: fuzzy type match "${rawType}" -> ${type}`);
    } else {
      warnings.push(`Q${num}: unknown question type label "${rawType}"`);
    }
    q.answer = routeAnswer(num, data, warnings);
    q.evidenceRef = data.evidence[String(num)]?.para ?? null;
  }

  const questions = [...byNumber.values()].sort((a, b) => a.number - b.number);

  // sanity vs the answer key
  const keyCount = new Set([
    ...Object.keys(data.correctAnswers),
    ...Object.keys(data.acceptableAnswers),
    ...Object.keys(data.mcqGroups),
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
  warnings: string[],
): ParsedAnswerKey {
  const key = String(num);
  const explanation = data.explanations[key] ?? null;
  const evidence = data.evidence[key] ?? null;

  if (data.mcqGroups[key]) {
    return { mode: "mcq_set", accept: data.mcqGroups[key], explanation, evidence };
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
