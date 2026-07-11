import * as cheerio from "cheerio";
import { extractData, extractFunctionTable, extractObjectLiteral, extractRangeBuilderTable } from "../extract-js";
import {
  canonQuestionType,
  isChooseManyLabel,
  unknownTypeWarning,
  blankTypeWarning,
  UNKNOWN_TYPE_FALLBACK,
} from "../question-types";
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

// Распознаваемые контейнеры ключа ответов (по любому из имён строятся вопросы).
const KEY_CONTAINERS = ["correctAnswers", "KEY", "acceptableAnswers", "acceptableVariants", "mcqGroups"];

/**
 * P4: диагностика отказа при 0 распознанных вопросов. Различает два случая:
 *  - контейнер ключа НЕ найден — источник хранит ключ под нераспознанным именем
 *    (другой генератор, «bespoke»); парсер такой диалект не поддерживает (осознанный YAGNI);
 *  - контейнер найден, но номера вопросов не распознаны (нечисловые ключи вроде "q1",
 *    иная разметка name="qN" / .part[data-part]) — ключ есть, но форма чужая.
 * Только для сообщения об ошибке; поведение импорта (fail-closed) не меняется.
 */
export function diagnoseEmptyRunnerParse(html: string): string {
  const src = scriptText(html);
  // Детекция через extractObjectLiteral (comment-aware, P2): требует реальный `{...}`-литерал,
  // а не имя как подстроку в строке/тексте — иначе ложное "found" (Codex 2026-07-09).
  const declared = KEY_CONTAINERS.filter((name) => extractObjectLiteral(src, name) != null);
  if (declared.length === 0) {
    return (
      `no questions parsed — answer-key container not found (expected one of ` +
      `${KEY_CONTAINERS.join(" / ")}). This source generator isn't supported.`
    );
  }
  return (
    `no questions parsed — answer key found (${declared.join(", ")}) but no question numbers ` +
    `were recognized (expected numeric keys 1..N; this source uses a different layout, e.g. ` +
    `name="qN" / .part[data-part]). This source generator isn't supported.`
  );
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
  // Фильтр положительных целых (P4): нечисловые ключи "q1" (bespoke-диалект) иначе дают
  // number=NaN → падение на persist-integer вместо чистого 0-вопросного отказа.
  const numbers = [...new Set([...Object.keys(correct).map(Number), ...mcqByNum.keys()])]
    .filter((n) => Number.isInteger(n) && n > 0)
    .sort((a, b) => a - b);
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
    // в warnings, чтобы админ увидел fallback перед публикацией. Пустой label
    // (источник не указал тип) и непустой мусор дают РАЗНЫЙ текст warning'а
    // (blankTypeWarning / unknownTypeWarning), но с QTYPE hard-block (2026-07-11)
    // publish-гейт блокирует publish на обоих — см. question-types.ts.
    const rawType = types[k] ?? "";
    const canon = canonQuestionType(rawType);
    if (canon.type === null) {
      warnings.push(rawType.trim() === "" ? blankTypeWarning(n) : unknownTypeWarning(n, rawType));
    } else if (!canon.confident) {
      warnings.push(`Q${n}: low-confidence type ${JSON.stringify(rawType)} → ${canon.type}`);
    }
    // Multi-select guard (вариант B): массив в correctAnswers без mcqGroups-записи — почти
    // наверняка choose-TWO/THREE, оформленный не по authoring-спеке (одиночный ответ клиент
    // в массив не оборачивает). Выход (mode/accept) НЕ меняем — NORM-артефакт остаётся, чтобы
    // грейдинг мока (per-box submit раннера) не поехал; это review-сигнал: админ обязан
    // добавить mcqGroups-диапазон. Длина 1 — не multi (не триггерим).
    const rawCorrect = (correct as Record<string, unknown>)[k];
    if (Array.isArray(rawCorrect) && rawCorrect.length > 1) {
      warnings.push(
        `Q${n}: correctAnswers is an array (possible choose-TWO/THREE) but has no mcqGroups ` +
          `entry — grading falls back to ${answer.mode}; add an mcqGroups range so it is graded as a letter-set`,
      );
    }
    // Тот же multi-select guard по LABEL: ярлык «Multiple Choice (TWO/THREE answers)» без
    // mcqGroups-записи. Выход (qtype/mode/accept) НЕ меняем — только review-сигнал.
    if (isChooseManyLabel(rawType)) {
      warnings.push(
        `Q${n}: question type ${JSON.stringify(rawType)} looks like choose-TWO/THREE but has no ` +
          `mcqGroups entry — the authoring spec requires an mcqGroups range for multi-select MCQ`,
      );
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
  // Страховка счётом вопросов (Vol7/Mock, QA 2026-07-02): источник без band-функции
  // ронял 40-вопросный мок в passage_1 · 20m. Одиночный пассаж — это 13-14 вопросов,
  // полный тест — 40; порог 30 разделяет их с запасом.
  const isFull = bandScale != null || questions.length >= 30;
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
  // Fallback (Listening Mock, QA 2026-07-02): часть listening-файлов хранит ключ в
  // READING-контейнерах (correctAnswers + acceptableVariants/acceptableAnswers).
  // Приводим их к форме KEY {номер: [варианты]}; при наличии KEY fallback не трогаем.
  if (Object.keys(key).length === 0) {
    const correct = extractData<Record<string, string>>(src, "correctAnswers") ?? {};
    const accept: Record<string, string[]> = {
      ...(extractData<Record<string, string[]>>(src, "acceptableAnswers") ?? {}),
      ...(extractData<Record<string, string[]>>(src, "acceptableVariants") ?? {}),
    };
    for (const [k, v] of Object.entries(correct)) {
      key[k] = accept[k]?.length ? accept[k]! : [String(v)];
    }
    for (const [k, v] of Object.entries(accept)) {
      if (!key[k]) key[k] = v;
    }
  }
  // QTYPE может быть статичным литералом ИЛИ наполняться range-builder'ом в IIFE
  // (тогда литерал на момент объявления пуст). Литерал имеет приоритет; если он
  // пуст/отсутствует — восстанавливаем типы из вызовов-наполнителей, затем из
  // reading-имени questionTypes (тот же fallback-источник, что и ключ).
  const literalTypes = extractData<Record<string, string>>(src, "QTYPE");
  const types =
    literalTypes && Object.keys(literalTypes).length > 0
      ? literalTypes
      : extractRangeBuilderTable(src, "QTYPE")
        ?? extractData<Record<string, string>>(src, "questionTypes")
        ?? {};
  const bandScale = extractFunctionTable(src, "band", 0, 40);

  // Фильтр положительных целых (P4): нечисловые ключи "q1" не создают NaN-вопросов.
  const numbers = Object.keys(key)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0)
    .sort((a, b) => a - b);
  const warnings: string[] = [];
  const questions = numbers.map((n) => {
    const variants = key[String(n)] ?? [];
    const answer: ParsedAnswerKey = {
      mode: variants.length > 1 ? "text_accept" : "exact",
      accept: variants,
      explanation: null,
      evidence: null,
    };
    // Review-gate: поднять неуверенный маппинг типа и пустой ключ в warnings. Пустой
    // label и непустой нераспознанный дают разный текст, но оба блокируют publish
    // (QTYPE hard-block, 2026-07-11) — см. question-types.ts.
    const rawType = types[String(n)] ?? "";
    const canon = canonQuestionType(rawType);
    if (canon.type === null) {
      warnings.push(rawType.trim() === "" ? blankTypeWarning(n) : unknownTypeWarning(n, rawType));
    } else if (!canon.confident) {
      warnings.push(`Q${n}: low-confidence type ${JSON.stringify(rawType)} → ${canon.type}`);
    }
    if (!answer.accept.some((a) => (a ?? "").trim() !== "")) {
      warnings.push(`Q${n}: empty answer key`);
    }
    return mkQuestion(n, canon.type ?? UNKNOWN_TYPE_FALLBACK, answer);
  });

  const $ = cheerio.load(html);
  const externalAudioSrc = $("audio").attr("src") ?? null;

  // Full Listening (40Q) несёт band() → bandScale; одиночная часть — нет.
  // Страховка счётом вопросов (Mock, QA 2026-07-02): часть 10-11 вопросов, полный — 40.
  const isFull = bandScale != null || questions.length >= 30;
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
