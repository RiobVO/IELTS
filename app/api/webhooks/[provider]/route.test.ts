import { describe, it, expect, vi, beforeEach } from "vitest";

// Юнит-тесты волны 0a (платёжные инварианты) на webhook-роут (BRIEF §4.8/§11).
// Мок-паттерн — эталон app/api/telegram/webhook/route.test.ts: реальные Request,
// vi.hoisted для моков верхнего уровня, POST зовётся с тем же ctx-контрактом,
// что Next.js передаёт route-хендлеру. Мокаем ТОЛЬКО @/lib/payments
// (verifyWebhook/applyCompletedPayment) — @/lib/payments/plans и @/env route.ts
// импортирует исключительно как `import type`, эти импорты стираются на
// рантайме и мокать их не нужно (реального обращения к модулю нет).
const { verifyWebhookFn, applyFn } = vi.hoisted(() => ({
  verifyWebhookFn: vi.fn(),
  applyFn: vi.fn(),
}));
vi.mock("@/lib/payments", () => ({
  verifyWebhook: (...a: unknown[]) => verifyWebhookFn(...a),
  applyCompletedPayment: (...a: unknown[]) => applyFn(...a),
}));

import { POST } from "./route";

function callPost(provider: string, body: string) {
  const request = new Request(`http://x/api/webhooks/${provider}`, {
    method: "POST",
    body,
  });
  return POST(request, { params: Promise.resolve({ provider }) });
}

beforeEach(() => {
  verifyWebhookFn.mockReset();
  applyFn.mockReset();
});

describe("webhook route — provider validation", () => {
  it("неизвестный provider ('stripe') -> 400, verifyWebhook не вызывается", async () => {
    const res = await callPost("stripe", JSON.stringify({ providerTransactionId: "t1" }));
    expect(res.status).toBe(400);
    expect(verifyWebhookFn).not.toHaveBeenCalled();
  });
});

describe("webhook route — signature check", () => {
  it("verifyWebhook -> false -> 400, applyCompletedPayment не вызывается", async () => {
    verifyWebhookFn.mockResolvedValueOnce(false);
    const res = await callPost("payme", JSON.stringify({ providerTransactionId: "t1" }));
    expect(res.status).toBe(400);
    expect(applyFn).not.toHaveBeenCalled();
  });

  it("verifyWebhook получает РОВНО сырое тело-строку (подпись считается от байтов до парсинга)", async () => {
    verifyWebhookFn.mockResolvedValueOnce(true);
    applyFn.mockResolvedValueOnce("applied");
    // Необычные пробелы/переносы — если бы роут парсил и ре-сериализовал JSON перед
    // передачей в verifyWebhook, эта строка не совпала бы байт-в-байт.
    const rawBody = '{  "providerTransactionId":   "t1"  ,\n"amount":  100  }';
    await callPost("payme", rawBody);
    expect(verifyWebhookFn).toHaveBeenCalledWith("payme", expect.anything(), rawBody);
  });
});

describe("webhook route — JSON parsing", () => {
  it("verifyWebhook -> true, но тело не парсится как JSON -> 400, applyCompletedPayment не вызывается", async () => {
    verifyWebhookFn.mockResolvedValueOnce(true);
    const res = await callPost("payme", "{not valid json");
    expect(res.status).toBe(400);
    expect(applyFn).not.toHaveBeenCalled();
  });
});

describe("webhook route — providerTransactionId presence", () => {
  it("поле отсутствует -> 400, applyCompletedPayment не вызывается", async () => {
    verifyWebhookFn.mockResolvedValueOnce(true);
    const res = await callPost("payme", JSON.stringify({ amount: 100 }));
    expect(res.status).toBe(400);
    expect(applyFn).not.toHaveBeenCalled();
  });

  it("поле — пустая строка -> 400, applyCompletedPayment не вызывается", async () => {
    verifyWebhookFn.mockResolvedValueOnce(true);
    const res = await callPost("payme", JSON.stringify({ providerTransactionId: "" }));
    expect(res.status).toBe(400);
    expect(applyFn).not.toHaveBeenCalled();
  });

  it("поле — число, не строка -> 400, applyCompletedPayment не вызывается", async () => {
    verifyWebhookFn.mockResolvedValueOnce(true);
    const res = await callPost("payme", JSON.stringify({ providerTransactionId: 12345 }));
    expect(res.status).toBe(400);
    expect(applyFn).not.toHaveBeenCalled();
  });
});

describe("webhook route — outcome -> HTTP mapping", () => {
  beforeEach(() => {
    verifyWebhookFn.mockResolvedValue(true);
  });

  it("applied -> 200 {ok:true}", async () => {
    applyFn.mockResolvedValueOnce("applied");
    const res = await callPost("payme", JSON.stringify({ providerTransactionId: "t1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("duplicate -> 200 {ok:true} (идемпотентный ack)", async () => {
    applyFn.mockResolvedValueOnce("duplicate");
    const res = await callPost("payme", JSON.stringify({ providerTransactionId: "t1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("ignored -> 200 {ok:true} (не-completed событие принято без выдачи)", async () => {
    applyFn.mockResolvedValueOnce("ignored");
    const res = await callPost("payme", JSON.stringify({ providerTransactionId: "t1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("not_found -> 400 {ok:false, reason:'not_found'}", async () => {
    applyFn.mockResolvedValueOnce("not_found");
    const res = await callPost("payme", JSON.stringify({ providerTransactionId: "t1" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, reason: "not_found" });
  });

  it("invalid -> 400 {ok:false, reason:'invalid'}", async () => {
    applyFn.mockResolvedValueOnce("invalid");
    const res = await callPost("payme", JSON.stringify({ providerTransactionId: "t1" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, reason: "invalid" });
  });

  it("expired -> 400 {ok:false, reason:'expired'}", async () => {
    applyFn.mockResolvedValueOnce("expired");
    const res = await callPost("payme", JSON.stringify({ providerTransactionId: "t1" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, reason: "expired" });
  });

  it("error -> 500 {ok:false}", async () => {
    applyFn.mockResolvedValueOnce("error");
    const res = await callPost("payme", JSON.stringify({ providerTransactionId: "t1" }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false });
  });
});

describe("webhook route — server-trust (тело вебхука не авторитетно)", () => {
  it("tier/userId/periodMonths из тела НЕ форвардятся в applyCompletedPayment", async () => {
    verifyWebhookFn.mockResolvedValueOnce(true);
    applyFn.mockResolvedValueOnce("applied");
    const body = JSON.stringify({
      providerTransactionId: "t1",
      amount: 4900000,
      currency: "UZS",
      status: "completed",
      tier: "ultra",
      userId: "attacker",
      periodMonths: 99,
    });
    await callPost("payme", body);
    expect(applyFn).toHaveBeenCalledWith("payme", "t1", {
      amount: 4900000,
      currency: "UZS",
      status: "completed",
    });
  });
});

describe("webhook route — claims-санитайзинг (parseClaims)", () => {
  beforeEach(() => {
    verifyWebhookFn.mockResolvedValue(true);
    applyFn.mockResolvedValue("applied");
  });

  it("amount строкой -> отброшен (не integer-число)", async () => {
    await callPost("payme", JSON.stringify({ providerTransactionId: "t1", amount: "100" }));
    expect(applyFn).toHaveBeenCalledWith("payme", "t1", {});
  });

  it("amount 12.5 (не integer) -> отброшен", async () => {
    await callPost("payme", JSON.stringify({ providerTransactionId: "t1", amount: 12.5 }));
    expect(applyFn).toHaveBeenCalledWith("payme", "t1", {});
  });

  it("currency пустой строкой -> отброшена", async () => {
    await callPost(
      "payme",
      JSON.stringify({ providerTransactionId: "t1", amount: 100, currency: "" }),
    );
    expect(applyFn).toHaveBeenCalledWith("payme", "t1", { amount: 100 });
  });

  it("status числом -> отброшен (не строка)", async () => {
    await callPost("payme", JSON.stringify({ providerTransactionId: "t1", status: 1 }));
    expect(applyFn).toHaveBeenCalledWith("payme", "t1", {});
  });

  it("тело только с providerTransactionId -> claims {}", async () => {
    await callPost("payme", JSON.stringify({ providerTransactionId: "t1" }));
    expect(applyFn).toHaveBeenCalledWith("payme", "t1", {});
  });
});
