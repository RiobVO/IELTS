import { describe, it, expect, vi, beforeEach } from "vitest";

// #12: importRunner must be atomic — a failure in the fallible pre-work (audio fetch,
// anti-leak) must leave NO half-draft. We mock every dependency so the test asserts
// only the control flow: persistTest is reached only after all validation passes.
const { parseRunner, fetchAudio, uploadAudio, sanitize, assertNoLeak, brandResidue, persist } = vi.hoisted(() => ({
  parseRunner: vi.fn(),
  fetchAudio: vi.fn(),
  uploadAudio: vi.fn(),
  sanitize: vi.fn(),
  assertNoLeak: vi.fn(),
  brandResidue: vi.fn(),
  persist: vi.fn(),
}));

vi.mock("./parse-runner", () => ({ parseRunner }));
vi.mock("./safe-audio-fetch", () => ({ fetchExternalAudio: fetchAudio }));
vi.mock("@/lib/telegram/storage", () => ({ uploadAudio }));
vi.mock("./sanitize-runner", () => ({ sanitizeRunner: sanitize, assertNoKeyLeak: assertNoLeak }));
vi.mock("./skin-runner", () => ({ runnerBrandResidue: brandResidue }));
vi.mock("../persist", () => ({ persistTest: persist }));

import { importRunner } from "./import-runner";

const listeningParsed = () => ({
  section: "listening",
  title: "Test",
  passages: [{ order: 1, audioPath: null }],
  questions: [{}, {}],
  warnings: [],
});

beforeEach(() => {
  [parseRunner, fetchAudio, uploadAudio, sanitize, assertNoLeak, brandResidue, persist].forEach((m) => m.mockReset());
  sanitize.mockReturnValue("<runner/>");
  brandResidue.mockReturnValue([]);
  persist.mockResolvedValue("unused-return");
});

describe("importRunner atomicity (#12)", () => {
  // Handoff 2026-07-02: сбой фетча внешнего mp3 ронял ВЕСЬ импорт (каждый C21
  // Listening). Новая спека — деградация: тест сохраняется БЕЗ аудио (draft),
  // warning оседает в import_warnings, mp3 привязывается отдельным файлом.
  // Атомарность (#12) не тронута: persist по-прежнему один и после anti-leak.
  it("сбой audio-fetch деградирует: persist БЕЗ аудио + warning, hasAudio=false", async () => {
    parseRunner.mockReturnValue({ parsed: listeningParsed(), externalAudioSrc: "http://cdn/x.mp3" });
    fetchAudio.mockRejectedValue(new Error("redirect refused"));
    const res = await importRunner("<html/>", {});
    expect(uploadAudio).not.toHaveBeenCalled();
    expect(persist).toHaveBeenCalledTimes(1);
    const [parsedArg] = persist.mock.calls[0] as [{ warnings: string[]; passages: Array<{ audioPath: string | null }> }];
    expect(parsedArg.warnings.some((w) => /audio/i.test(w) && /redirect refused/.test(w))).toBe(true);
    expect(parsedArg.passages[0]!.audioPath).toBeNull();
    expect(res.hasAudio).toBe(false);
    expect(res.warnings).toBe(1);
  });

  it("НЕ вызывает persist при провале anti-leak", async () => {
    parseRunner.mockReturnValue({ parsed: { ...listeningParsed(), section: "reading" }, externalAudioSrc: null });
    assertNoLeak.mockImplementation(() => { throw new Error("answer key leaked"); });
    await expect(importRunner("<html/>", {})).rejects.toThrow(/answer key leaked/);
    expect(persist).not.toHaveBeenCalled();
  });

  it("persist один раз с pre-generated id + runner_html при успехе", async () => {
    parseRunner.mockReturnValue({ parsed: listeningParsed(), externalAudioSrc: "http://cdn/x.mp3" });
    fetchAudio.mockResolvedValue(new Uint8Array([1]).buffer);
    uploadAudio.mockResolvedValue("https://pub/audio.mp3");
    const res = await importRunner("<html/>", { sourceFilePath: "f.html" });
    expect(persist).toHaveBeenCalledTimes(1);
    const [, opts] = persist.mock.calls[0];
    expect(opts).toMatchObject({ sourceFilePath: "f.html", runnerHtml: "<runner/>" });
    expect(typeof opts.id).toBe("string");
    expect(res.id).toBe(opts.id);
    expect(res.hasAudio).toBe(true);
  });
});
