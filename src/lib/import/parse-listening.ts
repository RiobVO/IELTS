import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import { extractData, extractFunctionTable, isExecutableScriptType } from "./extract-js";
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
 * (matching), .mcq.multi[data-qs] (choose-TWO/THREE), and .place-chip[data-q]
 * (map labelling). There is no questionTypes object: the type is inferred from
 * each part's .q-instruction, exactly as a human reads it.
 */
export async function parseListening(html: string): Promise<ParsedTest> {
  const $ = cheerio.load(html);
  const warnings: string[] = [];

  const script = $("script")
    .toArray()
    .map((s) => $(s).html() ?? "")
    .join("\n");
  // Исполняемые JS-блоки БЕЗ склейки для extractFunctionTable (каждый блок независим,
  // как отдельный <script>); склеенный `script` остаётся входом extractData.
  const scriptBlocks = $("script")
    .toArray()
    .filter((s) => isExecutableScriptType($(s).attr("type")))
    .map((s) => $(s).html() ?? "");
  const keyRaw: Record<string, string | string[]> =
    (await extractData(script, "KEY")) ?? {};
  const correctRaw: Record<string, string | string[]> =
    (await extractData(script, "correctAnswers")) ?? {};
  const key =
    Object.keys(keyRaw).length > 0 ? normalizeKey(keyRaw) : normalizeKey(correctRaw);
  if (Object.keys(key).length === 0) warnings.push("KEY answer object not found.");

  const title =
    $("title")
      .text()
      .replace(/\s*[-–|].*$/, "")
      .trim() || "IELTS Listening";
  const audioSrc = $("audio").attr("src") ?? $("audio source").attr("src") ?? null;
  if (!audioSrc) warnings.push("No <audio> source found.");

  const passages: ParsedPassage[] = [];
  const questions: ParsedQuestion[] = [];

  const { parts, malformed } = resolvePartSections($, warnings);

  for (const { el: sec, order: part, valid } of parts) {
    const $sec = $(sec);
    const hasQuestion = (num: number): boolean =>
      questions.some((q) => q.number === num);

    const banner = $sec.find(".part-banner").text().replace(/\s+/g, " ").trim();
    const label = valid ? `Part ${part}` : "Part (unrecognized)";
    passages.push({
      order: part,
      title: label,
      // Listening "passage" carries no reading text — store the part banner as
      // context. The interactive form/table/matching is re-rendered from the
      // questions by our own components (§4.2), not from raw HTML.
      bodyHtml: banner || label,
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
        mk(num, part, inTable ? "table_completion" : completionType, prompt, null, null, key),
      );
    });

    // Legacy listening template: text inputs use data-question instead of data-q.
    $sec.find('input.answer-input[type="text"][data-question]').each((__, el) => {
      const num = Number.parseInt($(el).attr("data-question") ?? "", 10);
      if (!Number.isFinite(num) || hasQuestion(num)) return;
      const inTable = $(el).closest("table").length > 0;
      const scoped = $(el).closest("td, li, .form-row, .note-line");
      const container = scoped.length ? scoped : $(el).closest("div");
      const clone = (container.length ? container : $(el).parent()).clone();
      clone.find(".qnum").remove();
      clone.find("input").replaceWith(" ____ ");
      const prompt = clone.text().replace(/\s+/g, " ").trim();
      questions.push(
        mk(num, part, inTable ? "table_completion" : completionType, prompt, null, null, key),
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
      questions.push(mk(num, part, "mcq_single", prompt, options, null, key));
    });

    // Legacy listening template: plain radio groups are keyed by data-question.
    const radioNums = [
      ...new Set(
        $sec
          .find('input.answer-input[type="radio"][data-question]')
          .toArray()
          .map((r) => Number.parseInt($(r).attr("data-question") ?? "", 10))
          .filter((n) => Number.isFinite(n)),
      ),
    ];
    for (const num of radioNums) {
      if (hasQuestion(num)) continue;
      const group = $sec.find(
        `input.answer-input[type="radio"][data-question="${num}"]`,
      );
      if (group.length === 0) continue;
      const labelParent = group.first().closest("label").parent();
      const directPrompt = labelParent.children("div").first().clone();
      directPrompt.find("label, input, select").remove();
      const block = directPrompt.text().trim() ? labelParent : labelParent.parent();
      const stem = block.children("div").first().clone();
      stem.find("label, input, select").remove();
      const prompt =
        stem.text().replace(/\s+/g, " ").replace(new RegExp(`^${num}\\s*`), "").trim() ||
        block
          .clone()
          .find("label, input, select")
          .remove()
          .end()
          .text()
          .replace(/\s+/g, " ")
          .replace(new RegExp(`^${num}\\s*`), "")
          .trim();
      const options: ParsedOption[] = group.toArray().map((r) => {
        const value = $(r).attr("value") ?? "";
        const label = $(r).closest("label").text().replace(/\s+/g, " ").trim();
        return { value, label: label || value };
      });
      questions.push(mk(num, part, "mcq_single", prompt, options, null, key));
    }

    // 3) choose TWO/THREE: one checkbox block covers multiple question numbers.
    $sec.find(".mcq.multi[data-qs]").each((__, el) => {
      const $el = $(el);
      const nums = ($el.attr("data-qs")?.match(/\d+/g) ?? [])
        .map((n) => Number.parseInt(n, 10))
        .filter((n) => Number.isFinite(n));
      if (nums.length === 0) return;
      const groupKey = `${nums[0]}-${nums[nums.length - 1]}`;
      const correct = [
        ...new Set(nums.flatMap((n) => key[String(n)] ?? [])),
      ];
      const stem = $el.find(".stem").clone();
      stem.find(".qnum").remove();
      const prompt = stem.text().replace(/\s+/g, " ").trim();
      const options: ParsedOption[] = $el
        .find('input[type="checkbox"]')
        .toArray()
        .map((c) => {
          const value = $(c).attr("value") ?? "";
          const label = $(c).closest("label").text().replace(/\s+/g, " ").trim();
          return { value, label: label || value };
        });
      for (const num of nums) {
        const q = mk(num, part, "mcq_multi", prompt, options, groupKey, key);
        q.answer = { mode: "mcq_set", accept: correct, explanation: null, evidence: null };
        questions.push(q);
      }
    });

    // Legacy listening template: select[data-question] matching tables.
    const legacySelects = $sec.find("select[data-question]").toArray();
    const legacySelectNums = legacySelects
      .map((el) => Number.parseInt($(el).attr("data-question") ?? "", 10))
      .filter((n) => Number.isFinite(n));
    const legacySelectGroupKey =
      legacySelectNums.length > 1
        ? `${legacySelectNums[0]}-${legacySelectNums[legacySelectNums.length - 1]}`
        : null;
    for (const el of legacySelects) {
      const num = Number.parseInt($(el).attr("data-question") ?? "", 10);
      if (!Number.isFinite(num) || hasQuestion(num)) continue;
      const row = $(el).closest("div");
      const clone = (row.length ? row : $(el).parent()).clone();
      clone.find("select").remove();
      const prompt = clone
        .text()
        .replace(/\s+/g, " ")
        .replace(new RegExp(`^${num}\\s*`), "")
        .trim();
      const options: ParsedOption[] = $(el)
        .find("option[value]")
        .toArray()
        .map((opt) => ({
          value: $(opt).attr("value") ?? "",
          label: $(opt).text().replace(/\s+/g, " ").trim(),
        }))
        .filter((opt) => opt.value !== "");
      questions.push(
        mk(num, part, "matching_features", prompt, options, legacySelectGroupKey, key),
      );
    }

    // 4) matching (chip-bank letters dropped into .dropzone[data-q] rows)
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
      questions.push(mk(num, part, "matching_features", prompt, chips, groupKey, key));
    }

    // Map/plan labelling rendered as letter selects in a map table.
    const mapSelects = $sec.find("select.map-select[data-q]").toArray();
    const mapSelectNums = mapSelects
      .map((el) => Number.parseInt($(el).attr("data-q") ?? "", 10))
      .filter((n) => Number.isFinite(n));
    const mapSelectGroupKey =
      mapSelectNums.length > 1
        ? `${mapSelectNums[0]}-${mapSelectNums[mapSelectNums.length - 1]}`
        : null;
    for (const el of mapSelects) {
      const num = Number.parseInt($(el).attr("data-q") ?? "", 10);
      if (!Number.isFinite(num) || hasQuestion(num)) continue;
      const labelCell = $(el).closest("tr").find("td").first().clone();
      labelCell.find(".qnum").remove();
      const prompt = labelCell.text().replace(/\s+/g, " ").trim();
      const options: ParsedOption[] = $(el)
        .find("option[value]")
        .toArray()
        .map((opt) => ({
          value: $(opt).attr("value") ?? "",
          label: $(opt).text().replace(/\s+/g, " ").trim(),
        }))
        .filter((opt) => opt.value !== "");
      questions.push(
        mk(num, part, "map_labelling", prompt, options, mapSelectGroupKey, key),
      );
    }

    // 5) map/plan labelling: place chips are dropped onto lettered zones.
    const mapOptions: ParsedOption[] = $sec
      .find(".map-dz[data-letter]")
      .toArray()
      .map((z) => {
        const value = $(z).attr("data-letter") ?? "";
        return {
          value,
          label: $(z).attr("aria-label") ?? value,
        };
      });
    const placeChips = $sec.find(".place-chip[data-q]").toArray();
    const mapGroupKey =
      placeChips.length > 1
        ? `${$(placeChips[0]).attr("data-q")}-${$(
            placeChips[placeChips.length - 1],
          ).attr("data-q")}`
        : null;
    for (const chip of placeChips) {
      const num = Number.parseInt($(chip).attr("data-q") ?? "", 10);
      if (!Number.isFinite(num)) continue;
      const clone = $(chip).clone();
      clone.find(".pc-num").remove();
      const prompt =
        clone.find(".pc-text").text().replace(/\s+/g, " ").trim() ||
        clone.text().replace(/\s+/g, " ").trim();
      questions.push(mk(num, part, "map_labelling", prompt, mapOptions, mapGroupKey, key));
    }
  }

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

  // Category by part count (BRIEF §4.8) — mirrors Reading's passage_N/full_reading
  // split (parse-test.ts detectCategory/isFullReading): a single recognized part
  // imports as part_N, unlocking the same free Basic tier Reading's single passages
  // already get (persist.ts's "category !== full_* → basic" rule does the tier work,
  // untouched here); 2+ parts stays the paid full_listening mock, same as before.
  // `malformed` (resolvePartSections — missing/invalid/duplicate part numbers)
  // always wins: a file we can't cleanly count the parts of must never be sold
  // as a falsely-unlocked Basic part_N.
  const category = malformed ? "full_listening" : detectListeningCategory(passages.map((p) => p.order));

  // band(r) only matters for the Full 40Q mock (BRIEF §4.4 — band lives on the
  // full test, not per-part); mirrors passage_N never carrying a band scale either.
  // Extracted here (not up front) because it depends on `category`, which itself
  // depends on how many parts were actually recognized above.
  let bandScale: Record<string, number> | null = null;
  if (category === "full_listening") {
    const raw =
      (await extractFunctionTable(scriptBlocks, "band", 0, 40)) ??
      (await extractFunctionTable(scriptBlocks, "calculateIELTSScore", 0, 40));
    if (!raw) warnings.push("band(r) function not found — no band scale.");
    bandScale = raw ? Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v])) : null;
  }

  return {
    title,
    section: "listening",
    category,
    bandType: "listening",
    durationSeconds: null,
    questionTypes,
    bandScale,
    passages,
    questions,
    warnings,
  };
}

/**
 * Category by part count — mirrors Reading's passage_N/full_reading split
 * (parse-test.ts detectCategory/isFullReading, BRIEF §4.8). Only called when
 * `resolvePartSections` found the file clean (every part number valid, 1-4,
 * unique) — anything it couldn't cleanly count is routed to full_listening
 * before this runs, so the only remaining question is how many clean parts
 * there were: exactly one → part_N, anything else (0 or 2+) → the paid mock.
 */
function detectListeningCategory(partNumbers: number[]): string {
  return partNumbers.length === 1 ? `part_${partNumbers[0]}` : "full_listening";
}

/** Strict part-number token — a bare 1-4 digit. Anything else (missing attr,
 *  "2foo", "7", "NaN", empty) is not trusted as a real part boundary. */
const PART_NUMBER_RE = /^[1-4]$/;

/**
 * Resolves each `.part`-like section to a stable, unique `order` BEFORE the main
 * extraction loop runs, and flags the whole file `malformed` if that can't be
 * done cleanly. Two failure modes found in review (2026-07-17), both now
 * fail-safe to full_listening instead of a silent partial import:
 *
 *  - a section has no valid data-part (missing, non-numeric, or outside 1-4).
 *    Previously the section was matched by `.part[data-part]` at all only if
 *    EVERY `.part` happened to carry the attribute — one tagged `.part[data-
 *    part="1"]` plus one bare `.part` sibling made the selector see only the
 *    first, silently dropping the second block's questions AND still reporting
 *    category part_1 (a real revenue-tier bug, not just a cosmetic one, once
 *    part count started deciding the category).
 *  - two sections share the same valid number — passage `order` would collide,
 *    and persist.ts's passageIdByOrder (a plain Map) keeps only the LAST
 *    insert, so every question from the earlier section silently rebinds to
 *    the later passage row.
 *
 * A synthetic `order` (>=1000, never collides with a real 1-4) keeps every
 * section's questions extracted and linked to SOME real passage row — no
 * question is ever dropped — while `malformed` forces the safe category
 * regardless of how many valid numbers were also found alongside the bad one.
 */
function resolvePartSections($: CheerioAPI, warnings: string[]) {
  const modern = $(".part").toArray();
  const nodes = modern.length > 0 ? modern : $(".part-content[id^='part']").toArray();

  const seenValid = new Set<number>();
  let malformed = false;
  let nextSynthetic = 1000;
  const parts = nodes.map((el, i) => {
    const $sec = $(el);
    const token = ($sec.attr("data-part") ?? ($sec.attr("id") ?? "").replace(/\D+/g, "")).trim();
    if (PART_NUMBER_RE.test(token)) {
      const n = Number(token);
      if (!seenValid.has(n)) {
        seenValid.add(n);
        return { el, order: n, valid: true };
      }
      warnings.push(
        `Duplicate part number ${n} (section #${i + 1}) — defaulted to full_listening, questions kept.`,
      );
    } else {
      warnings.push(
        `Part section #${i + 1} has no valid part number (data-part must be 1-4) — ` +
          `defaulted to full_listening, questions kept.`,
      );
    }
    malformed = true;
    return { el, order: nextSynthetic++, valid: false };
  });
  return { parts, malformed };
}

/** Build a ParsedQuestion with its answer routed from KEY (variants). */
function mk(
  number: number,
  passageOrder: number,
  qtype: string,
  promptHtml: string,
  options: ParsedOption[] | null,
  groupKey: string | null,
  key: Record<string, string[]>,
): ParsedQuestion {
  return {
    number,
    passageOrder,
    qtype,
    promptHtml,
    options,
    groupKey,
    evidenceRef: null,
    answer: toAnswer(key[String(number)]),
  };
}

function normalizeKey(raw: Record<string, string | string[]>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(raw)) {
    out[key] = Array.isArray(value) ? value.map(String) : [String(value)];
  }
  return out;
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
