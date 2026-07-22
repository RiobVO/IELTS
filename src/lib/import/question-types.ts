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

// Срезает декорации, из-за которых голый тип не совпадает с EXACT-таблицей целиком:
//  - ведущий секционный префикс: «Section 2 — Note Completion» → «Note Completion»,
//    а также listening-форма «Part 3 — Matching» → «Matching» (клиент нумерует части
//    именно как Part, не Section);
//  - хвостовой скобочный квалификатор: «Note Completion (ONE WORD ONLY)» → «Note Completion»
// Работает по СЫРОЙ строке (до norm), т.к. norm уже съедает скобки/тире и границу теряет.
// Применяется ТОЛЬКО как retry после промаха полного EXACT — семантичные суффиксы вроде
// «(single)»/«(multiple)» матчатся полной формой раньше и до strip не доходят.
const stripDecorations = (s: string) =>
  s
    .replace(/^\s*(section|part)\s+\d+\s*[—–:-]?\s*/i, "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim();

// exact normalized label -> canon
const EXACT: Record<string, QuestionType> = {
  truefalsenotgiven: "tfng",
  tfng: "tfng",
  yesnonotgiven: "ynng",
  ynng: "ynng",
  multiplechoice: "mcq_single",
  mcq: "mcq_single",
  multiplechoicesingle: "mcq_single",
  multiplechoicemultiple: "mcq_multi",
  matchingheadings: "matching_headings",
  matchinginformation: "matching_info",
  matchingfeatures: "matching_features",
  matchingsentenceendings: "matching_sentence_endings",
  sentenceendings: "matching_sentence_endings",
  sentencecompletion: "sentence_completion",
  summarycompletion: "summary_completion",
  notecompletion: "note_completion",
  notescompletion: "note_completion",
  classification: "matching_features",
  // «Match each statement with the correct researcher, A-E» — сопоставление людей
  // с утверждениями = features; generic CONTAINS "matching" уводил бы в matching_info.
  matchingresearcher: "matching_features",
  // «Matching People» (Inspera-канон клиента) — та же семантика, что matchingresearcher:
  // люди↔утверждения = features; generic CONTAINS "matching" уводил в matching_info.
  matchingpeople: "matching_features",
  // «Matching Paragraph(s)» — «какой абзац содержит информацию» = matching_info; до этого
  // падал в тот же generic-фоллбэк low-confidence и шумел на ревью-экране.
  matchingparagraph: "matching_info",
  matchingparagraphs: "matching_info",
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

export type QuestionTypeSection = "reading" | "listening";

/** Map a raw label to the canon enum. confident=false => flag for admin review.
 *  section по умолчанию "reading" — байт-в-байт прежнее поведение вызывающих без аргумента. */
export function canonQuestionType(
  label: string,
  section: QuestionTypeSection = "reading",
): CanonResult {
  const key = norm(label);
  if (!key) return { type: null, confident: false };
  if (EXACT[key]) return { type: EXACT[key], confident: true };
  // Retry EXACT по строке без секц-префикса/скобочного хвоста: «Section 2 — Note
  // Completion» и «Note Completion (ONE WORD ONLY)» — тот же уверенный note_completion,
  // а не low-confidence шум на ревью-экране. Полный EXACT выше уже отсёк семантичные
  // суффиксы (single)/(multiple), поэтому здесь strip их не искажает.
  const stripped = norm(stripDecorations(label));
  if (stripped !== key && EXACT[stripped]) return { type: EXACT[stripped], confident: true };
  // Listening-only: голое «Matching» (и его декорированные варианты после strip) — это
  // стандартный официальный тип, а атом-парсер (parse-listening.ts) для тех же вопросов
  // структурно даёт matching_features. В reading тот же голый ярлык осознанно остаётся
  // low-confidence через CONTAINS ниже — там matching многозначен (headings/info/features).
  if (section === "listening" && (key === "matching" || stripped === "matching")) {
    return { type: "matching_features", confident: true };
  }
  for (const [needle, type] of CONTAINS) {
    if (key.includes(needle)) return { type, confident: false };
  }
  return { type: null, confident: false };
}

// Вариант B — детект ярлыка choose-TWO/THREE для review-сигнала (не меняет qtype-выход).
// Матчит СОСТАВНОЙ префикс `multiplechoice` + `two`/`three` в norm-строке, а НЕ голый
// "two"/"three": иначе "Note completion (two words)" (norm "notecompletiontwowords") ложно
// попал бы в multi-select. norm выкидывает всё, кроме букв, поэтому "Multiple Choice (TWO
// answers)" → "multiplechoicetwoanswers" содержит "multiplechoicetwo". canonQuestionType
// по-прежнему возвращает mcq_single для таких ярлыков — это лишь флаг на ревью-экран, что
// authoring-спека требует mcqGroups-диапазон для choose-TWO/THREE.
export function isChooseManyLabel(label: string): boolean {
  const key = norm(label);
  return key.includes("multiplechoicetwo") || key.includes("multiplechoicethree");
}

// A source label that maps to no canon type falls back to short_answer. grade.ts routes
// by answer-key mode, not qtype, so grading is unaffected — but the fallback hides a
// genuinely unsupported type. The parser records it as a warning; the publish gate (#13)
// reads it back to refuse publishing until an admin resolves it. Generator and detector
// share one marker so the warning text and the gate can never drift apart.
export const UNKNOWN_TYPE_FALLBACK: QuestionType = "short_answer";
// Marker = the fallback suffix, not "unknown type": the raw source label rides inside the
// warning (via JSON.stringify), so a label that itself contains "unknown type" would trip a
// bare-substring detector — and a low-confidence warning for such a label (ends "→ <type>",
// never "fell back to") would falsely block a valid publish. Keying off the suffix the
// generator alone emits removes that false barrier.
const UNKNOWN_TYPE_MARK = "→ fell back to";

export function unknownTypeWarning(n: number, rawLabel: string): string {
  // Кап на label: warning оседает в import_warnings и уходит в Telegram-сообщение —
  // мусорный мегабайтный ярлык не должен раздувать ни БД, ни ответ бота (лимит 4096).
  const label = rawLabel.length > 120 ? `${rawLabel.slice(0, 120)}…` : rawLabel;
  return `Q${n}: unknown type ${JSON.stringify(label)} ${UNKNOWN_TYPE_MARK} ${UNKNOWN_TYPE_FALLBACK}`;
}

// Источник вовсе не указал тип (пустой/whitespace label) — отдельный от unknownTypeWarning
// envelope (не несёт UNKNOWN_TYPE_MARK, поэтому FALLBACK_ENVELOPE его не ловит), но с
// QTYPE hard-block (docs/authoring-spec.md, 2026-07-11) публикация блокируется наравне с
// непустым нераспознанным типом — см. isUnresolvedQuestionTypeWarning ниже.
export function blankTypeWarning(n: number): string {
  return `Q${n}: no question type provided in source — publish blocked, add QTYPE and re-import`;
}

// Матчит ТОЛЬКО полный сгенерированный envelope unknownTypeWarning:
// `Q<n>: unknown type "<label>" → fell back to <fallback>`. Якоря ^…$ + точная форма (а не
// bare includes маркера) убирают два дефекта (Codex 2026-07-09): (1) ложный блок, когда маркер
// лежит ВНУТРИ label чужого low-confidence warning; (2) first-match-обход при склейке warning'ов.
// `→ fell back to` встречается лишь в хвосте envelope, поэтому greedy (.*) корректно берёт label.
// Флаг s (dotAll): JSON.stringify НЕ экранирует U+2028/U+2029, а `.` без dotAll их не матчит —
// такой label разорвал бы матч и warning проскочил бы мимо гейта (Codex 2026-07-11).
const FALLBACK_ENVELOPE = /^Q\d+: unknown type "(.*)" → fell back to \S+$/s;

// Матчит envelope blankTypeWarning по префиксу (не по хвосту — текст после "in source" не
// часть контракта), поэтому старые persisted-строки (до правки текста выше) тоже матчатся.
const BLANK_ENVELOPE = /^Q\d+: no question type provided in source/;

/**
 * QTYPE hard-block (2026-07-11, BACKLOG W2-3b): публикация блокируется, если источник не
 * указал тип вопроса (blankTypeWarning) ИЛИ указал нераспознанный (unknownTypeWarning) — с
 * принятием authoring-спеки (docs/authoring-spec.md) QTYPE обязателен для КАЖДОГО вопроса,
 * обе ветки — authoring-ошибка клиента, требующая перезаливки файла. Раньше (P1, 2026-07-09)
 * пустой label был смягчён до informational, пока спеки не было. Ловит и envelope СТАРОГО
 * формата с ПУСТЫМ label внутри unknownTypeWarning (persisted до появления blankTypeWarning) —
 * FALLBACK_ENVELOPE больше не разбирает label на пусто/непусто, любой матч envelope блокирует.
 */
export function isUnresolvedQuestionTypeWarning(w: string): boolean {
  return BLANK_ENVELOPE.test(w) || FALLBACK_ENVELOPE.test(w);
}
