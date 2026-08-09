/**
 * Длительность mp3 по заголовку — детерминированно, без внешних зависимостей
 * (пайплайн импорта LLM-free и dependency-free по BRIEF §4.2).
 *
 * Зачем: publish-гейт проверял у listening только НАЛИЧИЕ дорожки. Смоук 2026-07-26
 * нашёл 4 опубликованных теста, где к 40 вопросам приложены 6–16 минут звука вместо 30
 * (клиент присылает аудио частями P1–P4, привязывалась только первая) — части 2–4 были
 * непроходимы. Размер файла как прокси не годится: 10.9 МБ оказались 6 минутами в 240 kbps,
 * а 5.1 МБ — 16 минутами в 41 kbps.
 *
 * Три источника длительности, по убыванию точности:
 *  1. Xing/Info — число фреймов пишет сам кодер (точен и для VBR);
 *  2. VBRI (Fraunhofer) — то же поле в другом формате;
 *  3. CBR-оценка — (размер потока × 8) / битрейт первого фрейма. Для VBR без служебного
 *     заголовка даёт погрешность, поэтому вызывающий код сравнивает с порогом, а не с
 *     точным значением.
 */

/** Layer III: MPEG1 и MPEG2/2.5 имеют разные таблицы битрейтов (kbps, индекс из заголовка). */
const BITRATES_MPEG1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BITRATES_MPEG2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const SAMPLE_RATES: Record<number, number[]> = {
  3: [44100, 48000, 32000], // MPEG 1
  2: [22050, 24000, 16000], // MPEG 2
  0: [11025, 12000, 8000], // MPEG 2.5
};

export type DurationSource = "xing" | "vbri" | "cbr" | "mp4";

export interface AudioDuration {
  seconds: number;
  source: DurationSource;
}

interface FrameHeader {
  offset: number;
  versionId: number;
  bitrateKbps: number;
  sampleRate: number;
  isMono: boolean;
  samplesPerFrame: number;
}

/** ID3v2-тег стоит перед аудио и его размер закодирован synchsafe (по 7 бит на байт). */
function audioStartOffset(buf: Uint8Array): number {
  if (buf.length < 10) return 0;
  if (buf[0] !== 0x49 || buf[1] !== 0x44 || buf[2] !== 0x33) return 0; // "ID3"
  const size =
    ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
  const footer = (buf[5] & 0x10) !== 0 ? 10 : 0;
  return 10 + size + footer;
}

/**
 * Первый валидный кадр Layer III. Мусорный байт 0xFF встречается в тегах и обложках,
 * поэтому мало найти синхрослово — проверяем все поля заголовка на осмысленность.
 */
function findFrameHeader(buf: Uint8Array, from: number): FrameHeader | null {
  for (let i = Math.max(0, from); i + 4 <= buf.length; i++) {
    if (buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) continue;

    const versionId = (buf[i + 1] >> 3) & 0x03; // 3=MPEG1, 2=MPEG2, 0=MPEG2.5, 1=reserved
    const layerBits = (buf[i + 1] >> 1) & 0x03; // 1 = Layer III
    const bitrateIndex = (buf[i + 2] >> 4) & 0x0f;
    const rateIndex = (buf[i + 2] >> 2) & 0x03;
    const channelMode = (buf[i + 3] >> 6) & 0x03; // 3 = mono

    if (versionId === 1 || layerBits !== 1) continue;
    if (bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) continue;

    const table = versionId === 3 ? BITRATES_MPEG1_L3 : BITRATES_MPEG2_L3;
    const sampleRate = SAMPLE_RATES[versionId]?.[rateIndex];
    const bitrateKbps = table[bitrateIndex];
    if (!sampleRate || !bitrateKbps) continue;

    return {
      offset: i,
      versionId,
      bitrateKbps,
      sampleRate,
      isMono: channelMode === 3,
      // Layer III: MPEG1 кодирует 1152 сэмпла на кадр, MPEG2/2.5 — вдвое меньше.
      samplesPerFrame: versionId === 3 ? 1152 : 576,
    };
  }
  return null;
}

function readUint32BE(buf: Uint8Array, at: number): number | null {
  if (at + 4 > buf.length) return null;
  return ((buf[at] << 24) >>> 0) + (buf[at + 1] << 16) + (buf[at + 2] << 8) + buf[at + 3];
}

function matchesTag(buf: Uint8Array, at: number, tag: string): boolean {
  if (at + tag.length > buf.length) return false;
  for (let i = 0; i < tag.length; i++) if (buf[at + i] !== tag.charCodeAt(i)) return false;
  return true;
}

/** Число кадров из Xing/Info (side-info пропускается, его длина зависит от версии и каналов). */
function framesFromXing(buf: Uint8Array, frame: FrameHeader): number | null {
  const sideInfo = frame.versionId === 3 ? (frame.isMono ? 17 : 32) : frame.isMono ? 9 : 17;
  const tagAt = frame.offset + 4 + sideInfo;
  if (!matchesTag(buf, tagAt, "Xing") && !matchesTag(buf, tagAt, "Info")) return null;
  const flags = readUint32BE(buf, tagAt + 4);
  if (flags == null || (flags & 0x01) === 0) return null; // бит frames не выставлен
  return readUint32BE(buf, tagAt + 8);
}

/** VBRI всегда лежит на фиксированном смещении 32 байта после заголовка кадра. */
function framesFromVbri(buf: Uint8Array, frame: FrameHeader): number | null {
  const tagAt = frame.offset + 4 + 32;
  if (!matchesTag(buf, tagAt, "VBRI")) return null;
  return readUint32BE(buf, tagAt + 14);
}

/**
 * Длительность из «головы» файла. `totalBytes` — полный размер объекта (заголовка
 * достаточно для Xing/VBRI, но CBR-ветке нужен размер всего потока).
 */
export function parseMp3Duration(head: Uint8Array, totalBytes: number): AudioDuration | null {
  const frame = findFrameHeader(head, audioStartOffset(head));
  if (!frame) return null;

  for (const [source, frames] of [
    ["xing", framesFromXing(head, frame)],
    ["vbri", framesFromVbri(head, frame)],
  ] as const) {
    if (frames != null && frames > 0) {
      return { seconds: (frames * frame.samplesPerFrame) / frame.sampleRate, source };
    }
  }

  const streamBytes = totalBytes - frame.offset;
  if (streamBytes <= 0) return null;
  return { seconds: (streamBytes * 8) / (frame.bitrateKbps * 1000), source: "cbr" };
}

/* -------------------------------------------------------------------------- */
/* MP4 / M4A                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Телеграм отдаёт голосовые и часть аудио в MP4-контейнере, а пайплайн сохраняет объект
 * с расширением `.mp3` (ключ формируется по content_item, не по типу) — на проде такой
 * файл реально лежит. Для mp3-парсера это мусор: он находит случайные псевдо-кадры и
 * выдаёт правдоподобное, но неверное число. Поэтому контейнер определяется по сигнатуре.
 */
function isMp4(buf: Uint8Array): boolean {
  return matchesTag(buf, 4, "ftyp");
}

interface Box {
  payloadStart: number;
  payloadEnd: number;
}

/** Поиск бокса нужного типа среди соседей на одном уровне (size=1 → 64-битный размер). */
function findBox(buf: Uint8Array, start: number, end: number, type: string): Box | null {
  let at = start;
  while (at + 8 <= end) {
    const size32 = readUint32BE(buf, at);
    if (size32 == null) return null;
    let headerSize = 8;
    let size = size32;
    if (size32 === 1) {
      // 64-битный размер: старшие 4 байта для наших файлов всегда 0.
      const low = readUint32BE(buf, at + 12);
      if (low == null) return null;
      size = low;
      headerSize = 16;
    } else if (size32 === 0) {
      size = end - at; // бокс до конца файла
    }
    if (size < headerSize) return null;
    if (matchesTag(buf, at + 4, type)) {
      return { payloadStart: at + headerSize, payloadEnd: Math.min(at + size, end) };
    }
    at += size;
  }
  return null;
}

/**
 * Прямой поиск сигнатуры бокса — для буферов, которые начинаются НЕ с границы бокса.
 * Так выглядит хвостовой Range у файла без faststart: обход с нулевого смещения там
 * прочитал бы случайные байты середины mdat как заголовок.
 */
function scanForBox(buf: Uint8Array, type: string): Box | null {
  for (let i = 4; i + 8 <= buf.length; i++) {
    if (!matchesTag(buf, i, type)) continue;
    const size = readUint32BE(buf, i - 4);
    if (size == null || size < 8) continue;
    return { payloadStart: i + 4, payloadEnd: Math.min(i - 4 + size, buf.length) };
  }
  return null;
}

/** Длительность из moov/mvhd: duration в единицах timescale. */
export function parseMp4Duration(buf: Uint8Array): AudioDuration | null {
  const moov = findBox(buf, 0, buf.length, "moov") ?? scanForBox(buf, "moov");
  if (!moov) return null;
  const mvhd =
    findBox(buf, moov.payloadStart, moov.payloadEnd, "mvhd") ?? scanForBox(buf, "mvhd");
  if (!mvhd) return null;

  const version = buf[mvhd.payloadStart];
  // version 0: creation(4) modification(4) timescale(4) duration(4)
  // version 1: creation(8) modification(8) timescale(4) duration(8)
  const base = mvhd.payloadStart + 4; // version + flags
  const timescale = readUint32BE(buf, version === 1 ? base + 16 : base + 8);
  const duration =
    version === 1
      ? readUint32BE(buf, base + 20 + 4) // младшие 32 бита 64-битного поля
      : readUint32BE(buf, base + 12);

  if (!timescale || duration == null || duration <= 0) return null;
  return { seconds: duration / timescale, source: "mp4" };
}

/** Хвост «головы» файла, которого хватает на ID3-тег с обложкой + служебный кадр. */
const AUDIO_HEAD_BYTES = 256 * 1024;

/** Единая точка входа: контейнер определяется по сигнатуре, а не по расширению. */
export function parseAudioDuration(head: Uint8Array, totalBytes: number): AudioDuration | null {
  return isMp4(head) ? parseMp4Duration(head) : parseMp3Duration(head, totalBytes);
}

/**
 * Длительность удалённой дорожки без скачивания целиком: Range-запросом берём только
 * начало (у 30-минутного файла это ~1%). Сервер вправе проигнорировать Range и отдать
 * 200 — тогда работаем с тем, что пришло.
 */
export async function probeAudioDuration(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AudioDuration | null> {
  const res = await fetchImpl(url, { headers: { Range: `bytes=0-${AUDIO_HEAD_BYTES - 1}` } });
  if (!res.ok) return null;

  const head = new Uint8Array(await res.arrayBuffer());
  // Полный размер: из Content-Range при 206, иначе тело и есть весь файл.
  const contentRange = res.headers.get("content-range");
  const totalFromRange = contentRange ? Number(contentRange.split("/")[1]) : NaN;
  const totalBytes = Number.isFinite(totalFromRange) ? totalFromRange : head.byteLength;

  const fromHead = parseAudioDuration(head, totalBytes);
  if (fromHead) return fromHead;

  // MP4 без faststart держит moov в конце файла — в «голове» его нет. Дочитываем хвост
  // тем же дешёвым Range вместо скачивания всего объекта.
  if (isMp4(head) && totalBytes > head.byteLength) {
    const tailStart = Math.max(0, totalBytes - AUDIO_HEAD_BYTES);
    const tail = await fetchImpl(url, { headers: { Range: `bytes=${tailStart}-${totalBytes - 1}` } });
    if (tail.ok) return parseMp4Duration(new Uint8Array(await tail.arrayBuffer()));
  }
  return null;
}
