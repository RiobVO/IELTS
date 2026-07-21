// Typed output of the deterministic HTML import parser (BRIEF §4.2 / §4.2.1).
// The parser is pure (HTML string -> ParsedTest); persistence maps this onto the
// content_item / passage / question / answer_key tables separately.

export type AnswerMode = "mcq_set" | "text_accept" | "exact";

export interface ParsedAnswerKey {
  mode: AnswerMode;
  /** letters (mcq), acceptable text variants, or [the exact value] */
  accept: string[];
  explanation: string | null;
  evidence: { para: string; snippet: string } | null;
}

export interface ParsedOption {
  value: string;
  label: string;
}

export interface ParsedQuestion {
  number: number;
  /** canon question_type enum value (e.g. "tfng", "note_completion") */
  qtype: string;
  promptHtml: string;
  /** fixed options for tfng/ynng/mcq/matching; null for completion blanks */
  options: ParsedOption[] | null;
  /** e.g. "1-7" / "8-13" — groups questions that share a stem/rubric */
  groupKey: string | null;
  /** paragraph id the answer is evidenced in (e.g. "para-1") */
  evidenceRef: string | null;
  answer: ParsedAnswerKey;
}

export interface ParsedPassage {
  order: number;
  title: string | null;
  bodyHtml: string;
  audioPath: string | null;
}

export interface ParsedTest {
  title: string;
  section: "reading" | "listening";
  /** content_category enum value (e.g. "passage_1", "full_reading") */
  category: string;
  /** band_type enum value */
  bandType: string;
  durationSeconds: number | null;
  /** canon question_type enum values present, deduped (fills the catalog filter) */
  questionTypes: string[];
  /** raw->band scale {raw: band} for Full tests (40Q); null for single passage/part (§11). */
  bandScale: Record<string, number> | null;
  passages: ParsedPassage[];
  questions: ParsedQuestion[];
  /** low-confidence spots for the admin review screen (BRIEF §4.2.1) */
  warnings: string[];
}
