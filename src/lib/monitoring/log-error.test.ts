import { describe, it, expect, vi, beforeEach } from "vitest";

// logError imports @/db (env-validating) — mock it so the sink logic runs isolated.
const { dbInsert } = vi.hoisted(() => ({ dbInsert: vi.fn() }));
vi.mock("@/db", () => ({ db: { insert: (...a: unknown[]) => dbInsert(...a) } }));
import { logError, stripQuery } from "./log-error";

describe("stripQuery", () => {
  it("срезает query-строку (ref/code/токены не попадают в sink)", () => {
    expect(stripQuery("http://x/app/exam/1?ref=code&x=1")).toBe("http://x/app/exam/1");
  });
  it("null / undefined / пусто → null", () => {
    expect(stripQuery(null)).toBeNull();
    expect(stripQuery(undefined)).toBeNull();
    expect(stripQuery("")).toBeNull();
  });
  it("url без query — как есть", () => {
    expect(stripQuery("http://x/app")).toBe("http://x/app");
  });
});

describe("logError", () => {
  const valuesMock = vi.fn();
  beforeEach(() => {
    dbInsert.mockReset();
    valuesMock.mockReset().mockResolvedValue(undefined);
    dbInsert.mockReturnValue({ values: valuesMock });
    vi.spyOn(console, "error").mockImplementation(() => {}); // логгер шумит намеренно — глушим в тесте
  });
  it("пишет строку со срезанным url", async () => {
    await logError({ source: "server", message: "boom", url: "http://x/a?ref=z" });
    expect(valuesMock).toHaveBeenCalledOnce();
    expect(valuesMock.mock.calls[0]![0]).toMatchObject({ source: "server", message: "boom", url: "http://x/a" });
  });
  it("НЕ бросает, если запись в БД упала (sink не должен ломать вызывающего)", async () => {
    valuesMock.mockRejectedValue(new Error("db down"));
    await expect(logError({ source: "client", message: "x" })).resolves.toBeUndefined();
  });
});
