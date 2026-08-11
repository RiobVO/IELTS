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
 * (matching), .mcq.multi[data-qs] (choose-TWO/THREE), and .place-chip[data-q]
 * (map labelling). There is no questionTypes object: the type is inferred from
 * each part's .q-instruction, exactly as a human reads it.
 */
export function parseListening(html: string): ParsedTest {
  const $ = cheerio.load(html);
  const warnings: string[] = [];

  const script = $("script")
    .toArray()
    .map((s) => $(s).html() ?? "")
    .join("\n");
  const keyRaw: Record<string, string | string[]> =
    extractData(script, "KEY") ?? {};
  const correctRaw: Record<string, string | string[]> =
    extractData(script, "correctAnswers") ?? {};
  const key =
    Object.keys(keyRaw).length > 0 ? normalizeKey(keyRaw) : normalizeKey(correctRaw);
  if (Object.keys(key).length === 0) warnings.push("KEY answer object not found.");
  const bandScale =
    extractFunctionTable(script, "band", 0, 40) ??
    extractFunctionTable(script, "calculateIELTSScore", 0, 40);
  if (!bandScale) warnings.push("band(r) function not found — no band scale.");

  const title =
    $("title")
      .text()
      .replace(/\s*[-–|].*$/, "")
      .trim() || "IELTS Listening";
  const audioSrc = $("audio").attr("src") ?? $("audio source").attr("src") ?? null;
  if (!audioSrc) warnings.push("No <audio> source found.");

  const passages: ParsedPassage[] = [];
  const questions: ParsedQuestion[] = [];

  const partSections =
    $(".part[data-part]").length > 0
      ? $(".part[data-part]").toArray()
      : $(".part-content[id^='part']").toArray();

  for (const sec of partSections) {
    const $sec = $(sec);
    const part = Number.parseInt(
      $sec.attr("data-part") ?? ($sec.attr("id") ?? "").replace(/\D+/g, ""),
      10,
    );
    if (!Number.isFinite(part)) continue;
    const hasQuestion = (num: number): boolean =>
      questions.some((q) => q.number === num);

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
