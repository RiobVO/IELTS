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
import { MAX_IMPORT_AUDIO_BYTES } from "../audio-cap";

// Listening-runner видит choose-TWO членов как одиночные mcq_single (text_accept с
// обеими буквами per-member) и НИКОГДА не даёт groupKey — фикстура зеркалит это.
const listeningQ = (number: number, over: Record<string, unknown> = {}) => ({
  number, passageOrder: 1, qtype: "mcq_single", promptHtml: "", options: null,
  groupKey: null, evidenceRef: null,
  answer: { mode: "text_accept", accept: ["A", "C"], explanation: null, evidence: null },
  ...over,
});
const listeningParsed = () => ({
  section: "listening",
  title: "Test",
  passages: [{ order: 1, title: null, bodyHtml: "", audioPath: null, questionsHtml: null }],
  questions: [listeningQ(1), listeningQ(2)],
  warnings: [],
});
// Валидный atom-взгляд на тот же файл: parse-listening распознаёт .mcq.multi[data-qs]
// → mcq_multi + groupKey + options. Ключ atom НАМЕРЕННО другой формы (mcq_set) —
// тесты доказывают answer-провенанс от runner, а не совпадение значений. audioPath
// у atom — реалистичный внешний <audio src> (parse-listening пишет его в пассажи):
// тесты доказывают, что хотлинк НЕ утекает в persist.
const listeningAtomParsed = () => ({
  ...listeningParsed(),
  title: "atom-ignored",
  passages: [{ order: 1, title: "Part 1", bodyHtml: "Part 1", audioPath: "https://external-cdn/source.mp3", questionsHtml: null }],
  questions: [1, 2].map((n) =>
    listeningQ(n, {
      qtype: "mcq_multi",
      groupKey: "1-2",
      promptHtml: "Choose TWO",
      options: [{ value: "A", label: "Alpha" }, { value: "C", label: "Gamma" }],
      answer: { mode: "mcq_set", accept: ["A", "C"], explanation: null, evidence: null },
    }),
  ),
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
    parseTest.mockReturnValue(listeningAtomParsed()); // атомизация чистая — единственный warning ниже про аудио
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

  // Storage-гигиена: внешнее аудио > лимита (audio-cap) — ГРОМКИЙ отказ attach'а, не тихий
  // skip. Тест сохраняется без аудио (persist один раз), но audioTooLarge=true + warning,
  // чтобы бот отдельной строкой попросил пережать mp3. Аплоада нет (аудио не в bucket).
  it("аудио > лимита: persist БЕЗ аудио, audioTooLarge=true, upload не вызван", async () => {
    parseRunner.mockReturnValue({ parsed: listeningParsed(), externalAudioSrc: "http://cdn/big.mp3" });
    parseTest.mockReturnValue(listeningAtomParsed()); // атомизация чистая — тест проверяет только кап
    fetchAudio.mockResolvedValue(new ArrayBuffer(MAX_IMPORT_AUDIO_BYTES + 1)); // на байт больше капа
    const res = await importRunner("<html/>", {});
    expect(uploadAudio).not.toHaveBeenCalled();
    expect(persist).toHaveBeenCalledTimes(1);
    const [parsedArg] = persist.mock.calls[0] as [{ warnings: string[]; passages: Array<{ audioPath: string | null }> }];
    expect(parsedArg.warnings.some((w) => /exceeds .*cap/i.test(w))).toBe(true);
    expect(parsedArg.passages[0]!.audioPath).toBeNull();
    expect(res.hasAudio).toBe(false);
    expect(res.audioTooLarge).toBe(true);
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
    parseTest.mockReturnValue(listeningAtomParsed());
    fetchAudio.mockResolvedValue(new Uint8Array([1]).buffer);
    uploadAudio.mockResolvedValue("https://pub/audio.mp3");
    const res = await importRunner("<html/>", { sourceFilePath: "f.html" });
    expect(persist).toHaveBeenCalledTimes(1);
    const [parsedArg, opts] = persist.mock.calls[0] as [
      { passages: Array<{ audioPath: string | null }> },
      { id: string; sourceFilePath: string; runnerHtml: string },
    ];
    expect(opts).toMatchObject({ sourceFilePath: "f.html", runnerHtml: "<runner/>" });
    expect(typeof opts.id).toBe("string");
    expect(res.id).toBe(opts.id);
    expect(res.hasAudio).toBe(true);
    // порядок merge→attach: в persist уходит НАШ Storage-URL, atom-хотлинк отброшен мержем
    expect(parsedArg.passages[0]!.audioPath).toBe("https://pub/audio.mp3");
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

// Атомизация (стратегия A): importRunner прищепляет текст пассажей из parseTest
// к runner-набору ДО persist, чтобы Practice стал богатым — для ОБЕИХ секций.
// Ключ/категория — из runner (SoT); mock не меняется. Listening дополнительно
// берёт groupKey из atom + promotion mcq_single→mcq_multi (политика в
// atomize-merge.ts). Best-effort: сбой atom-парса или несовпадение номеров →
// fallback на runner-набор, импорт успешен.
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

describe("importRunner atomization (reading + listening)", () => {
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

  it("listening: parseTest вызывается, мерж применён (qtype/groupKey choose-TWO из atom, answer от runner)", async () => {
    parseRunner.mockReturnValue({ parsed: listeningParsed(), externalAudioSrc: null });
    parseTest.mockReturnValue(listeningAtomParsed());
    await importRunner("<html/>", {});
    expect(parseTest).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledTimes(1);
    const [parsedArg] = persist.mock.calls[0] as [{
      warnings: string[];
      passages: Array<{ bodyHtml: string }>;
      questions: Array<{ qtype: string; groupKey: string | null; promptHtml: string; answer: unknown }>;
    }];
    expect(parsedArg.warnings).toEqual([]); // мерж чистый, без fallback-warning
    expect(parsedArg.passages[0]!.bodyHtml).toBe("Part 1");
    for (const q of parsedArg.questions) {
      // члены choose-TWO группы: promotion mcq_single→mcq_multi + groupKey из atom
      expect(q.qtype).toBe("mcq_multi");
      expect(q.groupKey).toBe("1-2");
      expect(q.promptHtml).toBe("Choose TWO");
      // грейдинг-инвариант: ключ строго от runner (text_accept с обеими буквами),
      // atom-версия (mcq_set) НЕ просачивается
      expect(q.answer).toEqual({ mode: "text_accept", accept: ["A", "C"], explanation: null, evidence: null });
    }
  });

  it("listening: parseTest бросил → fallback на runner-набор + warning, импорт успешен", async () => {
    parseRunner.mockReturnValue({ parsed: listeningParsed(), externalAudioSrc: null });
    parseTest.mockImplementation(() => { throw new Error("cheerio boom"); });
    const res = await importRunner("<html/>", {});
    expect(persist).toHaveBeenCalledTimes(1);
    const [parsedArg] = persist.mock.calls[0] as [{ questions: Array<{ qtype: string }>; warnings: string[] }];
    expect(parsedArg.questions[0]!.qtype).toBe("mcq_single"); // не атомизировано
    expect(parsedArg.warnings.some((w) => /atomi/i.test(w))).toBe(true);
    expect(res.id).toBeTruthy();
  });

  // BLOCKER (review 2026-07-17, BRIEF §4.8): единственный реальный listening-импорт
  // путь — этот (Telegram/admin, importRunner). Runner (parse-runner.ts) не видит
  // .part[data-part] вообще и хардкодит part_1 для любого не-full импорта; только
  // atom (parse-listening.ts, через mergeAtomization) реально знает часть/band —
  // без проброса в atomize-merge.ts detectListeningCategory никогда не доходил до
  // persist. Юнит-покрытие самого мержа — atomize-merge.test.ts; здесь — что это
  // реально доезжает через весь importRunner до вызова persistTest.
  it("listening: category/bandScale в persist — из atom (part_N реальной части), а не из runner-заглушки part_1", async () => {
    const runnerParsed = { ...listeningParsed(), category: "part_1", bandType: "listening", bandScale: null, questionTypes: ["mcq_single"] };
    const atomParsed = { ...listeningAtomParsed(), category: "part_3", bandType: "listening", bandScale: null, questionTypes: ["mcq_multi"] };
    parseRunner.mockReturnValue({ parsed: runnerParsed, externalAudioSrc: null });
    parseTest.mockReturnValue(atomParsed);
    await importRunner("<html/>", {});
    expect(persist).toHaveBeenCalledTimes(1);
    const [parsedArg] = persist.mock.calls[0] as [{ category: string; bandScale: unknown }];
    expect(parsedArg.category).toBe("part_3");
    expect(parsedArg.bandScale).toBeNull();
  });

  it("listening: full (2+ части) → category full_listening, atom-bandScale в persist (runner не нашёл band())", async () => {
    const runnerParsed = { ...listeningParsed(), category: "full_listening", bandType: "listening", bandScale: null, questionTypes: ["mcq_single"] };
    const atomParsed = {
      ...listeningAtomParsed(),
      category: "full_listening",
      bandType: "listening",
      bandScale: { "0": 5, "40": 9 },
      questionTypes: ["mcq_multi"],
    };
    parseRunner.mockReturnValue({ parsed: runnerParsed, externalAudioSrc: null });
    parseTest.mockReturnValue(atomParsed);
    await importRunner("<html/>", {});
    const [parsedArg] = persist.mock.calls[0] as [{ category: string; bandScale: unknown }];
    expect(parsedArg.category).toBe("full_listening");
    expect(parsedArg.bandScale).toEqual({ "0": 5, "40": 9 });
  });
});
