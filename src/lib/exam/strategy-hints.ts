/**
 * Strategy hints (P2b) — сжатые стратегические подсказки под каждый каноничный тип
 * вопроса. Чисто справочный контент practice-режима: зависит ТОЛЬКО от qtype (zero-key,
 * никогда не касается answer_key/ответа/грейдинга). Английский by design (IELTS —
 * англоязычный экзамен); держим буллеты короткими и техничными.
 *
 * Покрыты все 17 слагов canon-enum question_type (src/db/schema.ts). Незнакомый тип →
 * пустой массив (буллеты не показываем) — best-effort, как у остальных practice-подсказок.
 */
export const STRATEGY_HINTS: Record<string, string[]> = {
  tfng: [
    "Scan for the keyword, then read only the sentence around it — answers follow the passage order.",
    "False means the text states the opposite; Not Given means it simply isn't mentioned — never use outside knowledge.",
    "If you find no evidence either way, it's Not Given, not False.",
  ],
  ynng: [
    "These track the writer's views and claims, not plain facts — look for what the author believes or argues.",
    "No means the writer's opinion contradicts the statement; Not Given means their view isn't expressed.",
    "Watch words like 'all', 'always', 'only' — a single one can turn a Yes into a No.",
  ],
  mcq_single: [
    "Read the question stem first and predict the answer before you look at the options.",
    "Eliminate options that are true but don't answer the question, or that overstate the text.",
    "Distractors reuse words from the passage — match the meaning, not the vocabulary.",
  ],
  mcq_multi: [
    "Check exactly how many options to choose and select that many — no more, no fewer.",
    "Judge each option on its own against the text before comparing them.",
    "Distractors echo passage wording but distort the meaning — verify every one in the text.",
  ],
  matching_headings: [
    "A heading captures the paragraph's main idea, not a small detail it happens to mention.",
    "Read the first and last sentences of each paragraph first — the topic usually sits there.",
    "Do the clearest paragraphs first and cross off used headings to narrow the rest.",
  ],
  matching_info: [
    "These are not in passage order — you may have to scan the whole text for each one.",
    "Look for specific information (an example, reason, or definition), not the general topic.",
    "One paragraph can hold several answers, and some paragraphs none.",
  ],
  matching_features: [
    "Skim first and mark where each feature (a name, place, or category) is discussed.",
    "A feature can be used more than once or not at all — read the instructions.",
    "Match on meaning: the statement paraphrases the text, it won't repeat it word for word.",
  ],
  matching_sentence_endings: [
    "Read each sentence start and predict its meaning before scanning the endings.",
    "There are more endings than you need — both grammar and sense must fit.",
    "Answers follow the passage order, so locate the relevant part of the text for each start.",
  ],
  sentence_completion: [
    "Copy words exactly from the passage and stay within the word limit.",
    "Predict the part of speech and meaning the gap needs before you search.",
    "The sentence paraphrases the text — find the idea, then lift the exact word(s).",
  ],
  summary_completion: [
    "Read the whole summary first for the gist and to see what each gap needs.",
    "Decide the word type (noun, verb, adjective) each gap requires before filling it.",
    "If words come from a box, some are extra; if from the text, copy them exactly within the limit.",
  ],
  note_completion: [
    "Use the headings and layout of the notes to predict what each gap is about.",
    "Answers usually appear in order — follow along as you read or listen.",
    "Keep to the word limit and copy spelling exactly; a misspelt word is marked wrong.",
  ],
  flowchart_completion: [
    "Follow the arrows — the steps run in sequence, so answers come in order.",
    "Predict each missing step from the ones around it before searching.",
    "Respect the word limit and copy terms exactly from the source.",
  ],
  table_completion: [
    "Read the row and column labels to know exactly what each cell needs.",
    "Work across or down consistently — answers follow the source's order.",
    "Copy words exactly and stay within the stated word limit.",
  ],
  diagram_label: [
    "Orient yourself with the labels already given, then find the described parts in the text.",
    "Match on function or position — the text says what each part does or where it sits.",
    "Use only words from the passage and keep within the word limit.",
  ],
  map_labelling: [
    "Fix your position using a labelled landmark, then track directions (left, north, opposite).",
    "Follow the route or description step by step as it is given.",
    "Answers are usually the letters or names provided — check the instructions.",
  ],
  form_completion: [
    "Predict what each gap needs — a name, number, date, or address.",
    "Listen or read for spelled-out names and repeated or corrected numbers.",
    "Write exactly what you hear within the word limit, and check the spelling of names.",
  ],
  short_answer: [
    "Answer only what is asked and stay within the word limit.",
    "Lift the exact words from the text — you don't need full sentences.",
    "Questions follow the passage order, so answers appear roughly in sequence.",
  ],
};

/** Буллеты стратегии для типа вопроса; неизвестный тип → пустой массив. */
export function strategyHints(qtype: string): string[] {
  return STRATEGY_HINTS[qtype] ?? [];
}
