import * as cheerio from "cheerio";
import { extractData, extractFunctionTable, extractRangeBuilderTable } from "../extract-js";
import { canonQuestionType, unknownTypeWarning, UNKNOWN_TYPE_FALLBACK } from "../question-types";
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

function mkQuestion(
  number: number,
  qtype: string,
  answer: ParsedAnswerKey,
  groupKey: string | null = null,
): ParsedQuestion {
  return {
    number,
    passageOrder: 1,
    qtype,
    promptHtml: "",
    options: null,
    groupKey,
    evidenceRef: null,
    answer,
  };
}

function parseReadingRunner(html: string): RunnerParseResult {
  const src = scriptText(html);
  const correct = extractData<Record<string, string>>(src, "correctAnswers") ?? {};
  // Варианты живут под двумя именами: acceptableAnswers (основной источник) и
  // acceptableVariants (Vol7/Mock, QA 2026-07-02). Оба — {номер: [варианты]}.
  const accept: Record<string, string[]> = {
    ...(extractData<Record<string, string[]>>(src, "acceptableAnswers") ?? {}),
    ...(extractData<Record<string, string[]>>(src, "acceptableVariants") ?? {}),
  };
  const types = extractData<Record<string, string>>(src, "questionTypes") ?? {};
  const expl = extractData<Record<string, string>>(src, "explanations") ?? {};
  const evid = extractData<Record<string, { para: string; snippet: string }>>(src, "evidence") ?? {};
  // Reading "choose TWO/THREE": members share one correct letter-set, keyed by range
  // in mcqGroups ({"8-12": {qs, correct}}) — same source convention parse-test.ts reads.
  // Without this the members fell to exact/text_accept and set-grading was wrong (#7).
  const mcqGroups = extractData<Record<string, { qs: number[]; correct: string[] }>>(src, "mcqGroups") ?? {};
  const mcqByNum = new Map<number, { groupKey: string; correct: string[] }>();
  for (const [groupKey, g] of Object.entries(mcqGroups)) {
    for (const n of g?.qs ?? []) mcqByNum.set(n, { groupKey, correct: g.correct ?? [] });
  }
  const bandScale = extractFunctionTable(src, "getBandFor40", 0, 40);

  // Union: an mcq-multi member may live only in mcqGroups, not in correctAnswers.
  const numbers = [...new Set([...Object.keys(correct).map(Number), ...mcqByNum.keys()])].sort(
    (a, b) => a - b,
  );
  const warnings: string[] = [];
  const questions = numbers.map((n) => {
    const k = String(n);
    const grp = mcqByNum.get(n);
    if (grp) {
      // mcq-multi member: type unambiguous from the group; graded as a letter-set.
      if (grp.correct.length === 0) warnings.push(`Q${n}: empty answer key`);
      return mkQuestion(
        n,
        "mcq_multi",
        { mode: "mcq_set", accept: grp.correct, explanation: expl[k] ?? null, evidence: evid[k] ?? null },
        grp.groupKey,
      );
    }
    const answer: ParsedAnswerKey = accept[k]?.length
      ? { mode: "text_accept", accept: accept[k]!, explanation: expl[k] ?? null, evidence: evid[k] ?? null }
      : { mode: "exact", accept: [NORM(correct[k])], explanation: expl[k] ?? null, evidence: evid[k] ?? null };
    // Review-gate (BRIEF §4.2.1): не глотать неуверенный маппинг типа — поднять
    // в warnings, чтобы админ увидел fallback перед публикацией.
    const canon = canonQuestionType(types[k] ?? "");
    if (canon.type === null) {
      warnings.push(unknownTypeWarning(n, types[k] ?? ""));
    } else if (!canon.confident) {
      warnings.push(`Q${n}: low-confidence type ${JSON.stringify(types[k] ?? "")} → ${canon.type}`);
    }
    if (!answer.accept.some((a) => (a ?? "").trim() !== "")) {
      warnings.push(`Q${n}: empty answer key`);
    }
    return mkQuestion(n, canon.type ?? UNKNOWN_TYPE_FALLBACK, answer);
  });
  // Агрегаты-подсказки: отсутствие разбора/доказательства — не блокер, инфо.
  const noExpl = numbers.filter((n) => !expl[String(n)]).length;
  if (noExpl > 0) warnings.push(`${noExpl} question(s) without explanation`);
  const noEvid = numbers.filter((n) => !evid[String(n)]).length;
  if (noEvid > 0) warnings.push(`${noEvid} question(s) without evidence`);

  // Full Reading (40Q) несёт getBandFor40 → bandScale; одиночный пассаж — нет.
  // По этому признаку разводим категорию/длительность (иначе 13Q-пассаж покажется
  // в каталоге как «Full Reading · 60m»). Номер пассажа из файла не известен → passage_1.
  const isFull = bandScale != null;
  const parsed: ParsedTest = {
    title: extractTitle(html, "Reading"),
    section: "reading",
    category: isFull ? "full_reading" : "passage_1",
    bandType: "reading_academic",
    durationSeconds: isFull ? 60 * 60 : 20 * 60,
    questionTypes: [...new Set(questions.map((q) => q.qtype))],
    bandScale: bandScale ? toStringKeys(bandScale) : null,
    passages: [{ order: 1, title: null, bodyHtml: "", audioPath: null, questionsHtml: null }],
    questions,
    warnings,
  };
  return { parsed, externalAudioSrc: null };
}

function parseListeningRunner(html: string): RunnerParseResult {
  const src = scriptText(html);
  const key = extractData<Record<string, string[]>>(src, "KEY") ?? {};
  // QTYPE может быть статичным литералом ИЛИ наполняться range-builder'ом в IIFE
  // (тогда литерал на момент объявления пуст). Литерал имеет приоритет; если он
  // пуст/отсутствует — восстанавливаем типы из вызовов-наполнителей.
  const literalTypes = extractData<Record<string, string>>(src, "QTYPE");
  const types =
    literalTypes && Object.keys(literalTypes).length > 0
      ? literalTypes
      : extractRangeBuilderTable(src, "QTYPE") ?? {};
  const bandScale = extractFunctionTable(src, "band", 0, 40);

  const numbers = Object.keys(key).map(Number).sort((a, b) => a - b);
  const warnings: string[] = [];
  const questions = numbers.map((n) => {
    const variants = key[String(n)] ?? [];
    const answer: ParsedAnswerKey = {
      mode: variants.length > 1 ? "text_accept" : "exact",
      accept: variants,
      explanation: null,
      evidence: null,
    };
    // Review-gate: поднять неуверенный маппинг типа и пустой ключ в warnings.
    const canon = canonQuestionType(types[String(n)] ?? "");
    if (canon.type === null) {
      warnings.push(unknownTypeWarning(n, types[String(n)] ?? ""));
    } else if (!canon.confident) {
      warnings.push(`Q${n}: low-confidence type ${JSON.stringify(types[String(n)] ?? "")} → ${canon.type}`);
    }
    if (!answer.accept.some((a) => (a ?? "").trim() !== "")) {
      warnings.push(`Q${n}: empty answer key`);
    }
    return mkQuestion(n, canon.type ?? UNKNOWN_TYPE_FALLBACK, answer);
  });

  const $ = cheerio.load(html);
  const externalAudioSrc = $("audio").attr("src") ?? null;

  // Full Listening (40Q) несёт band() → bandScale; одиночная часть — нет.
  const isFull = bandScale != null;
  const parsed: ParsedTest = {
    title: extractTitle(html, "Listening"),
    section: "listening",
    category: isFull ? "full_listening" : "part_1",
    bandType: "listening",
    durationSeconds: isFull ? 30 * 60 : 10 * 60,
    questionTypes: [...new Set(questions.map((q) => q.qtype))],
    bandScale: bandScale ? toStringKeys(bandScale) : null,
    passages: [{ order: 1, title: null, bodyHtml: "", audioPath: null, questionsHtml: null }],
    questions,
    warnings,
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
