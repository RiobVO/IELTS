// Catalog presentation metadata for Writing Lab prompts (migration 0025).
// Pure, dependency-free — shared by the admin form (defaults), the one-shot
// backfill, and the client catalog (labels). The topic → color/tint/icon palette
// is presentational and lives with the catalog component; here we keep only the
// value sets, the auto-detectors, and the human labels.

export const WRITING_TOPICS = [
  "society",
  "environment",
  "crime",
  "technology",
  "food",
  "culture",
] as const;
export type WritingTopic = (typeof WRITING_TOPICS)[number];

export const WRITING_TASK_TYPES = [
  "discussion",
  "agree_disagree",
  "adv_disadv",
  "two_part",
  "pos_neg",
  "opinion",
] as const;
export type WritingTaskType = (typeof WRITING_TASK_TYPES)[number];

export type WritingDifficulty = 1 | 2 | 3;

const TOPIC_SET = new Set<string>(WRITING_TOPICS);
const TASK_TYPE_SET = new Set<string>(WRITING_TASK_TYPES);

/** Narrow a raw DB/form string to a known topic, else null (UI degrades to neutral). */
export function coerceTopic(v: unknown): WritingTopic | null {
  return typeof v === "string" && TOPIC_SET.has(v) ? (v as WritingTopic) : null;
}

/** Narrow a raw DB/form string to a known task type, else null. */
export function coerceTaskType(v: unknown): WritingTaskType | null {
  return typeof v === "string" && TASK_TYPE_SET.has(v) ? (v as WritingTaskType) : null;
}

/** Narrow a raw difficulty to 1|2|3, else null. */
export function coerceDifficulty(v: unknown): WritingDifficulty | null {
  const n = typeof v === "string" ? Number(v) : v;
  return n === 1 || n === 2 || n === 3 ? (n as WritingDifficulty) : null;
}

/**
 * Best-effort task type from the prompt's phrasing. Standard IELTS Task 2 stems
 * are unambiguous; a two-part prompt is the only one carrying two questions.
 * Falls back to "opinion". Verified against the live prompt set.
 */
export function detectTaskType(prompt: string): WritingTaskType {
  const p = prompt.toLowerCase();
  if ((p.match(/\?/g)?.length ?? 0) >= 2) return "two_part";
  if (/discuss both views/.test(p)) return "discussion";
  if (/outweigh|advantages?\s+(and|or)\s+disadvantages?/.test(p)) return "adv_disadv";
  if (/positive or (a )?negative/.test(p)) return "pos_neg";
  if (/to what extent do you agree|agree or disagree/.test(p)) return "agree_disagree";
  return "opinion";
}

/**
 * Best-effort topic from the prompt's subject keywords, in priority order so the
 * more specific bucket wins (e.g. "food packaging" is waste → environment, while
 * "fast food" is food). "society" is the catch-all for general/abstract prompts.
 */
export function detectTopic(prompt: string): WritingTopic {
  const p = prompt.toLowerCase();
  if (/\bcrim(e|es|inal)\b|\bpunish|\boffenc?e/.test(p)) return "crime";
  if (/fast food|junk food|traditional foods?|\bcuisine\b|\bdiet\b|\bmeals?\b|eating habits/.test(p)) return "food";
  if (/technolog|internet|\bcomputers?\b|digital|\bonline\b|smartphones?|social media|\brobots?\b/.test(p)) return "technology";
  if (/\bwaste\b|polluti|\bplanet\b|\bclimate\b|environment|\boutdoor\b|recycl|emission|\burban\b|public transport|\bcities\b|natural resource/.test(p)) return "environment";
  if (/\bcultures?\b|multinational|globali|\bheritage\b|\btraditions?\b/.test(p)) return "culture";
  return "society";
}

export const writingTopicLabel: Record<WritingTopic, string> = {
  society: "Society",
  environment: "Environment",
  crime: "Crime",
  technology: "Technology",
  food: "Food",
  culture: "Culture",
};

export const writingTaskTypeLabel: Record<WritingTaskType, string> = {
  discussion: "Discussion",
  agree_disagree: "Agree / Disagree",
  adv_disadv: "Adv. / Disadv.",
  two_part: "Two-part question",
  pos_neg: "Positive / Negative",
  opinion: "Opinion",
};

export const writingDifficultyLabel: Record<WritingDifficulty, string> = {
  1: "Foundation",
  2: "Core",
  3: "Stretch",
};
