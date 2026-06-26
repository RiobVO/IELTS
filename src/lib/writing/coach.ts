import { TASK2_MIN_WORDS } from "./lifecycle";

// Live "coach tip" — one contextual nudge chosen deterministically from the draft.
// Lightweight UI flavour, NOT IELTS grading: it never produces a band or a score,
// only points at which criterion the tip helps. Real evaluation stays behind the
// paid "Get my feedback" flow.

export type NudgeId = "empty" | "build" | "breakup" | "lexis" | "almost" | "ready";
export type NudgeTone = "purple" | "amber" | "green";
export type NudgeCriterion = "Task Response" | "Coherence" | "Lexical" | "Grammar";

export interface Nudge {
  id: NudgeId;
  icon: string;
  title: string;
  body: string;
  criterion: NudgeCriterion;
  tone: NudgeTone;
}

// Coach-only heuristics (UI cues, not grading rules). The 250-word floor is the
// single source of truth (TASK2_MIN_WORDS); these two are local to the coach.
const BUILD_MIN_WORDS = 80; // under this the essay is still a stub
const LEXIS_MIN_RATIO = 0.45; // below this the vocabulary reads repetitive

// Copy uses typographic apostrophes (U+2019) per the handoff spec.
const NUDGES: Record<NudgeId, Nudge> = {
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

/**
 * Pick ONE coaching nudge from the live essay draft. Pure and deterministic — no
 * LLM, no network. Metrics mirror the handoff spec; states are evaluated in order
 * and the first match wins.
 */
export function nextNudge(text: string): Nudge {
  const trimmed = text.trim();
  const wordArr = trimmed ? trimmed.split(/\s+/) : [];
  const words = wordArr.length;
  const paragraphs = trimmed ? trimmed.split(/\n\s*\n/).filter((p) => p.trim()).length : 0;
  const uniqueWords = new Set(wordArr.map((w) => w.toLowerCase().replace(/[^a-z]/g, ""))).size;
  const uniqueRatio = words ? uniqueWords / words : 0;

  if (!words) return NUDGES.empty;
  if (words < BUILD_MIN_WORDS) return NUDGES.build;
  if (paragraphs < 2) return NUDGES.breakup;
  if (uniqueRatio < LEXIS_MIN_RATIO) return NUDGES.lexis;
  if (words < TASK2_MIN_WORDS) return NUDGES.almost;
  return NUDGES.ready;
}
