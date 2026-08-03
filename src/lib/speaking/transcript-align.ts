/**
 * Sentence-level sync timings for the karaoke transcript (#3). De-risked split of
 * responsibilities (memory: gemini-audio-timestamps-unreliable / speaking-audio-derisk):
 *
 *  - Gemini owns the VERBATIM transcript — the source of truth for scoring + the words we
 *    show (with the candidate's real errors/fillers). Its audio timestamps overshoot the
 *    clip length, so we never use them for sync.
 *  - Whisper owns ONLY the timings (verbose_json word timestamps — proven accurate +
 *    monotonic in scripts/_whisper_probe.ts). It "cleans" speech (e.g. "languages" for the
 *    candidate's "language"), so its TEXT is never shown — only the clocks are borrowed.
 *
 * This module glues the two at the SENTENCE level (more robust than word-level: a single
 * dropped/cleaned word can't desync a whole sentence). For each Gemini sentence we find the
 * Whisper word whose normalised form matches the sentence's first word, walking a forward
 * pointer so repeats resolve in order; the matched word's `start` becomes the sentence's
 * `startSec`. No match → positional proportion. Times are clamped monotonic and ≤ duration.
 *
 * Pure + deterministic (no env, no I/O) so the alignment is unit-testable in isolation.
 */

export interface WhisperWord {
  word: string;
  start: number;
  end: number;
}

export interface TranscriptTiming {
  /** Verbatim sentence text from the Gemini transcript (shown to the user). */
  text: string;
  /** Audio offset (seconds) where this sentence begins — for highlight + click-to-seek. */
  startSec: number;
}

/** Lowercase, strip everything but [a-z0-9] so "I'd," ≈ Whisper's "I'd" → "id". */
const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

interface Sentence {
  text: string;
  firstToken: string | null;
  /** Index of this sentence's first word within the whole transcript (for the fallback). */
  globalWordIndex: number;
}

/** Split into sentences, keeping each chunk's verbatim text (incl. its terminator + spacing). */
function splitSentences(transcript: string): { sentences: Sentence[]; totalWords: number } {
  const chunks = transcript.match(/[^.!?]+[.!?]*/g) ?? [];
  const sentences: Sentence[] = [];
  let globalWordIndex = 0;
  for (const chunk of chunks) {
    if (!chunk.trim()) continue;
    const tokens = chunk.toLowerCase().match(/[a-z0-9]+/g) ?? [];
    sentences.push({ text: chunk, firstToken: tokens[0] ?? null, globalWordIndex });
    globalWordIndex += tokens.length;
  }
  return { sentences, totalWords: globalWordIndex };
}

export function alignTranscriptTimings(
  transcript: string,
  words: WhisperWord[],
  durationSec: number,
): TranscriptTiming[] {
  if (!transcript.trim()) return [];
  const { sentences, totalWords } = splitSentences(transcript);
  if (sentences.length === 0) return [];
  if (words.length === 0) return []; // nothing to anchor on → no sync (static transcript)

  const lastEnd = words[words.length - 1].end;
  const upper = durationSec > 0 ? durationSec : lastEnd;

  const result: TranscriptTiming[] = [];
  let ptr = 0; // forward-only pointer into the Whisper stream
  let prev = 0; // previous sentence start, for the monotonic clamp
  for (const s of sentences) {
    let startSec = prev;
    let matched = false;
    if (s.firstToken) {
      for (let j = ptr; j < words.length; j++) {
        if (norm(words[j].word) === s.firstToken) {
          startSec = words[j].start;
          ptr = j + 1;
          matched = true;
          break;
        }
      }
    }
    if (!matched && totalWords > 0) {
      startSec = (s.globalWordIndex / totalWords) * upper;
    }
    startSec = Math.min(Math.max(startSec, prev), upper); // monotonic, within duration
    result.push({ text: s.text, startSec: Math.round(startSec * 1000) / 1000 });
    prev = startSec;
  }
  return result;
}
