/**
 * Whisper STT — TIMINGS ONLY (#3). The verbatim transcript + the band/criteria come
 * from Gemini (audio-native); this call exists solely to get accurate word timestamps
 * for the karaoke-sync, because Gemini's own timestamps overshoot the clip length
 * (memory: gemini-audio-timestamps-unreliable). De-risked against scripts/_whisper_probe.ts
 * (132.7s on a 133.3s clip, monotonic). Whisper's TEXT is discarded — it "cleans" the
 * speech, which must not leak into scoring or the user-facing transcript.
 *
 * No SDK: a plain fetch + FormData POST to the transcriptions endpoint (mirrors how the
 * Gemini evaluator avoids extra deps where it can). Absent key → null so the caller
 * degrades gracefully; a transport/HTTP error throws and the route swallows it (timings
 * are optional, they must never fail the eval).
 */
import { openaiKey } from "@/env";
import type { WhisperWord } from "./transcript-align";

const WHISPER_URL = "https://api.openai.com/v1/audio/transcriptions";

// Map the stored MIME to a filename extension Whisper accepts (it routes on the name).
const EXT_BY_MIME: Record<string, string> = {
  "audio/webm": "webm",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/mpga": "mp3",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
};

function extForMime(mimeType: string): string {
  const base = mimeType.split(";")[0].trim().toLowerCase();
  return EXT_BY_MIME[base] ?? "webm";
}

/**
 * Word-level timestamps for the recording, or null when STT is unconfigured. The audio
 * bytes are the same ones already downloaded for the Gemini call (no second Storage hit).
 */
export async function transcribeTimings(
  bytes: Buffer | Uint8Array,
  mimeType: string,
): Promise<{ words: WhisperWord[]; duration: number } | null> {
  const key = openaiKey();
  if (!key) return null;

  const ext = extForMime(mimeType);
  const fd = new FormData();
  fd.append("file", new Blob([new Uint8Array(bytes)], { type: mimeType }), `audio.${ext}`);
  fd.append("model", "whisper-1");
  fd.append("response_format", "verbose_json");
  fd.append("timestamp_granularities[]", "word");

  const res = await fetch(WHISPER_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: fd,
  });
  if (!res.ok) throw new Error(`whisper ${res.status}: ${await res.text()}`);
  const j = (await res.json()) as {
    duration?: number;
    words?: { word: string; start: number; end: number }[];
  };
  const words = j.words ?? [];
  return { words, duration: j.duration ?? (words.at(-1)?.end ?? 0) };
}
