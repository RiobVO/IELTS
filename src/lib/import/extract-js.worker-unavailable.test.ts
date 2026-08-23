// Отдельный файл (не extract-js.test.ts): мокаем node:worker_threads целиком, чтобы
// смоделировать СИНХРОННЫЙ throw из `new Worker(...)` — worker_threads недоступен в
// рантайме (напр. Vercel-несовместимость). vitest изолирует module registry по файлам,
// так что реальные worker-тесты изоляции (#20) в extract-js.test.ts не задеты.
//
// Различие двух классов сбоя (см. extract-js.ts, runInWorker): конструктор бросает =>
// WorkerUnavailableError, системный сбой — должен пробиться наружу, НЕ схлопнуться в
// null (иначе импорт молча отдаёт черновик с пустыми ключами ответов).
import { describe, it, expect, vi } from "vitest";

const { WorkerCtor } = vi.hoisted(() => ({
  // `new`-able: an arrow-function vi.fn() can't be invoked as a constructor (throws
  // "is not a constructor" before our body ever runs) — needs `function`, matching how
  // runInWorker actually calls `new Worker(...)`.
  WorkerCtor: vi.fn(function WorkerStub() {
    throw new Error("Worker is not supported in this runtime");
  }),
}));

vi.mock("node:worker_threads", () => ({ Worker: WorkerCtor }));

import { evalDataObject, extractData, extractFunctionTable, WorkerUnavailableError } from "./extract-js";

describe("WorkerUnavailableError — new Worker(...) бросает синхронно", () => {
  it("evalDataObject реджектит WorkerUnavailableError (не глотает в null)", async () => {
    await expect(evalDataObject("{ a: 1 }")).rejects.toThrow(WorkerUnavailableError);
  });

  it("extractData пробрасывает WorkerUnavailableError наружу вместо null", async () => {
    const src = `const correctAnswers = { "1": "A" };`;
    await expect(extractData(src, "correctAnswers")).rejects.toThrow(WorkerUnavailableError);
  });

  it("extractFunctionTable пробрасывает WorkerUnavailableError наружу вместо null", async () => {
    await expect(extractFunctionTable(["function band(r){ return r; }"], "band", 0, 5)).rejects.toThrow(
      WorkerUnavailableError,
    );
  });

  it("сообщение называет worker_threads и несёт исходную причину сборки", async () => {
    await expect(evalDataObject("{ a: 1 }")).rejects.toThrow(
      /worker_threads unavailable.*Worker is not supported in this runtime/,
    );
  });

  it("extractData на объект, которого нет в src, остаётся null (size-gate/поиск не задет)", async () => {
    // Поведение "литерал не найден" не должно превращаться в WorkerUnavailableError —
    // до runInWorker дело не доходит вовсе (regression guard).
    await expect(extractData("const x = {};", "nope")).resolves.toBeNull();
  });
});
