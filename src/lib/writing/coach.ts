import { TASK1_MIN_WORDS, TASK2_MIN_WORDS } from "./lifecycle";

// Live "coach tip" — one contextual nudge chosen deterministically from the draft.
// Lightweight UI flavour, NOT IELTS grading: it never produces a band or a score,
// only points at which criterion the tip helps. Real evaluation stays behind the
// paid "Get my feedback" flow. Task 2 (essay) and Task 1 (chart description) have
// separate nudge sets — the advice differs (position/argument vs overview/figures).

export type NudgeId =
  | "empty" | "build" | "breakup" | "lexis" | "almost" | "ready" // Task 2
  | "t1_overview" | "t1_figures" | "t1_group" | "t1_trends" | "t1_almost" | "t1_ready"; // Task 1
export type NudgeTone = "purple" | "amber" | "green";
export type NudgeCriterion = "Task Response" | "Task Achievement" | "Coherence" | "Lexical" | "Grammar";

export interface Nudge {
  id: NudgeId;
  icon: string;
  title: string;
  body: string;
  criterion: NudgeCriterion;
  tone: NudgeTone;
}

// Coach-only heuristics (UI cues, not grading rules). The min-word floor is the
// single source of truth per part (TASK2/TASK1_MIN_WORDS); the rest are local.
const BUILD_MIN_WORDS = 80; // Task 2: under this the essay is still a stub
const T1_FIGURES_MIN_WORDS = 45; // Task 1: under this the description is barely started
const LEXIS_MIN_RATIO = 0.45; // below this the vocabulary reads repetitive

// Copy uses typographic apostrophes (U+2019) per the handoff spec.
const TASK2_NUDGES: Record<string, Nudge> = {
  empty: {
    id: "empty",
    icon: "✍️",
    title: "Open strong",
    body: "State your position in the very first sentence — examiners reward a clear stance.",
    criterion: "Task Response",
    tone: "purple",
  },
  build: {
    id: "build",
    icon: "🧱",
    title: "Build the body",
    body: "Aim for two body paragraphs, each with one reason and a concrete example.",
    criterion: "Task Response",
    tone: "purple",
  },
  breakup: {
    id: "breakup",
    icon: "↵",
    title: "Break it up",
    body: "Split your argument into paragraphs — it lifts your Coherence score fast.",
    criterion: "Coherence",
    tone: "purple",
  },
  lexis: {
    id: "lexis",
    icon: "📚",
    title: "Vary your words",
    body: "You’re repeating vocabulary. Swap common words for precise synonyms.",
    criterion: "Lexical",
    tone: "purple",
  },
  almost: {
    id: "almost",
    icon: "⏳",
    title: "Almost there",
    body: "Keep developing your examples — you’re closing in on the 250-word minimum.",
    criterion: "Task Response",
    tone: "amber",
  },
  ready: {
    id: "ready",
    icon: "🎯",
    title: "Strong draft",
    body: "Length and structure look solid. Reread once for grammar slips, then submit.",
    criterion: "Grammar",
    tone: "green",
  },
};

const TASK1_NUDGES: Record<string, Nudge> = {
  overview: {
    id: "t1_overview",
    icon: "🧭",
    title: "Start with the overview",
    body: "Open with one sentence on the overall trend or the main pattern in the visual.",
    criterion: "Task Achievement",
    tone: "purple",
  },
  figures: {
    id: "t1_figures",
    icon: "🔢",
    title: "Report the key figures",
    body: "Quote the most important numbers and units straight from the chart — accuracy is everything here.",
    criterion: "Task Achievement",
    tone: "purple",
  },
  group: {
    id: "t1_group",
    icon: "↵",
    title: "Group your detail",
    body: "Use a short overview paragraph, then group the figures logically — it lifts Coherence.",
    criterion: "Coherence",
    tone: "purple",
  },
  trends: {
    id: "t1_trends",
    icon: "📈",
    title: "Vary your trend language",
    body: "You’re repeating words. Reach for rose, fell, peaked, plateaued, doubled — and comparatives.",
    criterion: "Lexical",
    tone: "purple",
  },
  almost: {
    id: "t1_almost",
    icon: "⏳",
    title: "Almost there",
    body: "Keep reporting key features — you’re closing in on the 150-word minimum.",
    criterion: "Task Achievement",
    tone: "amber",
  },
  ready: {
    id: "t1_ready",
    icon: "🎯",
    title: "Strong description",
    body: "Length looks solid. Check every figure matches the visual, then submit.",
    criterion: "Grammar",
    tone: "green",
  },
};

interface DraftMetrics {
  words: number;
  paragraphs: number;
  uniqueRatio: number;
}

function measure(text: string): DraftMetrics {
  const trimmed = text.trim();
  const wordArr = trimmed ? trimmed.split(/\s+/) : [];
  const words = wordArr.length;
  const paragraphs = trimmed ? trimmed.split(/\n\s*\n/).filter((p) => p.trim()).length : 0;
  const uniqueWords = new Set(wordArr.map((w) => w.toLowerCase().replace(/[^a-z]/g, ""))).size;
  return { words, paragraphs, uniqueRatio: words ? uniqueWords / words : 0 };
}

/**
 * Pick ONE coaching nudge from the live draft. Pure and deterministic — no LLM, no
 * network. States are evaluated in order and the first match wins. Task 1 swaps the
 * advice (overview → figures → grouping → trend lexis → length) and its 150-word floor.
 */
export function nextNudge(text: string, taskPart: "task1" | "task2" = "task2"): Nudge {
  const { words, paragraphs, uniqueRatio } = measure(text);

  if (taskPart === "task1") {
    const N = TASK1_NUDGES;
    if (!words) return N.overview;
    if (words < T1_FIGURES_MIN_WORDS) return N.figures;
    if (paragraphs < 2) return N.group;
    if (uniqueRatio < LEXIS_MIN_RATIO) return N.trends;
    if (words < TASK1_MIN_WORDS) return N.almost;
    return N.ready;
  }

  const N = TASK2_NUDGES;
  if (!words) return N.empty;
  if (words < BUILD_MIN_WORDS) return N.build;
  if (paragraphs < 2) return N.breakup;
  if (uniqueRatio < LEXIS_MIN_RATIO) return N.lexis;
  if (words < TASK2_MIN_WORDS) return N.almost;
  return N.ready;
}
