import { describe, it, expect, vi, beforeEach } from "vitest";

// Юниты на два серверных гейта practice-actions.ts. Мокаем @/db (select/insert —
// очередь цепочек в стиле access.test.ts/persist.test.ts), @/lib/auth (getUser
// тянет supabase-server → @/env, падает без секретов) и @/lib/monitoring/log-error
// (импортирует @/db + server-only; в catch зовёт db.insert(errorLog) — глушим no-op,
// чтобы тихий throw внутри try не маскировался записью в error_log). gradeOne, isUuid
// и reviewCard — РЕАЛЬНЫЕ импорты (грейдинг/SM-2 не дублируем моком, иначе тест
// проверял бы мок, а не поведение).
const { select, insert } = vi.hoisted(() => ({ select: vi.fn(), insert: vi.fn() }));
const getUserFn = vi.hoisted(() => vi.fn());

vi.mock("@/db", () => ({
  db: {
    select: (...a: unknown[]) => select(...a),
    insert: (...a: unknown[]) => insert(...a),
  },
}));
vi.mock("@/lib/auth", () => ({ getUser: getUserFn }));
vi.mock("@/lib/monitoring/log-error", () => ({ logError: vi.fn() }));

import { locateEvidence, reviewMistake } from "./practice-actions";

// Валидный uuid — иначе isUuid (реальный) отсекает вход до первого select.
const ATT = "11111111-1111-1111-1111-111111111111";
const QNUM = 3;

// loadPracticeKey select #1 — attempt: db.select().from().where() -> Promise<rows>.
const attemptChain = (rows: unknown[]) => ({ from: () => ({ where: () => Promise.resolve(rows) }) });
// loadPracticeKey select #2 — key: .from().innerJoin().where().limit() -> Promise<rows>.
const keyChain = (rows: unknown[]) => ({
  from: () => ({ innerJoin: () => ({ where: () => ({ limit: () => Promise.resolve(rows) }) }) }),
});
// reviewMistake select #3 — mistake_review state: .from().where().limit() -> Promise<rows>.
const stateChain = (rows: unknown[]) => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve(rows) }) }) });

// Строка ключа ОДНОГО вопроса (форма — из select-проекции loadPracticeKey).
const keyRow = (over: Record<string, unknown> = {}) => ({
  mode: "text_accept",
  qtype: "sentence_completion",
  accept: ["PARIS"],
  explanation: null,
  explanationRu: null,
  evidence: null,
  ...over,
});

beforeEach(() => {
  select.mockReset();
  insert.mockReset();
  // db.insert(t).values(v).onConflictDoUpdate(c) -> awaitable.
  insert.mockReturnValue({ values: () => ({ onConflictDoUpdate: () => Promise.resolve(undefined) }) });
  getUserFn.mockReset();
  getUserFn.mockResolvedValue({ id: "u1" });
});

// P2b-2: локатор «Where to look» до сдачи. Регресс этого гейта = утечка ответа
// matching-вопросов (para ≡ ответ) через para ещё до reveal.
describe("locateEvidence — anti-cheat qtype-гейт", () => {
  // Оба члена LOCATE_BLOCKED_QTYPES (practice-actions.ts ~130) перечислены литералами,
  // а НЕ импортом сета — иначе выпадение элемента из прод-сета молча сузило бы и эти
  // параметры, и тест перестал бы ловить регресс (Codex-ревью).
  it.each(["matching_info", "matching_headings"] as const)(
    "qtype из LOCATE_BLOCKED_QTYPES (%s) -> null ДАЖЕ при существующем evidence.para",
    async (qtype) => {
      select
        .mockReturnValueOnce(attemptChain([{ contentItemId: "c1" }]))
        .mockReturnValueOnce(keyChain([keyRow({ qtype, evidence: { para: "3" } })]));
      // para есть, но для matching_* он и есть ответ -> сервер обязан вернуть null.
      await expect(locateEvidence(ATT, QNUM)).resolves.toBeNull();
    },
  );

  it("не-blocked qtype (sentence_completion) -> {para} из evidence", async () => {
    select
      .mockReturnValueOnce(attemptChain([{ contentItemId: "c1" }]))
      .mockReturnValueOnce(keyChain([keyRow({ qtype: "sentence_completion", evidence: { para: "3" } })]));
    // Для completion знание абзаца лишь «где смотреть», не ответ -> локатор допустим.
    await expect(locateEvidence(ATT, QNUM)).resolves.toEqual({ para: "3" });
  });
});

// Анти-спам градуации SM-2 (строка ~342): досрочный верный повтор известной карты
// не двигает лестницу; досрочная ошибка ("again") — двигает (ценный сигнал).
describe("reviewMistake — гейт анти-спам-градуации", () => {
  // dueAt в будущем относительно Date.now() — детерминизм без fake timers.
  const futureDue = () => new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
  const stateRow = (dueAt: Date) => ({ ease: 2.5, intervalDays: 3, repetitions: 2, lapses: 0, dueAt });

  it("state есть + grade=good + dueAt в будущем -> no-op (SM-2 не двигается, insert не вызван)", async () => {
    const dueAt = futureDue();
    select
      .mockReturnValueOnce(attemptChain([{ contentItemId: "c1" }]))
      .mockReturnValueOnce(keyChain([keyRow()]))
      .mockReturnValueOnce(stateChain([stateRow(dueAt)]));
    // value === accept -> gradeOne=true -> grade "good"; ранний verdict возвращает
    // существующий dueAt без записи. Точное равенство ловит и тихий throw (тот дал бы null).
    await expect(reviewMistake(ATT, QNUM, "paris")).resolves.toEqual({
      correct: true,
      dueAt: dueAt.toISOString(),
    });
    expect(insert).not.toHaveBeenCalled();
  });

  it("state есть + grade=again -> гейтом НЕ блокируется, запись в mistake_review идёт", async () => {
    const dueAt = futureDue();
    select
      .mockReturnValueOnce(attemptChain([{ contentItemId: "c1" }]))
      .mockReturnValueOnce(keyChain([keyRow()]))
      .mockReturnValueOnce(stateChain([stateRow(dueAt)]));
    const res = await reviewMistake(ATT, QNUM, "wrong"); // не совпало -> "again"
    expect(res?.correct).toBe(false);
    // Ровно один insert: mistake_review upsert. Graduation НЕ триггерится — reviewCard
    // на "again" сбрасывает repetitions в 0 (< GRADUATE_REPETITIONS=3).
    expect(insert).toHaveBeenCalledTimes(1);
  });

  // Положительная сторона гейта (Codex-ревью): если прод потеряет проверку
  // `dueAt > now` и начнёт блокировать КАЖДЫЙ good для существующей карты, этот тест
  // должен покраснеть — просроченная (dueAt в прошлом) карточка обязана продолжать
  // двигаться по SM-2, а не залипать в no-op.
  it("state есть + grade=good + dueAt в прошлом (просрочена) -> гейт НЕ блокирует, запись в mistake_review идёт", async () => {
    const dueAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    select
      .mockReturnValueOnce(attemptChain([{ contentItemId: "c1" }]))
      .mockReturnValueOnce(keyChain([keyRow()]))
      .mockReturnValueOnce(stateChain([stateRow(dueAt)]));
    const res = await reviewMistake(ATT, QNUM, "paris"); // совпало -> "good"
    expect(res?.correct).toBe(true);
    // Гейт срабатывает только на state.dueAt > now — просроченная карта его не проходит,
    // SM-2-апдейт обязан уйти в db.insert(mistakeReview)...onConflictDoUpdate.
    expect(insert).toHaveBeenCalled();
  });
});
