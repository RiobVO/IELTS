import { describe, it, expect, vi, beforeEach } from "vitest";

// publish.ts pulls @/db (env-validating at import) + next/cache; mock both so the gate
// logic runs in isolation. The answer-key review gate (reviewed_at, BRIEF §4.2.1) must
// hold on EVERY publish path — this helper is the single chokepoint both callers share.
const { select, update } = vi.hoisted(() => ({ select: vi.fn(), update: vi.fn() }));
const revalidateTag = vi.hoisted(() => vi.fn());
vi.mock("@/db", () => ({ db: { select: (...a: unknown[]) => select(...a), update: (...a: unknown[]) => update(...a) } }));
vi.mock("next/cache", () => ({ revalidateTag }));
import { publishReviewedContentItem } from "./publish";

// select #1 (content): from().where().limit(); select #2 (integrity left-join
// question→answer_key): from().leftJoin().where(); select #3 (listening audio,
// passages): from().where().
const contentChain = (rows: unknown[]) => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve(rows) }) }) });
const integrityChain = (rows: unknown[]) => ({ from: () => ({ leftJoin: () => ({ where: () => Promise.resolve(rows) }) }) });
const passagesChain = (rows: unknown[]) => ({ from: () => ({ where: () => Promise.resolve(rows) }) });
const updateChain = () => ({ set: () => ({ where: () => Promise.resolve(undefined) }) });

// Строка integrity-запроса: {номер вопроса, id ключа (null = ключа нет), accept}.
const q = (number: number, accept: unknown = ["A"], keyId: string | null = `k${number}`) => ({ number, keyId, accept });

beforeEach(() => {
  select.mockReset();
  update.mockReset();
  revalidateTag.mockReset();
});

describe("publishReviewedContentItem", () => {
  it("refuses to publish an unreviewed item (reviewed_at null) without an update", async () => {
    select.mockReturnValue(contentChain([{ reviewedAt: null, title: "T", section: "reading" }]));
    const res = await publishReviewedContentItem("id1");
    expect(res).toEqual({ ok: false, reason: "not_reviewed" });
    expect(update).not.toHaveBeenCalled();
  });

  it("reports not_found for a missing item", async () => {
    select.mockReturnValue(contentChain([]));
    const res = await publishReviewedContentItem("id1");
    expect(res).toEqual({ ok: false, reason: "not_found" });
    expect(update).not.toHaveBeenCalled();
  });

  it("publishes a reviewed reading item with contiguous, non-empty keys and returns its title", async () => {
    select
      .mockReturnValueOnce(contentChain([{ reviewedAt: new Date(), title: "Reading 1", section: "reading" }]))
      .mockReturnValueOnce(integrityChain([q(1, ["A"]), q(2, ["journal", "journals"])]));
    update.mockReturnValue(updateChain());
    const res = await publishReviewedContentItem("id1");
    expect(res).toEqual({ ok: true, title: "Reading 1" });
    expect(update).toHaveBeenCalledOnce();
    // Broad catalog tag + per-test tag (W2-6): both fire on publish.
    expect(revalidateTag).toHaveBeenCalledWith("content_item");
    expect(revalidateTag).toHaveBeenCalledWith("content-id1");
  });

  it("refuses to publish when any question has an empty answer key (#17)", async () => {
    select
      .mockReturnValueOnce(contentChain([{ reviewedAt: new Date(), title: "Reading 1", section: "reading" }]))
      .mockReturnValueOnce(integrityChain([q(1, ["A"]), q(2, [""])])); // one blank key
    const res = await publishReviewedContentItem("id1");
    expect(res).toEqual({ ok: false, reason: "empty_answer_key" });
    expect(update).not.toHaveBeenCalled();
  });

  // Codex-ревью (2026-07-09): не-массивный accept (напр. jsonb {}) не должен ронять гейт
  // на .some — трактуем как пустой ключ.
  it("не падает на не-массивном accept — трактует как пустой ключ (#17)", async () => {
    select
      .mockReturnValueOnce(contentChain([{ reviewedAt: new Date(), title: "Reading 1", section: "reading" }]))
      .mockReturnValueOnce(integrityChain([{ number: 1, keyId: "k1", accept: {} }]));
    const res = await publishReviewedContentItem("id1");
    expect(res).toEqual({ ok: false, reason: "empty_answer_key" });
  });

  it("refuses to publish when a question type didn't resolve (unknown-type fallback) (#13)", async () => {
    select.mockReturnValueOnce(
      contentChain([
        {
          reviewedAt: new Date(),
          title: "Reading 1",
          section: "reading",
          importWarnings: ['Q2: unknown type "Frobnicate" → fell back to short_answer'],
        },
      ]),
    );
    const res = await publishReviewedContentItem("id1");
    expect(res).toEqual({ ok: false, reason: "unresolved_question_type" });
    expect(update).not.toHaveBeenCalled();
  });

  it("publishes despite informational / low-confidence warnings — only unknown-type blocks (#13)", async () => {
    select
      .mockReturnValueOnce(
        contentChain([
          {
            reviewedAt: new Date(),
            title: "Reading 1",
            section: "reading",
            importWarnings: [
              'Q3: low-confidence type "Some Matching" → matching_info',
              "2 question(s) without explanation",
            ],
          },
        ]),
      )
      .mockReturnValueOnce(integrityChain([q(1, ["A"])]));
    update.mockReturnValue(updateChain());
    const res = await publishReviewedContentItem("id1");
    expect(res).toEqual({ ok: true, title: "Reading 1" });
    expect(update).toHaveBeenCalledOnce();
  });

  it("publishes when a low-confidence source label merely contains 'unknown type' (no false barrier) (#13)", async () => {
    select
      .mockReturnValueOnce(
        contentChain([
          {
            reviewedAt: new Date(),
            title: "Reading 1",
            section: "reading",
            importWarnings: ['Q5: low-confidence type "unknown type matching" → matching_info'],
          },
        ]),
      )
      .mockReturnValueOnce(integrityChain([q(1, ["A"])]));
    update.mockReturnValue(updateChain());
    const res = await publishReviewedContentItem("id1");
    expect(res).toEqual({ ok: true, title: "Reading 1" });
    expect(update).toHaveBeenCalledOnce();
  });

  // QTYPE hard-block (2026-07-11): пустой QTYPE, УЖЕ сохранённый в драфте со старым блок-
  // маркером (unknownTypeWarning с пустым label, persisted до появления blankTypeWarning),
  // блокирует publish наравне с непустым нераспознанным типом — реверс P1-смягчения.
  it("refuses to publish a draft whose only unknown-type warning is a blank label (#13)", async () => {
    select.mockReturnValueOnce(
      contentChain([
        {
          reviewedAt: new Date(),
          title: "Listening blank",
          section: "reading",
          importWarnings: ['Q1: unknown type "" → fell back to short_answer'],
        },
      ]),
    );
    const res = await publishReviewedContentItem("id1");
    expect(res).toEqual({ ok: false, reason: "unresolved_question_type" });
    expect(update).not.toHaveBeenCalled();
  });

  // Тот же гейт для текущего формата blankTypeWarning (генератор parse-runner.ts).
  it("refuses to publish a draft with a current-format blankTypeWarning (#13)", async () => {
    select.mockReturnValueOnce(
      contentChain([
        {
          reviewedAt: new Date(),
          title: "Listening blank 2",
          section: "reading",
          importWarnings: ["Q1: no question type provided in source — publish blocked, add QTYPE and re-import"],
        },
      ]),
    );
    const res = await publishReviewedContentItem("id1");
    expect(res).toEqual({ ok: false, reason: "unresolved_question_type" });
    expect(update).not.toHaveBeenCalled();
  });

  // Кейс "как раньше": валидные типы (нет blank/unknown warning'ов вообще) публикуются
  // без изменений — QTYPE hard-block не задевает чистый импорт.
  it("publishes a draft with only valid question types and no qtype warnings, as before (#13)", async () => {
    select
      .mockReturnValueOnce(
        contentChain([
          {
            reviewedAt: new Date(),
            title: "Clean reading",
            section: "reading",
            importWarnings: [],
          },
        ]),
      )
      .mockReturnValueOnce(integrityChain([q(1, ["A"]), q(2, ["B"])]));
    update.mockReturnValue(updateChain());
    const res = await publishReviewedContentItem("id1");
    expect(res).toEqual({ ok: true, title: "Clean reading" });
    expect(update).toHaveBeenCalledOnce();
  });

  // (а) номера вопросов без дыр и без дублей — offset-agnostic.
  it("refuses to publish when question numbers have a gap (P1a)", async () => {
    select
      .mockReturnValueOnce(contentChain([{ reviewedAt: new Date(), title: "R", section: "reading" }]))
      .mockReturnValueOnce(integrityChain([q(1, ["A"]), q(3, ["B"])]));
    const res = await publishReviewedContentItem("id1");
    expect(res).toEqual({ ok: false, reason: "question_number_gap" });
    expect(update).not.toHaveBeenCalled();
  });

  it("refuses to publish when question numbers have a duplicate (P1a)", async () => {
    select
      .mockReturnValueOnce(contentChain([{ reviewedAt: new Date(), title: "R", section: "reading" }]))
      .mockReturnValueOnce(integrityChain([q(1, ["A"]), q(1, ["B"])]));
    const res = await publishReviewedContentItem("id1");
    expect(res).toEqual({ ok: false, reason: "question_number_gap" });
  });

  // Codex-ревью (2026-07-09): offset-agnostic формула пропускала неположительные номера
  // ([-1,0,1] даёт max-min+1==distinct). Номера вопросов обязаны быть положительными целыми.
  it("refuses to publish when question numbers are non-positive (P1a)", async () => {
    select
      .mockReturnValueOnce(contentChain([{ reviewedAt: new Date(), title: "R", section: "reading" }]))
      .mockReturnValueOnce(integrityChain([q(-1, ["A"]), q(0, ["B"]), q(1, ["C"])]));
    const res = await publishReviewedContentItem("id1");
    expect(res).toEqual({ ok: false, reason: "question_number_gap" });
    expect(update).not.toHaveBeenCalled();
  });

  // Критично: одиночный пассаж нумеруется НЕ с 1 (passage_2 → 14..26) — публиковаться ДОЛЖЕН,
  // не ложно блокироваться (буквальный «1..N» его бы срезал).
  it("publishes an offset-numbered single passage (14..26) — no false block (P1a)", async () => {
    const rows = Array.from({ length: 13 }, (_, i) => q(14 + i, ["A"]));
    select
      .mockReturnValueOnce(contentChain([{ reviewedAt: new Date(), title: "Passage 2", section: "reading" }]))
      .mockReturnValueOnce(integrityChain(rows));
    update.mockReturnValue(updateChain());
    const res = await publishReviewedContentItem("id1");
    expect(res).toEqual({ ok: true, title: "Passage 2" });
  });

  // (б) у каждого вопроса должна быть строка answer_key.
  it("refuses to publish when a question has no answer_key row (P1b)", async () => {
    select
      .mockReturnValueOnce(contentChain([{ reviewedAt: new Date(), title: "R", section: "reading" }]))
      .mockReturnValueOnce(integrityChain([q(1, ["A"]), { number: 2, keyId: null, accept: null }]));
    const res = await publishReviewedContentItem("id1");
    expect(res).toEqual({ ok: false, reason: "answer_key_count_mismatch" });
    expect(update).not.toHaveBeenCalled();
  });

  // (в) listening без аудио не публикуется; reading этот запрос не выполняет.
  it("refuses to publish a listening test without audio (P1c)", async () => {
    select
      .mockReturnValueOnce(contentChain([{ reviewedAt: new Date(), title: "L", section: "listening" }]))
      .mockReturnValueOnce(integrityChain([q(1, ["A"])]))
      .mockReturnValueOnce(passagesChain([{ audioPath: null }]));
    const res = await publishReviewedContentItem("id1");
    expect(res).toEqual({ ok: false, reason: "missing_listening_audio" });
    expect(update).not.toHaveBeenCalled();
  });

  it("publishes a listening test once audio is attached (P1c)", async () => {
    select
      .mockReturnValueOnce(contentChain([{ reviewedAt: new Date(), title: "L", section: "listening" }]))
      .mockReturnValueOnce(integrityChain([q(1, ["A"])]))
      .mockReturnValueOnce(passagesChain([{ audioPath: "audio/l.mp3" }]));
    update.mockReturnValue(updateChain());
    const res = await publishReviewedContentItem("id1");
    expect(res).toEqual({ ok: true, title: "L" });
    expect(update).toHaveBeenCalledOnce();
  });

  // F3-min (2026-07-12): full-тест (category full_reading/full_listening) без band-шкалы
  // публиковался с bandScale=null — студент видел percent вместо band (прод подтвердил).
  it("refuses to publish a full_reading test with 40Q but no band scale (F3-min)", async () => {
    const rows = Array.from({ length: 40 }, (_, i) => q(1 + i, ["A"]));
    select
      .mockReturnValueOnce(
        contentChain([
          { reviewedAt: new Date(), title: "Full R", section: "reading", category: "full_reading", bandScale: null },
        ]),
      )
      .mockReturnValueOnce(integrityChain(rows));
    const res = await publishReviewedContentItem("id1");
    expect(res).toEqual({ ok: false, reason: "full_missing_band_scale" });
    expect(update).not.toHaveBeenCalled();
  });

  // Пустой объект — вырожденное персистентное значение шкалы: гейт трактует {} как
  // отсутствующую шкалу наравне с null (Object.keys(...).length === 0).
  it("refuses to publish a full_reading test with 40Q and an EMPTY band scale object (F3-min)", async () => {
    const rows = Array.from({ length: 40 }, (_, i) => q(1 + i, ["A"]));
    select
      .mockReturnValueOnce(
        contentChain([
          { reviewedAt: new Date(), title: "Full R", section: "reading", category: "full_reading", bandScale: {} },
        ]),
      )
      .mockReturnValueOnce(integrityChain(rows));
    const res = await publishReviewedContentItem("id1");
    expect(res).toEqual({ ok: false, reason: "full_missing_band_scale" });
    expect(update).not.toHaveBeenCalled();
  });

  // Пропущенный крайний вопрос (1..39) остаётся смежным диапазоном для offset-agnostic (a),
  // но для full-теста действует IELTS-инвариант «ровно 40 вопросов».
  it("refuses to publish a full_reading test with 39Q even with a valid band scale (F3-min)", async () => {
    const rows = Array.from({ length: 39 }, (_, i) => q(1 + i, ["A"]));
    select
      .mockReturnValueOnce(
        contentChain([
          {
            reviewedAt: new Date(),
            title: "Full R",
            section: "reading",
            category: "full_reading",
            bandScale: { "39": 9 },
          },
        ]),
      )
      .mockReturnValueOnce(integrityChain(rows));
    const res = await publishReviewedContentItem("id1");
    expect(res).toEqual({ ok: false, reason: "full_wrong_question_count" });
    expect(update).not.toHaveBeenCalled();
  });

  // Верхняя граница: 41 смежный вопрос тоже проходит offset-agnostic (а), но нарушает
  // инвариант «ровно 40» — блок тем же reason'ом.
  it("refuses to publish a full_reading test with 41Q even with a valid band scale (F3-min)", async () => {
    const rows = Array.from({ length: 41 }, (_, i) => q(1 + i, ["A"]));
    select
      .mockReturnValueOnce(
        contentChain([
          {
            reviewedAt: new Date(),
            title: "Full R",
            section: "reading",
            category: "full_reading",
            bandScale: { "40": 9 },
          },
        ]),
      )
      .mockReturnValueOnce(integrityChain(rows));
    const res = await publishReviewedContentItem("id1");
    expect(res).toEqual({ ok: false, reason: "full_wrong_question_count" });
    expect(update).not.toHaveBeenCalled();
  });

  it("publishes a full_listening test with 40Q, a band scale, and audio (F3-min)", async () => {
    const rows = Array.from({ length: 40 }, (_, i) => q(1 + i, ["A"]));
    select
      .mockReturnValueOnce(
        contentChain([
          {
            reviewedAt: new Date(),
            title: "Full L",
            section: "listening",
            category: "full_listening",
            bandScale: { "40": 9 },
          },
        ]),
      )
      .mockReturnValueOnce(integrityChain(rows))
      .mockReturnValueOnce(passagesChain([{ audioPath: "audio/l.mp3" }]));
    update.mockReturnValue(updateChain());
    const res = await publishReviewedContentItem("id1");
    expect(res).toEqual({ ok: true, title: "Full L" });
    expect(update).toHaveBeenCalledOnce();
  });

  // Регресс-защита: single passage (offset-agnostic, category !== full_*) публикуется без
  // band-шкалы как раньше — новый гейт не должен зацепить passage_2.
  it("publishes an offset-numbered passage_2 without a band scale — no regression (F3-min)", async () => {
    const rows = Array.from({ length: 13 }, (_, i) => q(14 + i, ["A"]));
    select
      .mockReturnValueOnce(
        contentChain([
          { reviewedAt: new Date(), title: "Passage 2", section: "reading", category: "passage_2", bandScale: null },
        ]),
      )
      .mockReturnValueOnce(integrityChain(rows));
    update.mockReturnValue(updateChain());
    const res = await publishReviewedContentItem("id1");
    expect(res).toEqual({ ok: true, title: "Passage 2" });
    expect(update).toHaveBeenCalledOnce();
  });
});
