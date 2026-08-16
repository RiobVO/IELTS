import { describe, it, expect, vi, beforeEach } from "vitest";

// #12: importRunner must be atomic — a failure in the fallible pre-work (audio fetch,
// anti-leak) must leave NO half-draft. We mock every dependency so the test asserts
// only the control flow: persistTest is reached only after all validation passes.
const { parseRunner, parseTest, diagnoseEmpty, fetchAudio, uploadAudio, sanitize, assertNoLeak, brandResidue, persist, dupFind, uploadSourceHtml } = vi.hoisted(() => ({
  parseRunner: vi.fn(),
  parseTest: vi.fn(),
  diagnoseEmpty: vi.fn(),
  fetchAudio: vi.fn(),
  uploadAudio: vi.fn(),
  sanitize: vi.fn(),
  assertNoLeak: vi.fn(),
  brandResidue: vi.fn(),
  persist: vi.fn(),
  dupFind: vi.fn(),
  uploadSourceHtml: vi.fn(),
}));

vi.mock("./parse-runner", () => ({ parseRunner, diagnoseEmptyRunnerParse: diagnoseEmpty }));
vi.mock("../parse-test", () => ({ parseTest }));
vi.mock("./safe-audio-fetch", () => ({ fetchExternalAudio: fetchAudio }));
vi.mock("@/lib/telegram/storage", () => ({ uploadAudio }));
vi.mock("./sanitize-runner", () => ({ sanitizeRunner: sanitize, assertNoKeyLeak: assertNoLeak }));
vi.mock("./skin-runner", () => ({ runnerBrandResidue: brandResidue }));
vi.mock("../persist", () => ({
  persistTest: persist,
  findDuplicateTest: dupFind,
  DuplicateTestError: class extends Error {
    constructor(ex: { title: string }) {
      super(`Duplicate test content: matches "${ex.title}"`);
      this.name = "DuplicateTestError";
    }
  },
}));
vi.mock("../source-html-storage", () => ({ uploadSourceHtml }));

import { importRunner } from "./import-runner";

const listeningParsed = () => ({
  section: "listening",
  title: "Test",
  passages: [{ order: 1, audioPath: null }],
  questions: [{}, {}],
  warnings: [],
});

beforeEach(() => {
  [parseRunner, parseTest, diagnoseEmpty, fetchAudio, uploadAudio, sanitize, assertNoLeak, brandResidue, persist, dupFind, uploadSourceHtml].forEach((m) => m.mockReset());
  diagnoseEmpty.mockReturnValue("no questions parsed — unsupported source");
  sanitize.mockReturnValue("<runner/>");
  brandResidue.mockReturnValue([]);
  persist.mockResolvedValue("unused-return");
  dupFind.mockResolvedValue(null); // default: дубля нет
  uploadSourceHtml.mockResolvedValue(undefined);
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

  // Дубль-гвард (QA 2026-07-02): тот же тест под другим именем файла ложился второй
  // строкой. Отказ ДО аудио-фетча — не тратим минуты скачивания на дубль.
  it("отказывает на дубле содержимого ДО audio-fetch и persist", async () => {
    parseRunner.mockReturnValue({ parsed: listeningParsed(), externalAudioSrc: "http://cdn/x.mp3" });
    dupFind.mockResolvedValue({ id: "old1", title: "Old Copy", status: "draft", sourceFilePath: "old.html" });
    await expect(importRunner("<html/>", { sourceFilePath: "new-name.html" })).rejects.toThrow(/duplicate/i);
    expect(fetchAudio).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });

  // Пустой парс = нераспознанный источник; молчаливый 0-вопросный драфт хуже отказа.
  it("НЕ вызывает persist при 0 распознанных вопросов", async () => {
    parseRunner.mockReturnValue({ parsed: { ...listeningParsed(), questions: [] }, externalAudioSrc: null });
    await expect(importRunner("<html/>", {})).rejects.toThrow(/no questions/i);
    expect(persist).not.toHaveBeenCalled();
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

  // Бэкап исходника — воспроизводимость, но best-effort: сбой не должен ронять
  // уже успешный импорт (persist уже закоммичен).
  it("грузит исходный HTML после persist; сбой бэкапа не ронял импорт", async () => {
    parseRunner.mockReturnValue({ parsed: { ...listeningParsed(), section: "reading" }, externalAudioSrc: null });
    uploadSourceHtml.mockRejectedValue(new Error("bucket unreachable"));
    const res = await importRunner("<html raw/>", { sourceFilePath: "f.html" });
    expect(persist).toHaveBeenCalledTimes(1);
    expect(uploadSourceHtml).toHaveBeenCalledTimes(1);
    const [idArg, htmlArg] = uploadSourceHtml.mock.calls[0] as [string, string];
    expect(htmlArg).toBe("<html raw/>"); // необрезанный оригинал, не runnerHtml
    expect(idArg).toBe(res.id);
  });
});

// Атомизация reading (стратегия A): importRunner прищепляет текст пассажей из
// parseTest к runner-набору ДО persist, чтобы Practice стал богатым. Ключ/qtype/
// категория — из runner (SoT); mock не меняется. Best-effort: сбой atom-парса или
// несовпадение номеров → fallback на runner-набор, импорт успешен.
const readingQ = (number: number, over: Record<string, unknown> = {}) => ({
  number, passageOrder: 1, qtype: "tfng", promptHtml: "", options: null,
  groupKey: null, evidenceRef: null,
  answer: { mode: "exact", accept: ["TRUE"], explanation: null, evidence: null },
  ...over,
});
const readingParsed = () => ({
  section: "reading", title: "R", category: "passage_1", bandType: "reading_academic",
  durationSeconds: 1200, questionTypes: ["tfng"], bandScale: null,
  passages: [{ order: 1, title: null, bodyHtml: "", audioPath: null, questionsHtml: null }],
  questions: [readingQ(1), readingQ(2)],
  warnings: [],
});
const atomParsed = () => ({
  ...readingParsed(),
  title: "atom-ignored", category: "passage_3",
  passages: [{ order: 1, title: "P1", bodyHtml: "<p>real text</p>", audioPath: null, questionsHtml: null }],
  questions: [readingQ(1, { promptHtml: "Q1?" }), readingQ(2, { promptHtml: "Q2?" })],
});

describe("importRunner reading atomization", () => {
  it("reading: мержит текст пассажа из parseTest в parsed до persist", async () => {
    parseRunner.mockReturnValue({ parsed: readingParsed(), externalAudioSrc: null });
    parseTest.mockReturnValue(atomParsed());
    await importRunner("<html/>", {});
    expect(parseTest).toHaveBeenCalledTimes(1);
    const [parsedArg] = persist.mock.calls[0] as [{ passages: Array<{ bodyHtml: string }>; questions: Array<{ promptHtml: string; answer: unknown }>; category: string }];
    // атомизировано: непустой текст + prompt
    expect(parsedArg.passages[0]!.bodyHtml).toBe("<p>real text</p>");
    expect(parsedArg.questions[0]!.promptHtml).toBe("Q1?");
    // meta уровня content_item и ключ — из runner, не из atom
    expect(parsedArg.category).toBe("passage_1");
    expect(parsedArg.questions[0]!.answer).toEqual({ mode: "exact", accept: ["TRUE"], explanation: null, evidence: null });
  });

  it("reading: parseTest бросил → fallback на runner-набор + warning, импорт успешен", async () => {
    parseRunner.mockReturnValue({ parsed: readingParsed(), externalAudioSrc: null });
    parseTest.mockImplementation(() => { throw new Error("cheerio boom"); });
    const res = await importRunner("<html/>", {});
    expect(persist).toHaveBeenCalledTimes(1);
    const [parsedArg] = persist.mock.calls[0] as [{ passages: Array<{ bodyHtml: string }>; warnings: string[] }];
    expect(parsedArg.passages[0]!.bodyHtml).toBe(""); // не атомизировано
    expect(parsedArg.warnings.some((w) => /atomi/i.test(w))).toBe(true);
    expect(res.id).toBeTruthy();
  });

  it("reading: несовпадение номеров atom↔runner → fallback + warning", async () => {
    parseRunner.mockReturnValue({ parsed: readingParsed(), externalAudioSrc: null });
    const oneShort = atomParsed();
    oneShort.questions = [readingQ(1, { promptHtml: "Q1?" })]; // нет Q2
    parseTest.mockReturnValue(oneShort);
    await importRunner("<html/>", {});
    const [parsedArg] = persist.mock.calls[0] as [{ passages: Array<{ bodyHtml: string }>; warnings: string[] }];
    expect(parsedArg.passages[0]!.bodyHtml).toBe("");
    expect(parsedArg.warnings.some((w) => /atomi/i.test(w))).toBe(true);
  });

  it("listening: parseTest НЕ вызывается (вне scope этого фикса)", async () => {
    parseRunner.mockReturnValue({ parsed: listeningParsed(), externalAudioSrc: null });
    await importRunner("<html/>", {});
    expect(parseTest).not.toHaveBeenCalled();
    expect(persist).toHaveBeenCalledTimes(1);
  });
});
