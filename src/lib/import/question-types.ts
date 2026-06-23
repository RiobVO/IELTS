// Canonical question-type registry + label normalization (BRIEF §4.2).
// Source files use inconsistent labels ("TRUE / FALSE / NOT GIVEN" vs
// "True/False/Not Given"); we normalize and map to the fixed canon enum.

export const QUESTION_TYPES = [
  "tfng",
  "ynng",
  "mcq_single",
  "mcq_multi",
  "matching_headings",
  "matching_info",
  "matching_features",
  "matching_sentence_endings",
  "sentence_completion",
  "summary_completion",
  "note_completion",
  "flowchart_completion",
  "table_completion",
  "diagram_label",
  "map_labelling",
  "form_completion",
  "short_answer",
] as const;

export type QuestionType = (typeof QUESTION_TYPES)[number];

// normalize: lowercase, keep letters only ("TRUE / FALSE / NOT GIVEN" -> "truefalsenotgiven")
const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

// exact normalized label -> canon
const EXACT: Record<string, QuestionType> = {
  truefalsenotgiven: "tfng",
  tfng: "tfng",
  yesnonotgiven: "ynng",
  ynng: "ynng",
  multiplechoice: "mcq_single",
  multiplechoicesingle: "mcq_single",
  multiplechoicemultiple: "mcq_multi",
  matchingheadings: "matching_headings",
  matchinginformation: "matching_info",
  matchingfeatures: "matching_features",
  matchingsentenceendings: "matching_sentence_endings",
  sentencecompletion: "sentence_completion",
  summarycompletion: "summary_completion",
  notecompletion: "note_completion",
  notescompletion: "note_completion",
  classification: "matching_features",
  flowchartcompletion: "flowchart_completion",
  flowchartcompletion2: "flowchart_completion",
  tablecompletion: "table_completion",
  diagramlabelcompletion: "diagram_label",
  diagramlabelling: "diagram_label",
  diagramlabel: "diagram_label",
  planmapdiagramlabelling: "map_labelling",
  maplabelling: "map_labelling",
  mapplanlabelling: "map_labelling",
  planmaplabelling: "map_labelling",
  formcompletion: "form_completion",
  shortanswer: "short_answer",
  shortanswerquestions: "short_answer",
};

// ordered substring fallbacks (most specific first) for fuzzy labels
const CONTAINS: [string, QuestionType][] = [
  ["truefalsenotgiven", "tfng"],
  ["yesnonotgiven", "ynng"],
  ["matchingheadings", "matching_headings"],
  ["matchinginformation", "matching_info"],
  ["matchingfeatures", "matching_features"],
  ["matchingsentenceendings", "matching_sentence_endings"],
  ["sentenceendings", "matching_sentence_endings"],
  ["planmapdiagram", "map_labelling"],
  ["maplabelling", "map_labelling"],
  ["diagramlabel", "diagram_label"],
  ["flowchart", "flowchart_completion"],
  ["tablecompletion", "table_completion"],
  ["formcompletion", "form_completion"],
  ["notecompletion", "note_completion"],
  ["summarycompletion", "summary_completion"],
  ["sentencecompletion", "sentence_completion"],
  ["multiplechoice", "mcq_single"],
  ["shortanswer", "short_answer"],
  ["matching", "matching_info"],
];

export interface CanonResult {
  type: QuestionType | null;
  confident: boolean;
}

/** Map a raw label to the canon enum. confident=false => flag for admin review. */
export function canonQuestionType(label: string): CanonResult {
  const key = norm(label);
  if (!key) return { type: null, confident: false };
  if (EXACT[key]) return { type: EXACT[key], confident: true };
  for (const [needle, type] of CONTAINS) {
    if (key.includes(needle)) return { type, confident: false };
  }
  return { type: null, confident: false };
}
