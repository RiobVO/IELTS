import * as cheerio from "cheerio";
import { extractData, extractFunctionTable } from "./extract-js";
import type {
  ParsedAnswerKey,
  ParsedOption,
  ParsedPassage,
  ParsedQuestion,
  ParsedTest,
} from "./types";

/**
 * Deterministic parser for the IELTS Listening template (BRIEF §4.2) — the third
 * source variant. Differs from Reading: the key lives in `KEY` (not
 * correctAnswers), the band scale is a threshold FUNCTION `band(r)`, and the
 * markup is 4 parts (.part[data-part]) with three answer mechanisms —
 * .gap[data-q] (completion), radio input[name=qN] (mcq), .dropzone[data-q]
 * (matching). There is no questionTypes object: the type is inferred from each
 * part's .q-instruction, exactly as a human reads it.
 */
export function parseListening(html: string): ParsedTest {
  const $ = cheerio.load(html);
  const warnings: string[] = [];

  const script = $("script")
    .toArray()
    .map((s) => $(s).html() ?? "")
    .join("\n");
  const key: Record<string, string[]> = extractData(script, "KEY") ?? {};
  if (Object.keys(key).length === 0) warnings.push("KEY answer object not found.");
  const bandScale = extractFunctionTable(script, "band", 0, 40);
  if (!bandScale) warnings.push("band(r) function not found — no band scale.");

  const title =
    $("title")
      .text()
      .replace(/\s*[-–|].*$/, "")
      .trim() || "IELTS Listening";
  const audioSrc = $("audio").attr("src") ?? null;
  if (!audioSrc) warnings.push("No <audio> source found.");

  const passages: ParsedPassage[] = [];
  const questions: ParsedQuestion[] = [];

  $(".part[data-part]").each((_, sec) => {
    const $sec = $(sec);
    const part = Number.parseInt($sec.attr("data-part") ?? "", 10);
    if (!Number.isFinite(part)) return;

    const banner = $sec.find(".part-banner").text().replace(/\s+/g, " ").trim();
    passages.push({
      order: part,
      title: `Part ${part}`,
      // Listening "passage" carries no reading text — store the part banner as
      // context. The interactive form/table/matching is re-rendered from the
      // questions by our own components (§4.2), not from raw HTML.
      bodyHtml: banner || `Part ${part}`,
      // One audio file for the whole test — attach to each part; the player uses
      // the first non-null path.
      audioPath: audioSrc,
    });

    // Completion sub-type is set by the part's instruction (form / notes), or
    // table_completion when the gap sits inside a results table.
    const instr = $sec.find(".q-instruction").text().toLowerCase();
    const completionType = /\bform\b/.test(instr)
      ? "form_completion"
      : "note_completion";

    // 1) completion gaps
    $sec.find("input.gap[data-q]").each((__, el) => {
      const num = Number.parseInt($(el).attr("data-q") ?? "", 10);
      if (!Number.isFinite(num)) return;
      const inTable = $(el).closest("table").length > 0;
      const container = $(el).closest("td, .form-row, .note-line, li");
      const clone = container.length ? container.clone() : $(el).parent().clone();
      clone.find(".qnum").remove(); // drop the visible question number
      clone.find("input").replaceWith(" ____ ");
      const prompt = clone.text().replace(/\s+/g, " ").trim();
      questions.push(
        mk(num, inTable ? "table_completion" : completionType, prompt, null, null, key),
      );
    });

    // 2) single MCQ (.mcq[data-q] with radio options A/B/C)
    $sec.find(".mcq[data-q]").each((__, el) => {
      const $el = $(el);
      const num = Number.parseInt($el.attr("data-q") ?? "", 10);
      if (!Number.isFinite(num)) return;
      const stem = $el.find(".stem").clone();
      stem.find(".qnum").remove(); // drop the visible question number
      const prompt = stem.text().replace(/\s+/g, " ").trim();
      const options: ParsedOption[] = $el
        .find('input[type="radio"]')
        .toArray()
        .map((r) => {
          const value = $(r).attr("value") ?? "";
          const label = $(r).closest("label").text().replace(/\s+/g, " ").trim();
          return { value, label: label || value };
        });
      questions.push(mk(num, "mcq_single", prompt, options, null, key));
    });

    // 3) matching (chip-bank letters dropped into .dropzone[data-q] rows)
    const chips: ParsedOption[] = $sec
      .find(".chip-bank .chip[data-letter]")
      .toArray()
      .map((c) => ({
        value: $(c).attr("data-letter") ?? "",
        label: $(c).text().replace(/\s+/g, " ").trim(),
      }));
    const dropzones = $sec.find(".dropzone[data-q]").toArray();
    const groupKey =
      dropzones.length > 1
        ? `${$(dropzones[0]).attr("data-q")}-${$(dropzones[dropzones.length - 1]).attr("data-q")}`
        : null;
    for (const dz of dropzones) {
      const num = Number.parseInt($(dz).attr("data-q") ?? "", 10);
      if (!Number.isFinite(num)) continue;
      const prompt = $(dz)
        .closest(".match-row")
        .find(".mtext")
        .text()
        .replace(/\s+/g, " ")
        .trim();
      questions.push(mk(num, "matching_features", prompt, chips, groupKey, key));
    }
  });

  questions.sort((a, b) => a.number - b.number);

  const keyCount = Object.keys(key).length;
  if (keyCount !== questions.length) {
    warnings.push(
      `Question/answer-key count mismatch: ${questions.length} questions vs ${keyCount} keyed.`,
    );
  }
  const missingKey = questions.filter((q) => q.answer.accept.length === 0);
  for (const q of missingKey) warnings.push(`Q${q.number}: no answer in KEY.`);

  const questionTypes = [...new Set(questions.map((q) => q.qtype).filter(Boolean))];

  return {
    title,
    section: "listening",
    category: "full_listening",
    bandType: "listening",
    durationSeconds: null,
    questionTypes,
    bandScale: bandScale
      ? Object.fromEntries(Object.entries(bandScale).map(([k, v]) => [k, v]))
      : null,
    passages,
    questions,
    warnings,
  };
}

/** Build a ParsedQuestion with its answer routed from KEY (variants). */
function mk(
  number: number,
  qtype: string,
  promptHtml: string,
  options: ParsedOption[] | null,
  groupKey: string | null,
  key: Record<string, string[]>,
): ParsedQuestion {
  return {
    number,
    qtype,
    promptHtml,
    options,
    groupKey,
    evidenceRef: null,
    answer: toAnswer(key[String(number)]),
  };
}

/**
 * KEY[q] is an array of acceptable variants. >1 variant -> text_accept (graded
 * by normalized membership); a single value (MCQ/matching letter or a lone
 * completion answer) -> exact. Both modes normalize on both sides in grade.ts,
 * so a single-element set grades identically either way.
 */
function toAnswer(variants: string[] | undefined): ParsedAnswerKey {
  const accept = variants ?? [];
  return {
    mode: accept.length > 1 ? "text_accept" : "exact",
    accept,
    explanation: null,
    evidence: null,
  };
}
