/**
 * Детерминированный парсер словарных колод (Vocabulary, план 2026-07-06).
 *
 * Вход — ИНЕРТНЫЙ JSON (не HTML и не встроенный JS), поэтому в отличие от
 * parse-test.ts здесь НЕ нужны cheerio/node:vm/eval: только JSON.parse + ручная
 * валидация в том же духе. Модуль чистый (без БД / server-only), поэтому
 * покрывается юнит-тестами напрямую.
 *
 * Канонический формат файла:
 *   { "title", "description"?, "level"?, "tier_required"?, "question_types"?,
 *     "cards": [{ "word", "definition", "example"?, "translation"?,
 *                 "part_of_speech"?, "ipa"?, "synonyms"?, "collocations"?,
 *                 "word_family"?, "quiz_prompt"?, "accepted_answers"? }] }
 *
 * Enrichment-поля (0038) опциональны и обратносовместимы: старые файлы без них
 * парсятся как прежде (все new-поля → null).
 *
 * Инварианты: no LLM, no eval, no vm, без новых зависимостей.
 */
import { QUESTION_TYPES, type QuestionType } from "../question-types";

export type VocabTier = "basic" | "premium" | "ultra";

export interface ParsedVocabCard {
  word: string;
  definition: string;
  example: string | null;
  translation: string | null;
  partOfSpeech: string | null;
  ipa: string | null;
  // Enrichment (0038): обучающая семантика; null = поле отсутствовало в файле.
  synonyms: string[] | null;
  collocations: string[] | null;
  wordFamily: string[] | null;
  // Quiz-режим (0038): промт с маркером пропуска "___" + принимаемые ответы.
  // acceptedAnswers=null при заданном quizPrompt = fallback-ответ = само слово.
  quizPrompt: string | null;
  acceptedAnswers: string[] | null;
  /** Позиция в файле (0..n-1) — стабильный порядок показа карточек. */
  order: number;
}

export interface ParsedVocabDeck {
  title: string;
  description: string | null;
  level: string | null;
  tierRequired: VocabTier;
  // Enrichment (0038): канон-слаги типов вопросов quiz-режима; null = не заданы.
  questionTypes: QuestionType[] | null;
  cards: ParsedVocabCard[];
}

/**
 * Ошибка парсинга с человекочитаемым сообщением. Импорт запускает только
 * доверенный админ (requireAdmin / позже Telegram-whitelist), поэтому текст
 * можно показывать как есть — он адресован тому, кто загрузил файл.
 */
export class VocabParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VocabParseError";
  }
}

// Size-гейты в духе MAX_VM_INPUT (extract-js.ts): пропорциональные границы против
// OOM/DoS на импорте. Реальные колоды — сотни карточек по несколько сотен байт,
// так что лимиты с большим запасом. Гейт файла меряется в БАЙТАХ (UTF-8), а не в
// UTF-16 code units: иначе кириллица/эмодзи обходят предел ~вдвое.
export const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2 MB
export const MAX_CARDS = 1000;
const MAX_TITLE_LEN = 200;
const MAX_DESCRIPTION_LEN = 2000;
const MAX_LEVEL_LEN = 60;
const MAX_WORD_LEN = 200;
const MAX_DEFINITION_LEN = 2000;
const MAX_EXAMPLE_LEN = 2000;
const MAX_TRANSLATION_LEN = 500;
const MAX_POS_LEN = 60;
const MAX_IPA_LEN = 200;
// Enrichment (0038): лимиты в духе существующих — пропорциональные границы против
// раздувания импорта, с большим запасом относительно реальных колод.
const MAX_ENRICH_ITEMS = 20; // synonyms/collocations/word_family
const MAX_ENRICH_ITEM_LEN = 200;
const MAX_QUIZ_PROMPT_LEN = 500;
const MAX_ACCEPTED_ANSWERS = 10;
const MAX_ACCEPTED_ANSWER_LEN = 200;
const MAX_QUESTION_TYPES = 10;
/** Маркер пропуска в quiz_prompt (fill-in-the-blank): ровно три подчёркивания. */
const BLANK_MARKER = "___";

const TIERS: readonly VocabTier[] = ["basic", "premium", "ultra"];

/** Обязательная непустая строка (после trim) с ограничением длины. */
function requiredString(value: unknown, field: string, maxLen: number): string {
  if (typeof value !== "string") {
    throw new VocabParseError(`${field} is required and must be a string.`);
  }
  const trimmed = value.trim();
  if (trimmed === "") {
    throw new VocabParseError(`${field} is required and must not be empty.`);
  }
  if (trimmed.length > maxLen) {
    throw new VocabParseError(`${field} is too long (${trimmed.length} > ${maxLen}).`);
  }
  return trimmed;
}

/** Необязательная строка: absent/null/"" → null; иначе trim + лимит длины. */
function optionalString(value: unknown, field: string, maxLen: number): string | null {
  if (value == null) return null;
  if (typeof value !== "string") {
    throw new VocabParseError(`${field} must be a string when present.`);
  }
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (trimmed.length > maxLen) {
    throw new VocabParseError(`${field} is too long (${trimmed.length} > ${maxLen}).`);
  }
  return trimmed;
}

/**
 * Необязательный массив непустых строк (enrichment 0038). absent/null → null.
 * Каждый элемент — непустая строка после trim с лимитом длины (переиспользует
 * requiredString). `emptyIsError=false`: пустой массив → null (нет обогащения).
 * `emptyIsError=true`: пустой массив → ошибка — для accepted_answers, где заданный,
 * но пустой список бессмыслен (нет ключа = fallback-ответ = слово, а `[]` = опечатка).
 */
function optionalStringArray(
  value: unknown,
  field: string,
  maxItems: number,
  maxItemLen: number,
  emptyIsError = false,
): string[] | null {
  if (value == null) return null;
  if (!Array.isArray(value)) {
    throw new VocabParseError(`${field} must be an array when present.`);
  }
  if (value.length === 0) {
    if (emptyIsError) {
      throw new VocabParseError(`${field} must not be empty when present.`);
    }
    return null;
  }
  if (value.length > maxItems) {
    throw new VocabParseError(
      `${field} has too many items (${value.length} > ${maxItems}).`,
    );
  }
  return value.map((item, i) => requiredString(item, `${field}[${i}]`, maxItemLen));
}

/**
 * Короткий предпросмотр сырого значения для сообщений об ошибке. Обрезает до
 * ~80 символов: битый файл с мегабайтным значением иначе даёт мегабайтное
 * сообщение (а оно уходит в query-string redirect админки → битый Location).
 */
function preview(value: unknown, max = 80): string {
  const raw = JSON.stringify(value);
  const s = raw === undefined ? String(value) : raw;
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/**
 * tier_required — строго из user_tier enum. Отсутствует → 'basic' (DEFAULT БД).
 * `level` намеренно НЕ enum: колонка vocab_deck.level — свободный текст, поэтому
 * валидируем её лишь как строку с лимитом (не выдумываем CEFR-перечень).
 */
function parseTier(value: unknown): VocabTier {
  if (value == null) return "basic";
  if (typeof value !== "string" || !TIERS.includes(value as VocabTier)) {
    throw new VocabParseError(
      `tier_required must be one of ${TIERS.join(", ")} (got ${preview(value)}).`,
    );
  }
  return value as VocabTier;
}

/**
 * question_types (enrichment 0038) — массив КАНОН-слагов quiz-режима. absent/null
 * или пустой массив → null. Валидируем строгим членством в QUESTION_TYPES (после
 * trim, регистрозависимо): это уже канонические слаги, а не сырые лейблы, поэтому
 * fuzzy-нормализация canonQuestionType здесь не нужна — неизвестный слаг = ошибка.
 */
function parseQuestionTypes(value: unknown): QuestionType[] | null {
  if (value == null) return null;
  if (!Array.isArray(value)) {
    throw new VocabParseError("question_types must be an array when present.");
  }
  if (value.length === 0) return null;
  if (value.length > MAX_QUESTION_TYPES) {
    throw new VocabParseError(
      `question_types has too many items (${value.length} > ${MAX_QUESTION_TYPES}).`,
    );
  }
  const canon = new Set<string>(QUESTION_TYPES);
  return value.map((raw) => {
    if (typeof raw !== "string") {
      throw new VocabParseError(
        `question_types entries must be strings (got ${preview(raw)}).`,
      );
    }
    const slug = raw.trim();
    if (!canon.has(slug)) {
      throw new VocabParseError(
        `unknown question type ${preview(raw)} — must be a canon slug ` +
          `(${QUESTION_TYPES.join(", ")}).`,
      );
    }
    return slug as QuestionType;
  });
}

export function parseVocab(fileContent: string): ParsedVocabDeck {
  // Гейт размера ДО JSON.parse: разбор мегабайтной строки — сам по себе вектор DoS.
  // Меряем БАЙТЫ (UTF-8), а не .length (UTF-16 code units) — иначе многобайтовые
  // символы обходят предел вдвое. Buffer.byteLength считает без аллокации буфера.
  const byteLength = Buffer.byteLength(fileContent, "utf8");
  if (byteLength > MAX_FILE_BYTES) {
    throw new VocabParseError(`file too large (${byteLength} > ${MAX_FILE_BYTES}).`);
  }

  let root: unknown;
  try {
    root = JSON.parse(fileContent);
  } catch (e) {
    throw new VocabParseError(`invalid JSON: ${(e as Error).message}`);
  }
  if (typeof root !== "object" || root === null || Array.isArray(root)) {
    throw new VocabParseError("root must be a JSON object.");
  }
  const obj = root as Record<string, unknown>;

  const title = requiredString(obj.title, "title", MAX_TITLE_LEN);
  const description = optionalString(obj.description, "description", MAX_DESCRIPTION_LEN);
  const level = optionalString(obj.level, "level", MAX_LEVEL_LEN);
  const tierRequired = parseTier(obj.tier_required);
  const questionTypes = parseQuestionTypes(obj.question_types);

  if (!Array.isArray(obj.cards)) {
    throw new VocabParseError("cards must be an array.");
  }
  if (obj.cards.length === 0) {
    throw new VocabParseError("cards must not be empty.");
  }
  if (obj.cards.length > MAX_CARDS) {
    throw new VocabParseError(`too many cards (${obj.cards.length} > ${MAX_CARDS}).`);
  }

  const cards: ParsedVocabCard[] = [];
  // Дубль слова внутри файла (case-insensitive после trim) = ОШИБКА, а не silent-override:
  // реимпорт апсертит по (deck_id, word), поэтому две "run"/"Run" в одном файле молча
  // затёрли бы одну карточку другой — теряется детерминизм и часть контента.
  const seen = new Map<string, number>(); // нормализованное слово -> позиция карточки (1-based)
  obj.cards.forEach((raw, i) => {
    const pos = i + 1;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new VocabParseError(`card ${pos} must be an object.`);
    }
    const c = raw as Record<string, unknown>;
    const word = requiredString(c.word, `card ${pos} "word"`, MAX_WORD_LEN);
    const definition = requiredString(c.definition, `card ${pos} "definition"`, MAX_DEFINITION_LEN);

    const norm = word.toLowerCase();
    const prev = seen.get(norm);
    if (prev != null) {
      throw new VocabParseError(
        `duplicate word "${word}" (cards ${prev} and ${pos}) — ` +
          `words must be unique within a deck (case-insensitive).`,
      );
    }
    seen.set(norm, pos);

    // Quiz-режим: quiz_prompt (если задан) обязан нести маркер пропуска "___".
    // accepted_answers — заданный, но пустой массив = ошибка; отсутствие ключа при
    // наличии quiz_prompt валидно (fallback-ответ = word, разрешается на слое показа).
    const quizPrompt = optionalString(c.quiz_prompt, `card ${pos} "quiz_prompt"`, MAX_QUIZ_PROMPT_LEN);
    if (quizPrompt != null && !quizPrompt.includes(BLANK_MARKER)) {
      throw new VocabParseError(
        `card ${pos} "quiz_prompt" must contain a blank marker "${BLANK_MARKER}".`,
      );
    }

    cards.push({
      word,
      definition,
      example: optionalString(c.example, `card ${pos} "example"`, MAX_EXAMPLE_LEN),
      translation: optionalString(c.translation, `card ${pos} "translation"`, MAX_TRANSLATION_LEN),
      partOfSpeech: optionalString(c.part_of_speech, `card ${pos} "part_of_speech"`, MAX_POS_LEN),
      ipa: optionalString(c.ipa, `card ${pos} "ipa"`, MAX_IPA_LEN),
      synonyms: optionalStringArray(c.synonyms, `card ${pos} "synonyms"`, MAX_ENRICH_ITEMS, MAX_ENRICH_ITEM_LEN),
      collocations: optionalStringArray(c.collocations, `card ${pos} "collocations"`, MAX_ENRICH_ITEMS, MAX_ENRICH_ITEM_LEN),
      wordFamily: optionalStringArray(c.word_family, `card ${pos} "word_family"`, MAX_ENRICH_ITEMS, MAX_ENRICH_ITEM_LEN),
      quizPrompt,
      acceptedAnswers: optionalStringArray(
        c.accepted_answers,
        `card ${pos} "accepted_answers"`,
        MAX_ACCEPTED_ANSWERS,
        MAX_ACCEPTED_ANSWER_LEN,
        true, // заданный, но пустой массив = ошибка
      ),
      order: i,
    });
  });

  return { title, description, level, tierRequired, questionTypes, cards };
}
