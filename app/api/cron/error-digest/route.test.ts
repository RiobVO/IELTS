import { describe, it, expect, vi, beforeEach } from "vitest";

// error-digest cron (F5): читает error_log за 24ч, шлёт сводку в Telegram владельцу.
// Мокаем @/env (cronSecret + telegramConfig), @/db (select-цепочка), telegram client
// и logError — по образцу writing-reaper/speaking-reaper route-тестов.
const { cronSecretFn, telegramConfigFn, dbSelect, sendMessageFn, logErrorFn } = vi.hoisted(() => ({
  cronSecretFn: vi.fn(),
  telegramConfigFn: vi.fn(),
  dbSelect: vi.fn(),
  sendMessageFn: vi.fn(),
  logErrorFn: vi.fn(),
}));
vi.mock("@/env", () => ({ cronSecret: cronSecretFn, telegramConfig: telegramConfigFn }));
vi.mock("@/db", () => ({ db: { select: (...a: unknown[]) => dbSelect(...a) } }));
vi.mock("@/lib/telegram/client", () => ({ sendMessage: sendMessageFn }));
vi.mock("@/lib/monitoring/log-error", () => ({ logError: logErrorFn }));

import { GET } from "./route";

const authed = () => new Request("http://x/api/cron/error-digest", { headers: { authorization: "Bearer s" } });
const selectChain = (rows: unknown[]) => ({ from: () => ({ where: () => Promise.resolve(rows) }) });

beforeEach(() => {
  [cronSecretFn, telegramConfigFn, dbSelect, sendMessageFn, logErrorFn].forEach((m) => m.mockReset());
  cronSecretFn.mockReturnValue("s");
  telegramConfigFn.mockReturnValue({ token: "t", adminIds: [111, 222], webhookSecret: null });
  sendMessageFn.mockResolvedValue(undefined);
  logErrorFn.mockResolvedValue(undefined);
});

describe("error-digest GET/POST", () => {
  it("401 без валидного Bearer, ничего не читает и не шлёт", async () => {
    const res = await GET(new Request("http://x", { headers: { authorization: "Bearer wrong" } }));
    expect(res.status).toBe(401);
    expect(dbSelect).not.toHaveBeenCalled();
    expect(sendMessageFn).not.toHaveBeenCalled();
  });

  it("skipped, когда Telegram не настроен (нет токена)", async () => {
    telegramConfigFn.mockReturnValue(null);
    const res = await GET(authed());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, skipped: true });
    expect(dbSelect).not.toHaveBeenCalled();
  });

  it("skipped, когда adminIds пуст", async () => {
    telegramConfigFn.mockReturnValue({ token: "t", adminIds: [], webhookSecret: null });
    const res = await GET(authed());
    const body = await res.json();
    expect(body).toEqual({ ok: true, skipped: true });
    expect(dbSelect).not.toHaveBeenCalled();
  });

  it("0 ошибок за 24ч -> sendMessage НЕ вызван (тишина = ок)", async () => {
    dbSelect.mockReturnValue(selectChain([]));
    const res = await GET(authed());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, total: 0 });
    expect(sendMessageFn).not.toHaveBeenCalled();
  });

  it("2 строки -> sendMessage вызван для каждого admin id с текстом, содержащим count", async () => {
    dbSelect.mockReturnValue(
      selectChain([
        { source: "server", message: "saveProgress failed" },
        { source: "client", message: "user typed his email into the error" },
      ]),
    );
    const res = await GET(authed());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, total: 2 });
    expect(sendMessageFn).toHaveBeenCalledTimes(2);
    expect(sendMessageFn).toHaveBeenCalledWith(111, expect.stringContaining("bando errors 24h: 1 server / 1 client"));
    expect(sendMessageFn).toHaveBeenCalledWith(222, expect.stringContaining("bando errors 24h: 1 server / 1 client"));
    // Топ-строки с текстом — только серверные op-сообщения; произвольный клиентский
    // текст (публичный /api/monitoring/client-error, потенциальный PII/мусор) в
    // Telegram не утекает.
    const sent = sendMessageFn.mock.calls[0][1] as string;
    expect(sent).toContain("1x saveProgress failed");
    expect(sent).not.toContain("user typed his email");
  });

  it("только client-ошибки -> заголовок со счётчиком, без текстовых топ-строк", async () => {
    dbSelect.mockReturnValue(
      selectChain([
        { source: "client", message: "raw client text A" },
        { source: "client", message: "raw client text B" },
      ]),
    );
    await GET(authed());
    const sent = sendMessageFn.mock.calls[0][1] as string;
    expect(sent).toBe("bando errors 24h: 0 server / 2 client");
  });

  it("500 + logError, когда чтение error_log падает", async () => {
    dbSelect.mockImplementation(() => {
      throw new Error("db down");
    });
    const res = await GET(authed());
    expect(res.status).toBe(500);
    expect(logErrorFn).toHaveBeenCalledOnce();
    expect(sendMessageFn).not.toHaveBeenCalled();
  });
});
