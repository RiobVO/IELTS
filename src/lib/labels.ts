// Display labels for enum values (UI chrome only; content stays English).

export const CATEGORY_LABELS: Record<string, string> = {
  passage_1: "Passage 1",
  passage_2: "Passage 2",
  passage_3: "Passage 3",
  full_reading: "Full Reading",
  part_1: "Part 1",
  part_2: "Part 2",
  part_3: "Part 3",
  part_4: "Part 4",
  full_listening: "Full Listening",
};

export const QTYPE_LABELS: Record<string, string> = {
  tfng: "True / False / Not Given",
  ynng: "Yes / No / Not Given",
  mcq_single: "Multiple Choice",
  mcq_multi: "Multiple Choice (multi)",
  matching_headings: "Matching Headings",
  matching_info: "Matching Information",
  matching_features: "Matching Features",
  matching_sentence_endings: "Matching Sentence Endings",
  sentence_completion: "Sentence Completion",
  summary_completion: "Summary Completion",
  note_completion: "Note Completion",
  flowchart_completion: "Flow-chart Completion",
  table_completion: "Table Completion",
  diagram_label: "Diagram Labelling",
  map_labelling: "Map Labelling",
  form_completion: "Form Completion",
  short_answer: "Short Answer",
};

export const READING_CATEGORIES = [
  "passage_1",
  "passage_2",
  "passage_3",
  "full_reading",
] as const;

export const PERIOD_LABELS: Record<string, string> = {
  weekly: "Эта неделя",
  monthly: "Этот месяц",
  all_time: "За всё время",
};

export function qtypeLabel(v: string): string {
  return QTYPE_LABELS[v] ?? v;
}
export function categoryLabel(v: string): string {
  return CATEGORY_LABELS[v] ?? v;
}
export function periodLabel(v: string): string {
  return PERIOD_LABELS[v] ?? v;
}
