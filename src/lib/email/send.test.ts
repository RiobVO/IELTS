import { describe, it, expect, vi, afterEach } from "vitest";
import { sendEmail } from "./send";

const cfg = { apiKey: "test-key", from: "noreply@example.com", fromName: "IELTS Prep" };
const msg = { to: "user@example.com", subject: "Subj", html: "<p>hi</p>" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sendEmail", () => {
  it("2xx -> true и корректная форма запроса", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const ok = await sendEmail(cfg, msg);
    expect(ok).toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      "api-key": "test-key",
      "content-type": "application/json",
      accept: "application/json",
    });
    const body = JSON.parse(init.body as string);
    expect(body.sender).toEqual({ email: "noreply@example.com", name: "IELTS Prep" });
    expect(body.to).toEqual([{ email: "user@example.com" }]);
    expect(body.subject).toBe("Subj");
    expect(body.htmlContent).toBe("<p>hi</p>");
    expect(body.headers).toBeUndefined();
  });

  it("unsubscribeUrl задан -> List-Unsubscribe заголовки в теле", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    await sendEmail(cfg, { ...msg, unsubscribeUrl: "https://example.com/u?t=abc" });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.headers).toEqual({
      "List-Unsubscribe": "<https://example.com/u?t=abc>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });

  it("unsubscribeUrl отсутствует -> заголовков List-Unsubscribe нет", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    await sendEmail(cfg, { ...msg, unsubscribeUrl: null });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.headers).toBeUndefined();
  });

  it("не-2xx -> false, без throw", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendEmail(cfg, msg)).resolves.toBe(false);
  });

  it("fetch reject (сетевая ошибка) -> false, без throw", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendEmail(cfg, msg)).resolves.toBe(false);
  });
});
