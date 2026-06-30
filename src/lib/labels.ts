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

/**
 * Одно-фразовое объяснение каждого каноничного типа вопроса — инлайн-хелп для
 * не-носителей при выборе, что тренировать. Контент английский by design (IELTS —
 * англоязычный экзамен); держим простым и конкретным.
 */
export const QTYPE_DESCRIPTIONS: Record<string, string> = {
  tfng: "Decide if each statement agrees with the text (True), contradicts it (False), or isn't mentioned (Not Given).",
  ynng: "Decide if each statement matches the writer's views (Yes), goes against them (No), or isn't stated (Not Given).",
  mcq_single: "Pick the one correct option from a list of choices.",
  mcq_multi: "Pick several correct options from a longer list.",
  matching_headings: "Match the right heading to each paragraph or section.",
  matching_info: "Find which paragraph contains a given piece of information.",
  matching_features: "Match each statement to the right option — a person, place, or category.",
  matching_sentence_endings: "Choose the correct ending to complete each sentence.",
  sentence_completion: "Fill each gap in a sentence with words from the text.",
  summary_completion: "Complete a short summary by filling in its gaps.",
  note_completion: "Fill the gaps in a set of notes.",
  flowchart_completion: "Fill the gaps in a flow-chart of steps.",
  table_completion: "Fill the gaps in a table.",
  diagram_label: "Label the parts of a diagram with the right words.",
  map_labelling: "Label places on a map or plan.",
  form_completion: "Fill in a form with the details you read or hear.",
  short_answer: "Answer a question in a few words, within the given word limit.",
};

export const READING_CATEGORIES = [
  "passage_1",
  "passage_2",
  "passage_3",
  "full_reading",
] as const;

export const LISTENING_CATEGORIES = [
  "part_1",
  "part_2",
  "part_3",
  "part_4",
  "full_listening",
] as const;

export const PERIOD_LABELS: Record<string, string> = {
  weekly: "This week",
  monthly: "This month",
  all_time: "All time",
};

export function qtypeLabel(v: string): string {
  return QTYPE_LABELS[v] ?? v;
}
export function qtypeDescription(v: string): string {
  return QTYPE_DESCRIPTIONS[v] ?? "";
}
export function categoryLabel(v: string): string {
  return CATEGORY_LABELS[v] ?? v;
}
export function periodLabel(v: string): string {
  return PERIOD_LABELS[v] ?? v;
}
