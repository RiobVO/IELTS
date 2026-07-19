import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Юнит-тесты на submitAttempt (BRIEF §4.6): две несущие анти-накрутка-гарантии —
// (1) идемпотентность ре-сабмита уже сданной попытки и (2) single-fire claim на
// конкурентном сабмите. Мок-паттерн — эталон src/lib/exam/access.test.ts:
//   - @/db: одна select-очередь (mockReturnValueOnce в порядке РЕАЛЬНЫХ вызовов) +
//     отдельная update-очередь; терминал цепочки резолвит Promise<rows>;
//   - next/navigation.redirect бросает СВОЮ ошибку с адресом -> assert точного target
//     (в реальном Next redirect() тоже бросает и не возвращает управление);
//   - @/lib/analytics/server замокан, т.к. actions.ts тянет captureServer, а тот —
//     @/env (posthogConfig), падающий без секретов;
//   - @/lib/exam/access замокан целиком: loadAccessData/enforceAccess — не цель этих
//     тестов, их собственные ветки покрыты в access.test.ts;
//   - grade / applyPostSubmit замоканы, чтобы ассертить сам факт «не вызвано».

const { select, update } = vi.hoisted(() => ({ select: vi.fn(), update: vi.fn() }));
const getUserFn = vi.hoisted(() => vi.fn());
const gradeFn = vi.hoisted(() => vi.fn());
const applyPostSubmitFn = vi.hoisted(() => vi.fn());
const loadAccessDataFn = vi.hoisted(() => vi.fn());
const enforceAccessFn = vi.hoisted(() => vi.fn());
// after()-колбэки собираем в промисы (стаб ниже пушит сюда), afterEach их дожидается —
// см. комментарий у мока next/server.
const afterPromises = vi.hoisted(() => [] as Promise<unknown>[]);
const redirectFn = vi.hoisted(() =>
  vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
);

vi.mock("@/db", () => ({
  db: {
    select: (...a: unknown[]) => select(...a),
    update: (...a: unknown[]) => update(...a),
  },
}));
vi.mock("@/lib/auth", () => ({ getUser: getUserFn }));
vi.mock("@/lib/exam/access", () => ({
  loadAccessData: loadAccessDataFn,
  enforceAccess: enforceAccessFn,
}));
vi.mock("@/lib/grading/grade", () => ({ grade: gradeFn }));
vi.mock("@/lib/progress/apply-post-submit", () => ({ applyPostSubmit: applyPostSubmitFn }));
vi.mock("next/navigation", () => ({ redirect: redirectFn }));
vi.mock("@/lib/analytics/server", () => ({ captureServer: vi.fn() }));
// after() вне request-скоупа Next бросает; в юнитах откладываем колбэк на микротаск и
// СОБИРАЕМ его промис (как реальный after() откладывает выполнение относительно ответа).
// Синхронный `void fn()` проглатывал бы rejection колбэка; здесь afterEach дожидается
// всех промисов -> reject валит свой тест, а .splice() очищает очередь -> нет утечки
// колбэков между тестами.
vi.mock("next/server", () => ({
  after: (fn: () => unknown) => {
    afterPromises.push(Promise.resolve().then(fn));
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { submitAttempt } from "./actions";

const USER = { id: "u1" };
// Валидный 8-4-4-4-12 hex — проходит isUuid (реальная, не мокнутая, либеральный regex).
const ATTEMPT_ID = "11111111-1111-4111-8111-111111111111";
const CONTENT_ITEM_ID = "item1";
const RESULT_URL = `/app/reading/${CONTENT_ITEM_ID}/result?a=${ATTEMPT_ID}`;

// (a) attempt-lookup [att]: .from().where() -> Promise<rows>.
const selWhere = (rows: unknown[]) => ({ from: () => ({ where: () => Promise.resolve(rows) }) });
// (b) recentSubmits (throttle-окно): .from().where().orderBy().limit() -> Promise<rows>.
const selOrderLimit = (rows: unknown[]) => ({
  from: () => ({ where: () => ({ orderBy: () => ({ limit: () => Promise.resolve(rows) }) }) }),
});
// (c) answer-key rows: .from().innerJoin().where() -> Promise<rows>.
const selJoinWhere = (rows: unknown[]) => ({
  from: () => ({ innerJoin: () => ({ where: () => Promise.resolve(rows) }) }),
});
// (d) single-fire update: .set().where(pred).returning() -> Promise<rows>. Захватываем
// предикат .where() в capturedUpdateWhere, чтобы single-fire-тест мог его запинить.
let capturedUpdateWhere: unknown;
const updReturning = (rows: unknown[]) => ({
  set: () => ({
    where: (pred: unknown) => {
      capturedUpdateWhere = pred;
      return { returning: () => Promise.resolve(rows) };
    },
  }),
});

// Рекурсивный обход SQL-AST Drizzle-предиката: идём ТОЛЬКО по queryChunks (сам AST
// сравнения), НЕ спускаясь в back-ref'ы схемы (.table у колонки, .encoder у Param).
// Это принципиально: через .table достижима ВСЯ мета-таблицы — колонка `status` и
// строка `'in_progress'` лежат в enumValues/default ЛЮБОЙ attempt-колонки, так что
// наивный обход всего объекта дал бы ложно-положительный маркер даже без guard'а.
// Возвращаем имена колонок и значения bound-параметров, реально участвующих в WHERE.
function collectSqlMarkers(
  node: unknown,
  acc: { columnNames: string[]; paramValues: unknown[] } = { columnNames: [], paramValues: [] },
): { columnNames: string[]; paramValues: unknown[] } {
  if (node === null || typeof node !== "object") return acc;
  const n = node as Record<string, unknown>;
  // SQL-узел: спускаемся по его чанкам (и только по ним).
  if (Array.isArray(n.queryChunks)) {
    for (const chunk of n.queryChunks) collectSqlMarkers(chunk, acc);
    return acc;
  }
  // Param: bound-значение сравнения (.encoder — колонка-энкодер, в неё НЕ идём).
  if ("encoder" in n && "value" in n) {
    acc.paramValues.push(n.value);
    return acc;
  }
  // Column: ссылка на колонку (.table — back-ref на всю схему, в него НЕ идём).
  if (typeof n.name === "string" && "columnType" in n) {
    acc.columnNames.push(n.name);
    return acc;
  }
  return acc;
}

beforeEach(() => {
  select.mockReset();
  update.mockReset();
  getUserFn.mockReset();
  gradeFn.mockReset();
  applyPostSubmitFn.mockReset();
  loadAccessDataFn.mockReset();
  enforceAccessFn.mockReset();
  redirectFn.mockClear(); // clear, НЕ reset — сохраняем throwing-реализацию.
  capturedUpdateWhere = undefined;
});

afterEach(async () => {
  // splice(0) извлекает и очищает очередь ДО await — reject колбэка валит СВОЙ тест,
  // но очередь уже пуста, поэтому колбэки не утекают в следующий тест.
  await Promise.all(afterPromises.splice(0));
});

describe("submitAttempt", () => {
  it("[идемпотентность] ре-сабмит уже submitted-попытки -> redirect на /result БЕЗ повторного грейдинга", async () => {
    getUserFn.mockResolvedValue(USER);
    // Единственный select до идемпотентной ветки: attempt-lookup со статусом submitted.
    select.mockReturnValueOnce(
      selWhere([
        {
          contentItemId: CONTENT_ITEM_ID,
          status: "submitted",
          startedAt: new Date(),
          mode: "mock",
        },
      ]),
    );

    await expect(submitAttempt(ATTEMPT_ID, {})).rejects.toThrow(`REDIRECT:${RESULT_URL}`);

    expect(redirectFn).toHaveBeenCalledWith(RESULT_URL);
    // Защита от двойного XP/rating: повторный грейдинг и прогрессия не запускаются.
    expect(gradeFn).not.toHaveBeenCalled();
    expect(applyPostSubmitFn).not.toHaveBeenCalled();
    // Ровно один запрос к БД (attempt-lookup) — throttle/access/key-батч не читается.
    expect(select).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
  });

  it("[single-fire claim] проигрыш гонки (update.returning() -> []) -> redirect на /result, applyPostSubmit НЕ вызван", async () => {
    getUserFn.mockResolvedValue(USER);
    // Порядок select-вызовов: (1) attempt-lookup, затем Promise.all -> (2) recentSubmits,
    // (3) answer-key rows. loadAccessData между ними замокан и db.select не трогает.
    select
      .mockReturnValueOnce(
        selWhere([
          {
            contentItemId: CONTENT_ITEM_ID,
            status: "in_progress",
            startedAt: new Date(),
            mode: "mock",
          },
        ]),
      )
      .mockReturnValueOnce(selOrderLimit([])) // окно throttle пусто -> не превышено
      .mockReturnValueOnce(
        selJoinWhere([
          { number: 1, qtype: "mcq", mode: "mcq_set", accept: ["A"], explanation: null, explanationRu: null, evidence: null },
        ]),
      );
    loadAccessDataFn.mockResolvedValue({
      userTier: "premium",
      tierRequired: "basic",
      category: "full_reading",
      bandScale: null,
      adminDraftBypass: false,
    });
    enforceAccessFn.mockResolvedValue(undefined);
    gradeFn.mockReturnValue({ rawScore: 5, perType: {}, total: 10 });
    // Проиграл гонку: status='in_progress'-guard в WHERE не задел ни строки.
    update.mockReturnValueOnce(updReturning([]));

    await expect(submitAttempt(ATTEMPT_ID, { "1": "A" })).rejects.toThrow(`REDIRECT:${RESULT_URL}`);

    expect(redirectFn).toHaveBeenCalledWith(RESULT_URL);
    // Прогрессия (streak/XP/Elo/бейджи) НЕ идёт у проигравшего гонку.
    expect(applyPostSubmitFn).not.toHaveBeenCalled();
    // update реально позван (claim-попытка была), но вернул пусто.
    expect(update).toHaveBeenCalledTimes(1);

    // Находка Codex (High): пинним, что WHERE single-fire claim СОДЕРЖИТ guard по
    // status='in_progress' — единственную защиту от двойной прогрессии. Выпадет
    // eq(attempt.status,'in_progress') из прод-кода — оба маркера исчезнут, тест
    // покраснеет. Точечный поиск двух маркеров по SQL-AST (не хрупкий строковый
    // снапшот всего SQL). Граница: сама АТОМАРНОСТЬ UPDATE (что WHERE-guard + пустой
    // returning() у проигравшего реально сериализуют конкурентов) — DB-уровень, мок
    // её НЕ доказывает; здесь запинено лишь присутствие предиката в запросе.
    const markers = collectSqlMarkers(capturedUpdateWhere);
    expect(markers.columnNames).toContain("status");
    expect(markers.paramValues).toContain("in_progress");
  });
});
