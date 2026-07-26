import { describe, expect, it } from "vitest";
import {
  parseAudioDuration,
  parseMp3Duration,
  parseMp4Duration,
  probeAudioDuration,
} from "./audio-duration";

/**
 * Синтетические mp3-«головы»: настоящий файл в фикстурах не нужен — парсер читает
 * только битовые поля заголовка кадра и служебные теги, а их проще собрать точно.
 */
function frameHeader(opts: {
  mpeg2?: boolean;
  mono?: boolean;
  bitrateIndex?: number;
  rateIndex?: number;
}): number[] {
  const { mpeg2 = false, mono = false, bitrateIndex = 9, rateIndex = 0 } = opts;
  // sync(11 бит) + version + layer III + protection
  const b1 = mpeg2 ? 0xf3 : 0xfb;
  const b2 = (bitrateIndex << 4) | (rateIndex << 2);
  const b3 = mono ? 0xc0 : 0x00;
  return [0xff, b1, b2, b3];
}

function id3Tag(payloadSize: number): number[] {
  const synchsafe = [
    (payloadSize >> 21) & 0x7f,
    (payloadSize >> 14) & 0x7f,
    (payloadSize >> 7) & 0x7f,
    payloadSize & 0x7f,
  ];
  return [0x49, 0x44, 0x33, 0x03, 0x00, 0x00, ...synchsafe, ...new Array(payloadSize).fill(0)];
}

function withTag(tag: string, frames: number, tagOffsetInFrame: number, framePrefix: number[]) {
  const bytes = [...framePrefix];
  while (bytes.length < framePrefix.length - 4 + tagOffsetInFrame) bytes.push(0);
  bytes.push(...[...tag].map((c) => c.charCodeAt(0)));
  if (tag === "Xing") {
    bytes.push(0, 0, 0, 0x01); // flags: присутствует поле frames
  } else {
    bytes.push(...new Array(10).fill(0)); // VBRI: до поля frames 10 байт служебных
  }
  bytes.push((frames >> 24) & 0xff, (frames >> 16) & 0xff, (frames >> 8) & 0xff, frames & 0xff);
  return new Uint8Array(bytes);
}

describe("parseMp3Duration", () => {
  it("CBR без служебного тега: длительность из битрейта и размера файла", () => {
    const head = new Uint8Array([...frameHeader({}), ...new Array(2000).fill(0)]);
    // 128 kbps → 16000 байт/с; 60 секунд звука.
    const duration = parseMp3Duration(head, 16000 * 60);
    expect(duration?.source).toBe("cbr");
    expect(duration?.seconds).toBeCloseTo(60, 1);
  });

  it("Xing: число кадров важнее размера файла (VBR считается точно)", () => {
    // 1148 кадров × 1152 сэмпла / 44100 Гц ≈ 29.99 с — при этом файл «весит» как 10 минут.
    const head = withTag("Xing", 1148, 36, frameHeader({}));
    const duration = parseMp3Duration(head, 16000 * 600);
    expect(duration?.source).toBe("xing");
    expect(duration?.seconds).toBeCloseTo(29.99, 1);
  });

  it("VBRI распознаётся так же, как Xing", () => {
    const head = withTag("VBRI", 1148, 36, frameHeader({}));
    const duration = parseMp3Duration(head, 16000 * 600);
    expect(duration?.source).toBe("vbri");
    expect(duration?.seconds).toBeCloseTo(29.99, 1);
  });

  it("ID3v2-тег впереди пропускается (иначе кадр не найдётся)", () => {
    const head = new Uint8Array([
      ...id3Tag(300),
      ...frameHeader({}),
      ...new Array(100).fill(0),
    ]);
    const duration = parseMp3Duration(head, 16000 * 60 + 310);
    expect(duration?.source).toBe("cbr");
    expect(duration?.seconds).toBeCloseTo(60, 0);
  });

  it("MPEG2 (576 сэмплов на кадр) считается по своей таблице", () => {
    // MPEG2, 64 kbps (индекс 8), 22050 Гц (индекс 0), моно.
    const head = withTag("Xing", 1000, 4 + 9, frameHeader({ mpeg2: true, mono: true, bitrateIndex: 8 }));
    const duration = parseMp3Duration(head, 999_999);
    expect(duration?.source).toBe("xing");
    expect(duration?.seconds).toBeCloseTo((1000 * 576) / 22050, 2);
  });

  it("мусор без синхрослова → null", () => {
    expect(parseMp3Duration(new Uint8Array(new Array(500).fill(0x41)), 100_000)).toBeNull();
  });

  it("0xFF с невалидными полями не принимается за кадр", () => {
    // sync есть, но bitrateIndex=0 и rateIndex=3 — заведомо мусор.
    const head = new Uint8Array([0xff, 0xfb, 0x0c, 0x00, ...new Array(50).fill(0xff)]);
    expect(parseMp3Duration(head, 100_000)).toBeNull();
  });

  it("пустой буфер → null", () => {
    expect(parseMp3Duration(new Uint8Array(), 0)).toBeNull();
  });

  it("размер файла меньше смещения кадра → null (битые данные не дают отрицательное время)", () => {
    const head = new Uint8Array([...id3Tag(50), ...frameHeader({})]);
    expect(parseMp3Duration(head, 10)).toBeNull();
  });
});

/**
 * MP4/M4A: на проде лежит объект `<uuid>.mp3`, который на самом деле `ftypM4A` (ключ в
 * Storage формируется по content_item, не по типу файла). mp3-парсер выдавал на нём
 * правдоподобные, но неверные 15:50 вместо реальных 6:08 — контейнер обязан
 * определяться по сигнатуре.
 */
function mp4(opts: { timescale: number; duration: number; version?: 0 | 1; moovFirst?: boolean }) {
  const { timescale, duration, version = 0, moovFirst = true } = opts;
  const be32 = (n: number) => [(n >> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
  const tag = (s: string) => [...s].map((c) => c.charCodeAt(0));

  const mvhdPayload =
    version === 1
      ? [version, 0, 0, 0, ...new Array(16).fill(0), ...be32(timescale), ...be32(0), ...be32(duration)]
      : [version, 0, 0, 0, ...new Array(8).fill(0), ...be32(timescale), ...be32(duration)];
  const mvhd = [...be32(mvhdPayload.length + 8), ...tag("mvhd"), ...mvhdPayload];
  const moov = [...be32(mvhd.length + 8), ...tag("moov"), ...mvhd];
  const ftyp = [...be32(24), ...tag("ftyp"), ...tag("M4A "), ...new Array(12).fill(0)];
  const mdat = [...be32(1024), ...tag("mdat"), ...new Array(1016).fill(0)];

  return new Uint8Array(moovFirst ? [...ftyp, ...moov, ...mdat] : [...ftyp, ...mdat, ...moov]);
}

describe("parseMp4Duration (M4A под именем .mp3)", () => {
  it("читает длительность из moov/mvhd", () => {
    // 6:08 = 368 с при timescale 44100.
    const d = parseMp4Duration(mp4({ timescale: 44100, duration: 368 * 44100 }));
    expect(d?.source).toBe("mp4");
    expect(d?.seconds).toBeCloseTo(368, 3);
  });

  it("поддерживает mvhd version 1 (64-битные поля)", () => {
    const d = parseMp4Duration(mp4({ timescale: 1000, duration: 95_000, version: 1 }));
    expect(d?.seconds).toBeCloseTo(95, 3);
  });

  it("роутинг по сигнатуре: mp3-ветка на MP4 не запускается", () => {
    const buf = mp4({ timescale: 44100, duration: 368 * 44100 });
    // Именно эта подмена и давала на проде 15:50 вместо 6:08.
    expect(parseAudioDuration(buf, buf.byteLength)?.source).toBe("mp4");
  });

  it("mp3 остаётся mp3 (роутинг не ломает основной формат)", () => {
    const head = new Uint8Array([...frameHeader({}), ...new Array(2000).fill(0)]);
    expect(parseAudioDuration(head, 16000 * 60)?.source).toBe("cbr");
  });

  it("нет moov в переданном куске → null (решение за вызывающим)", () => {
    const buf = mp4({ timescale: 1000, duration: 5000, moovFirst: false });
    expect(parseMp4Duration(buf.slice(0, 40))).toBeNull();
  });
});

describe("probeAudioDuration", () => {
  const body = new Uint8Array([...frameHeader({}), ...new Array(2000).fill(0)]);

  it("206 + Content-Range: полный размер берётся из заголовка, не из тела", async () => {
    const fetchImpl = (async () =>
      new Response(body, {
        status: 206,
        headers: { "content-range": `bytes 0-2003/${16000 * 60}` },
      })) as unknown as typeof fetch;
    const duration = await probeAudioDuration("https://x/y.mp3", fetchImpl);
    expect(duration?.seconds).toBeCloseTo(60, 1);
  });

  it("сервер проигнорировал Range (200): считаем по длине тела", async () => {
    const fetchImpl = (async () => new Response(body, { status: 200 })) as unknown as typeof fetch;
    const duration = await probeAudioDuration("https://x/y.mp3", fetchImpl);
    expect(duration?.source).toBe("cbr");
    expect(duration?.seconds).toBeCloseTo(2004 / 16000, 2);
  });

  it("ошибка ответа → null (вызывающий решает, что делать)", async () => {
    const fetchImpl = (async () => new Response("no", { status: 404 })) as unknown as typeof fetch;
    expect(await probeAudioDuration("https://x/y.mp3", fetchImpl)).toBeNull();
  });

  it("MP4 без faststart: moov в конце — дочитывает хвост вторым Range", async () => {
    const full = mp4({ timescale: 1000, duration: 368_000, moovFirst: false });
    const headSlice = full.slice(0, 60); // ftyp + начало mdat, moov не попал
    const ranges: string[] = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      ranges.push(new Headers(init?.headers).get("range") ?? "");
      // Первый запрос — «голова» без moov, второй (хвостовой) отдаёт остаток файла.
      const isTail = ranges.length > 1;
      return new Response(isTail ? full.slice(60) : headSlice, {
        status: 206,
        headers: { "content-range": `bytes 0-59/${full.byteLength}` },
      });
    }) as unknown as typeof fetch;

    const d = await probeAudioDuration("https://x/y.mp3", fetchImpl);
    expect(d?.source).toBe("mp4");
    expect(d?.seconds).toBeCloseTo(368, 1);
    expect(ranges).toHaveLength(2); // голова, затем хвост
  });

  it("запрашивает только начало файла, а не весь объект", async () => {
    let seenRange: string | null = null;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      seenRange = new Headers(init?.headers).get("range");
      return new Response(body, { status: 206, headers: { "content-range": "bytes 0-2003/960000" } });
    }) as unknown as typeof fetch;
    await probeAudioDuration("https://x/y.mp3", fetchImpl);
    expect(seenRange).toBe("bytes=0-262143");
  });
});
