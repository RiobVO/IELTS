import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

// #3 SSRF: the <audio src> comes from third-party HTML and lands in a PUBLIC bucket.
// isPublicIp is the core guard; fetchExternalAudio wires it + scheme/type/size checks.
// N2: соединение обязано идти на ПРОВАЛИДИРОВАННЫЕ адреса (pinned lookup), а не на
// повторный системный резолв — иначе low-TTL домен ребайндится между проверкой и fetch.
const { lookupFn, requestMock } = vi.hoisted(() => ({ lookupFn: vi.fn(), requestMock: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: lookupFn }));
vi.mock("node:http", () => ({ request: requestMock }));
vi.mock("node:https", () => ({ request: requestMock }));

import { isPublicIp, fetchExternalAudio } from "./safe-audio-fetch";

describe("isPublicIp", () => {
  it("blocks the SSRF-critical IPv4 ranges", () => {
    for (const ip of [
      "169.254.169.254", // cloud metadata
      "127.0.0.1", "0.0.0.0",
      "10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.1",
      "100.64.0.1", // CGNAT
      "224.0.0.1", "255.255.255.255",
    ]) {
      expect(isPublicIp(ip), ip).toBe(false);
    }
  });

  it("allows genuine public IPv4", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.15.0.1", "172.32.0.1", "93.184.216.34"]) {
      expect(isPublicIp(ip), ip).toBe(true);
    }
  });

  it("blocks non-public IPv6 (loopback / ULA / link-local / multicast / mapped)", () => {
    for (const ip of ["::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1", "::ffff:127.0.0.1"]) {
      expect(isPublicIp(ip), ip).toBe(false);
    }
  });

  it("allows public IPv6 (incl. IPv4-mapped public)", () => {
    expect(isPublicIp("2001:4860:4860::8888")).toBe(true);
    expect(isPublicIp("::ffff:8.8.8.8")).toBe(true);
  });

  it("rejects garbage as non-public", () => {
    expect(isPublicIp("not-an-ip")).toBe(false);
    expect(isPublicIp("999.1.1.1")).toBe(false);
  });
});

describe("fetchExternalAudio", () => {
  beforeEach(() => {
    lookupFn.mockReset();
    requestMock.mockReset();
  });

  type ResInit = { status?: number; ct?: string; len?: string; bytes?: number[]; location?: string };

  /** Фейковый node:http(s).request: последовательность ответов (redirect-цепочки). */
  const armSeq = (inits: ResInit[]) => {
    let call = 0;
    requestMock.mockImplementation((_url: unknown, _opts: unknown, cb: (r: unknown) => void) => {
      const init = inits[Math.min(call++, inits.length - 1)]!;
      const req = Object.assign(new EventEmitter(), {
        end: () => {
          queueMicrotask(() => {
            const res = Object.assign(new EventEmitter(), {
              statusCode: init.status ?? 200,
              headers: {
                ...(init.ct ? { "content-type": init.ct } : {}),
                ...(init.len ? { "content-length": init.len } : {}),
                ...(init.location ? { location: init.location } : {}),
              },
              resume: () => {},
            });
            cb(res);
            queueMicrotask(() => {
              res.emit("data", Buffer.from(init.bytes ?? [1, 2, 3, 4]));
              res.emit("end");
            });
          });
        },
        destroy(this: EventEmitter, err?: Error) {
          if (err) this.emit("error", err);
        },
      });
      return req;
    });
  };
  const arm = (init: ResInit) => armSeq([init]);

  it("rejects a non-http(s) scheme before any network call", async () => {
    await expect(fetchExternalAudio("file:///etc/passwd")).rejects.toThrow(/http\(s\)/);
    expect(lookupFn).not.toHaveBeenCalled();
  });

  it("blocks a host that resolves to a private IP (SSRF)", async () => {
    lookupFn.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);
    arm({ ct: "audio/mpeg" });
    await expect(fetchExternalAudio("http://evil.example/audio.mp3")).rejects.toThrow(/SSRF blocked/);
    expect(requestMock).not.toHaveBeenCalled(); // never reached the request
  });

  it("blocks an IP-literal host in a private range without DNS", async () => {
    await expect(fetchExternalAudio("http://127.0.0.1:6379/")).rejects.toThrow(/SSRF blocked/);
    expect(lookupFn).not.toHaveBeenCalled();
  });

  it("rejects a non-audio content-type", async () => {
    lookupFn.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    arm({ ct: "text/html" });
    await expect(fetchExternalAudio("http://cdn.example/x.mp3")).rejects.toThrow(/not audio/);
  });

  it("rejects an oversized declared content-length (cap 50MiB)", async () => {
    lookupFn.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    arm({ ct: "audio/mpeg", len: String(60 * 1024 * 1024) });
    await expect(fetchExternalAudio("http://cdn.example/x.mp3")).rejects.toThrow(/exceeds/);
  });

  // Handoff 2026-07-02: archive.org/download всегда 302 → ia*.archive.org; глухой
  // отказ от редиректов ронял каждый listening-импорт. Следуем ≤3 хопов, но КАЖДЫЙ
  // хоп проходит полную SSRF-валидацию (резолв → isPublicIp → pinned connect).
  it("следует 302 на публичный хост: оба хопа валидируются, байты приходят", async () => {
    lookupFn.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    armSeq([
      { status: 302, location: "https://ia1.example/f.mp3" },
      { ct: "audio/mpeg", bytes: [7, 7] },
    ]);
    const buf = await fetchExternalAudio("http://cdn.example/x.mp3");
    expect(new Uint8Array(buf)).toEqual(new Uint8Array([7, 7]));
    expect(requestMock).toHaveBeenCalledTimes(2);
    expect(lookupFn).toHaveBeenCalledWith("cdn.example", { all: true });
    expect(lookupFn).toHaveBeenCalledWith("ia1.example", { all: true });
  });

  it("режет 302 на хост с приватным резолвом (rebound-редирект)", async () => {
    lookupFn.mockImplementation(async (host: string) =>
      host === "cdn.example"
        ? [{ address: "93.184.216.34", family: 4 }]
        : [{ address: "169.254.169.254", family: 4 }],
    );
    armSeq([{ status: 302, location: "http://evil.example/meta" }]);
    await expect(fetchExternalAudio("http://cdn.example/x.mp3")).rejects.toThrow(/SSRF blocked/);
    expect(requestMock).toHaveBeenCalledTimes(1); // до второго connect не дошло
  });

  it("обрывает цепочку из >3 редиректов", async () => {
    lookupFn.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    armSeq([{ status: 302, location: "http://cdn.example/loop.mp3" }]);
    await expect(fetchExternalAudio("http://cdn.example/x.mp3")).rejects.toThrow(/redirect/i);
  });

  it("3xx без Location — ошибка, не зависание", async () => {
    lookupFn.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    arm({ status: 302 });
    await expect(fetchExternalAudio("http://cdn.example/x.mp3")).rejects.toThrow(/redirect/i);
  });

  it("returns bytes on a valid public audio response", async () => {
    lookupFn.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    arm({ ct: "audio/mpeg", bytes: [9, 9, 9] });
    const buf = await fetchExternalAudio("http://cdn.example/x.mp3");
    expect(new Uint8Array(buf)).toEqual(new Uint8Array([9, 9, 9]));
  });

  it("пиннит соединение на провалидированные адреса (DNS-rebinding, N2)", async () => {
    lookupFn.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    arm({ ct: "audio/mpeg", bytes: [1] });
    await fetchExternalAudio("http://cdn.example/x.mp3");

    const opts = requestMock.mock.calls[0]![1] as {
      lookup?: (h: string, o: object, cb: (e: unknown, a: unknown, f?: number) => void) => void;
    };
    expect(typeof opts.lookup).toBe("function");

    // Симуляция ребайнда: системный DNS теперь отдал бы metadata-IP, но
    // pinned lookup обязан вернуть адрес, провалидированный ДО соединения,
    // не обращаясь к DNS вообще.
    lookupFn.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);
    lookupFn.mockClear();
    const cb = vi.fn();
    opts.lookup!("cdn.example", {}, cb);
    expect(cb).toHaveBeenCalledWith(null, "93.184.216.34", 4);
    expect(lookupFn).not.toHaveBeenCalled();
  });
});
