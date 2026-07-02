import { describe, it, expect, vi, afterEach } from "vitest";

// N12: скачивание файлов Bot API получило явный стриминговый size-cap — лимит
// чужого API не барьер. Мокаем @/env (конфиг) и global fetch (стрим-тело).
vi.mock("@/env", () => ({
  telegramConfig: () => ({ token: "t", adminIds: [1], webhookSecret: null }),
}));

import { downloadFileBytes, downloadFileText } from "./client";

const savedFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = savedFetch;
});

function resWithStream(chunks: Uint8Array[], headers: Record<string, string> = {}): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      chunks.forEach((ch) => c.enqueue(ch));
      c.close();
    },
  });
  return {
    ok: true,
    status: 200,
    headers: new Headers(headers),
    body: stream,
  } as unknown as Response;
}

describe("telegram download size-cap (N12)", () => {
  it("бросает на declared content-length больше cap, не читая тело", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      resWithStream([], { "content-length": String(25 * 1024 * 1024) }),
    );
    await expect(downloadFileBytes("f")).rejects.toThrow(/exceeds/);
  });

  it("бросает, когда стрим превышает cap без заголовка", async () => {
    const chunk = new Uint8Array(8 * 1024 * 1024); // 3×8МБ > 20МБ cap
    globalThis.fetch = vi.fn().mockResolvedValue(resWithStream([chunk, chunk, chunk]));
    await expect(downloadFileBytes("f")).rejects.toThrow(/exceeds/);
  });

  it("возвращает байты под капом", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(resWithStream([new Uint8Array([1, 2, 3])]));
    expect(new Uint8Array(await downloadFileBytes("f"))).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("downloadFileText декодирует текст под капом", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      resWithStream([new TextEncoder().encode("<html>ok</html>")]),
    );
    expect(await downloadFileText("f")).toBe("<html>ok</html>");
  });
});
