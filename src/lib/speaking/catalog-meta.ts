// Catalog presentation metadata for Speaking Lab cue cards. Pure, dependency-free —
// mirrors writing/topic-meta.ts. `speaking_task` has NO category column, so the catalog
// derives a Part 2 bucket from the cue-card prompt at read time (best-effort, the same
// approach as writing's detectTopic fallback). The colour/glyph palette is presentational
// and lives with the catalog component; here we keep only the value set + detector + labels.

export const SPEAKING_CATEGORIES = [
  "person",
  "place",
  "object",
  "event",
  "activity",
  "media",
] as const;
export type SpeakingCategory = (typeof SPEAKING_CATEGORIES)[number];

/**
 * Best-effort Part 2 bucket from the cue-card's phrasing. IELTS Part 2 prompts read
 * "Describe a/an <subject> who/that/you …", so the SUBJECT is the signal and it lives in
 * the head clause — match there first, otherwise a trailing "…you gave to someone" would
 * mis-read an object card as a Person. Priority within a clause: media before person (a
 * *song* is media, a *singer* is person) and before object (a *book* is media, not a thing).
 * The subject is matched in the head clause ONLY — scanning the full prompt would let a
 * trailing clause ("a time when you helped someone") hijack the bucket — so a prompt whose
 * head names no subject falls to "event", the broad experiential catch-all ("a time
 * when…", "a decision you made…"), which mislabels nothing visible.
 */
export function detectCategory(prompt: string): SpeakingCategory {
  const head = prompt.toLowerCase().split(/\b(?:who|whom|that|which|you|where|when)\b|[,.]/)[0];
  return matchCategory(head) ?? "event";
}

function matchCategory(s: string): SpeakingCategory | null {
  if (/\bbooks?\b|\bnovels?\b|\bfilms?\b|\bmovies?\b|\bsongs?\b|\bmusic\b|\bwebsites?\b|\bapps?\b|\bprogram(me)?s?\b|\bmagazines?\b|\badvert|\bnews\b|\bstor(y|ies)\b|\bpodcasts?\b|\bphotograph/.test(s))
    return "media";
  if (/\bperson\b|\bsomeone\b|\bpeople\b|\bfriends?\b|\bfamily\b|\bteachers?\b|\bleaders?\b|\bchild\b|\brelatives?\b|\bneighbou?rs?\b|\bstrangers?\b|\bcolleagues?\b|\bartists?\b|\bsingers?\b|\bathletes?\b|\bcouple\b|\bboss\b|\bhero\b/.test(s))
    return "person";
  if (/\bplaces?\b|\bcit(y|ies)\b|\bcountr(y|ies)\b|\bbuildings?\b|\btowns?\b|\bareas?\b|\bparks?\b|\bgardens?\b|\brestaurants?\b|\bshops?\b|\brooms?\b|\bhouse\b|\bhome\b|\blibrar|\bmuseum|\bvillage|\bstation|\bbeach|\bstreets?\b|\bmarket/.test(s))
    return "place";
  if (/\bactivit|\bhobb|\bsports?\b|\bgames?\b|\bskills?\b|\bexercis|\bhabit|\broutine|\bcooking\b|\bdancing\b/.test(s))
    return "activity";
  if (/\bthings?\b|\bobjects?\b|\bgifts?\b|\bpresents?\b|\bpossession|\bitems?\b|\btoys?\b|\bdevice|\bgadget|\bclothing|\bpiece of\b|\bphotos?\b|\bpictures?\b|\bbought\b|\bowned?\b/.test(s))
    return "object";
  return null;
}

export const speakingCategoryLabel: Record<SpeakingCategory, string> = {
  person: "Person",
  place: "Place",
  object: "Object",
  event: "Experience",
  activity: "Activity",
  media: "Media",
};

// ---- Difficulty (0031) — same Foundation/Core/Stretch scale as Writing, human-set ----

export const SPEAKING_DIFFICULTIES = [1, 2, 3] as const;
export type SpeakingDifficulty = (typeof SPEAKING_DIFFICULTIES)[number];

export const speakingDifficultyLabel: Record<SpeakingDifficulty, string> = {
  1: "Foundation",
  2: "Core",
  3: "Stretch",
};

/** Narrow a raw DB/form value to 1|2|3, else null (catalog hides the meter). */
export function coerceDifficulty(v: unknown): SpeakingDifficulty | null {
  const n = typeof v === "string" ? Number(v) : v;
  return n === 1 || n === 2 || n === 3 ? (n as SpeakingDifficulty) : null;
}

/**
 * Implied band window per level. IELTS doesn't grade a cue card (the band depends on
 * the answer), so "on target" ties the user's target band to the cognitive demand of
 * the card: a Foundation card suits a lower target, a Stretch card a higher one. Pure;
 * the catalog highlights a card when the target sits inside its window.
 */
export const difficultyBand: Record<SpeakingDifficulty, readonly [number, number]> = {
  1: [5.0, 6.0],
  2: [6.0, 7.0],
  3: [7.0, 8.5],
};

export function isOnTarget(difficulty: SpeakingDifficulty, targetBand: number): boolean {
  const [lo, hi] = difficultyBand[difficulty];
  return targetBand >= lo && targetBand <= hi;
}
