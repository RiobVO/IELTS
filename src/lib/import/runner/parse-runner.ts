import * as cheerio from "cheerio";
import { extractData, extractFunctionTable } from "../extract-js";
import { canonQuestionType } from "../question-types";
import type { ParsedTest, ParsedQuestion, ParsedAnswerKey } from "../types";

export interface RunnerParseResult {
  parsed: ParsedTest;
  /** Внешний <audio src> (listening) — будет перезалит в Storage. null для reading. */
  externalAudioSrc: string | null;
}

const NORM = (s: unknown) => String(s ?? "").trim().toUpperCase().replace(/\s+/g, " ");

function scriptText(html: string): string {
  // Конкатенация всех inline <script> (ключи лежат в одном из них).
  const $ = cheerio.load(html);
  return $("script:not([src])").map((_, el) => $(el).html() ?? "").get().join("\n");
}

function detectSection(html: string): "listening" | "reading" {
  const $ = cheerio.load(html);
  return $("audio").length > 0 ? "listening" : "reading";
}

export function parseRunner(html: string): RunnerParseResult {
  const section = detectSection(html);
  return section === "listening" ? parseListeningRunner(html) : parseReadingRunner(html);
}

function mkQuestion(number: number, qtype: string, answer: ParsedAnswerKey): ParsedQuestion {
  return {
    number,
    passageOrder: 1,
    qtype,
    promptHtml: "",
    options: null,
    groupKey: null,
    evidenceRef: null,
    answer,
  };
}

function parseReadingRunner(html: string): RunnerParseResult {
  const src = scriptText(html);
  const correct = extractData<Record<string, string>>(src, "correctAnswers") ?? {};
  const accept = extractData<Record<string, string[]>>(src, "acceptableAnswers") ?? {};
  const types = extractData<Record<string, string>>(src, "questionTypes") ?? {};
  const expl = extractData<Record<string, string>>(src, "explanations") ?? {};
  const evid = extractData<Record<string, { para: string; snippet: string }>>(src, "evidence") ?? {};
  const bandScale = extractFunctionTable(src, "getBandFor40", 0, 40);

  const numbers = Object.keys(correct).map(Number).sort((a, b) => a - b);
  const questions = numbers.map((n) => {
    const k = String(n);
    const answer: ParsedAnswerKey = accept[k]?.length
      ? { mode: "text_accept", accept: accept[k]!, explanation: expl[k] ?? null, evidence: evid[k] ?? null }
      : { mode: "exact", accept: [NORM(correct[k])], explanation: expl[k] ?? null, evidence: evid[k] ?? null };
    const qtype = canonQuestionType(types[k] ?? "").type ?? "short_answer";
    return mkQuestion(n, qtype, answer);
  });

  const parsed: ParsedTest = {
    title: extractTitle(html, "Reading"),
    section: "reading",
    category: "full_reading",
    bandType: "reading_academic",
    durationSeconds: 60 * 60,
    questionTypes: [...new Set(questions.map((q) => q.qtype))],
    bandScale: bandScale ? toStringKeys(bandScale) : null,
    passages: [{ order: 1, title: null, bodyHtml: "", audioPath: null, questionsHtml: null }],
    questions,
    warnings: [],
  };
  return { parsed, externalAudioSrc: null };
}

function parseListeningRunner(html: string): RunnerParseResult {
  const src = scriptText(html);
  const key = extractData<Record<string, string[]>>(src, "KEY") ?? {};
  const types = extractData<Record<string, string>>(src, "QTYPE") ?? {};
  const bandScale = extractFunctionTable(src, "band", 0, 40);

  const numbers = Object.keys(key).map(Number).sort((a, b) => a - b);
  const questions = numbers.map((n) => {
    const variants = key[String(n)] ?? [];
    const answer: ParsedAnswerKey = {
      mode: variants.length > 1 ? "text_accept" : "exact",
      accept: variants,
      explanation: null,
      evidence: null,
    };
    const qtype = canonQuestionType(types[String(n)] ?? "").type ?? "short_answer";
    return mkQuestion(n, qtype, answer);
  });

  const $ = cheerio.load(html);
  const externalAudioSrc = $("audio").attr("src") ?? null;

  const parsed: ParsedTest = {
    title: extractTitle(html, "Listening"),
    section: "listening",
    category: "full_listening",
    bandType: "listening",
    durationSeconds: 30 * 60,
    questionTypes: [...new Set(questions.map((q) => q.qtype))],
    bandScale: bandScale ? toStringKeys(bandScale) : null,
    passages: [{ order: 1, title: null, bodyHtml: "", audioPath: null, questionsHtml: null }],
    questions,
    warnings: [],
  };
  return { parsed, externalAudioSrc };
}

function extractTitle(html: string, fallback: string): string {
  const $ = cheerio.load(html);
  return ($("title").text().trim() || fallback).slice(0, 200);
}

function toStringKeys(t: Record<number, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(t)) out[String(k)] = v;
  return out;
}
