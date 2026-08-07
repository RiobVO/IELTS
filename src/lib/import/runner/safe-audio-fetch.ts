/**
 * SSRF-hardened fetch for the <audio src> pulled out of third-party import HTML.
 * The raw src is attacker-influenced (BRIEF: content is third-party), and the bytes
 * land in a PUBLIC Storage bucket — so a naked fetch("http://169.254.169.254/…") or
 * "http://localhost:6379/…" would read an internal endpoint and exfiltrate it.
 *
 * Guards (defence in depth): http(s) only; the host must resolve to a PUBLIC address
 * (blocks metadata IP, loopback, RFC1918, CGNAT, link-local, ULA, multicast, reserved);
 * redirects are refused (no public→internal bounce); a request timeout; a streaming
 * size cap; and a content-type check. SERVER-ONLY (uses node:dns / node:net).
 *
 * N2 (AUDIT_2026-07-02): резолв и соединение — ОДИН lookup. fetch() делал бы свой
 * повторный резолв после валидации, и low-TTL домен успевал бы ребайндиться на
 * внутренний адрес (TOCTOU). Поэтому запрос идёт через node:http(s) с pinned
 * lookup: сокет коннектится строго на проверенные адреса; TLS SNI/cert остаются
 * на исходный hostname (host в URL не подменяется).
 */
import { lookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

// Полный listening-mp3 (30-40 мин на 128kbps) ≈ 30-40 МБ — прежний cap 30 МБ резал
// легитимные файлы (handoff 2026-07-02). Таймауты раздельные: 20с до заголовков
// (connect+redirect), но тело качается дольше — archive.org отдаёт ~0.5-2 МБ/с,
// 30-40 МБ не влезали в единый 20с-таймаут (второй слой того же handoff-фейла).
const MAX_AUDIO_BYTES = 50 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
// 180с: archive.org троттлит поток (~0.2-1 МБ/с наблюдаемо); 28-40 МБ должны
// успевать и на медленном линке. Vercel Fluid (ON) допускает до 300с на функцию.
const BODY_TIMEOUT_MS = 180_000;
// archive.org/download (основной источник listening-аудио) всегда отвечает 302 на
// ia*.archive.org — глухой отказ от редиректов ронял каждый listening-импорт.
// Следуем ограниченно; КАЖДЫЙ хоп проходит полную SSRF-валидацию + пиннинг.
const MAX_REDIRECTS = 3;

function ipv4Octets(ip: string): number[] | null {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const o = m.slice(1).map(Number);
  return o.some((n) => n > 255) ? null : o;
}

function isPublicIpv4(o: number[]): boolean {
  const [a, b, c] = o;
  if (a === 0) return false; // 0.0.0.0/8 "this host"
  if (a === 10) return false; // 10/8 private
  if (a === 127) return false; // loopback
  if (a === 100 && b >= 64 && b <= 127) return false; // 100.64/10 CGNAT
  if (a === 169 && b === 254) return false; // link-local (169.254.169.254 metadata)
  if (a === 172 && b >= 16 && b <= 31) return false; // 172.16/12 private
  if (a === 192 && b === 168) return false; // 192.168/16 private
  if (a === 192 && b === 0 && c === 0) return false; // 192.0.0/24 IETF
  if (a === 192 && b === 0 && c === 2) return false; // TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return false; // 198.18/15 benchmark
  if (a === 198 && b === 51 && c === 100) return false; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return false; // TEST-NET-3
  if (a >= 224) return false; // 224/4 multicast + 240/4 reserved + 255.255.255.255
  return true;
}

function isPublicIpv6(ip: string): boolean {
  let addr = ip.toLowerCase();
  const pct = addr.indexOf("%");
  if (pct >= 0) addr = addr.slice(0, pct); // strip zone id
  const mapped = addr.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/); // IPv4-mapped
  if (mapped) {
    const o = ipv4Octets(mapped[1]);
    return !!o && isPublicIpv4(o);
  }
  if (addr === "::1" || addr === "::") return false; // loopback / unspecified
  const first = addr.startsWith("::") ? 0 : parseInt(addr.split(":")[0], 16);
  if (Number.isNaN(first)) return false; // malformed → reject
  if (first >= 0xfc00 && first <= 0xfdff) return false; // fc00::/7 ULA
  if (first >= 0xfe80 && first <= 0xfebf) return false; // fe80::/10 link-local
  if (first >= 0xff00) return false; // ff00::/8 multicast
  return true;
}

/** True only for a globally-routable public unicast address. Unrecognized → false. */
export function isPublicIp(ip: string): boolean {
  const v4 = ipv4Octets(ip);
  if (v4) return isPublicIpv4(v4);
  if (ip.includes(":")) return isPublicIpv6(ip);
  return false;
}

/** Lookup-замена для net/tls: отдаёт ТОЛЬКО провалидированные адреса, DNS не зовёт. */
function pinnedLookup(addrs: LookupAddress[]) {
  return (
    _hostname: string,
    options: { all?: boolean },
    cb: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
  ): void => {
    if (options.all) cb(null, addrs);
    else cb(null, addrs[0]!.address, addrs[0]!.family);
  };
}

function parseHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Audio src is not a valid URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Audio src must be http(s), got ${url.protocol}`);
  }
  return url;
}

/** Резолв хоста; отказ, если ЛЮБОЙ из адресов непубличный. Вызывается на каждый хоп. */
async function resolvePublicAddrs(url: URL): Promise<LookupAddress[]> {
  const host = url.hostname.replace(/^\[|\]$/g, ""); // strip IPv6 brackets
  const family = isIP(host);
  const resolved: LookupAddress[] = family !== 0
    ? [{ address: host, family }]
    : await lookup(host, { all: true });
  if (!resolved.length) throw new Error(`Audio host does not resolve: ${host}`);
  for (const a of resolved) {
    if (!isPublicIp(a.address)) {
      throw new Error(`Audio host resolves to a non-public address (SSRF blocked): ${host} -> ${a.address}`);
    }
  }
  return resolved;
}

type HopOutcome = { kind: "redirect"; location: string } | { kind: "body"; buf: ArrayBuffer };

/** Один pinned-запрос: 3xx+Location наверх (валидация хопа — у вызывающего), 2xx — тело. */
function requestHop(url: URL, resolved: LookupAddress[]): Promise<HopOutcome> {
  const doRequest = url.protocol === "https:" ? httpsRequest : httpRequest;
  let timer: NodeJS.Timeout | undefined;
  const hop = new Promise<HopOutcome>((resolve, reject) => {
    const req = doRequest(url, { lookup: pinnedLookup(resolved) }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400) {
        const location = res.headers["location"];
        res.resume();
        if (typeof location === "string" && location) {
          return resolve({ kind: "redirect", location });
        }
        return reject(new Error(`Audio fetch redirect without Location (${status}): ${url}`));
      }
      if (status < 200 || status >= 300) {
        res.resume();
        return reject(new Error(`Audio fetch failed: ${status} ${url}`));
      }
      const ct = String(res.headers["content-type"] ?? "").toLowerCase();
      if (!ct.startsWith("audio/") && !ct.startsWith("application/octet-stream")) {
        res.resume();
        return reject(new Error(`Audio src is not audio (content-type: ${ct || "none"})`));
      }
      const declared = Number(res.headers["content-length"]);
      if (Number.isFinite(declared) && declared > MAX_AUDIO_BYTES) {
        res.resume();
        return reject(new Error(`Audio exceeds ${MAX_AUDIO_BYTES} bytes (declared ${declared})`));
      }
      // Заголовки пришли, статус 2xx — переключаем жёсткий 20с-таймаут на body-таймаут:
      // скачивание 30-40 МБ с archive.org занимает десятки секунд и больше.
      clearTimeout(timer);
      timer = setTimeout(
        () => req.destroy(new Error(`Audio body timed out after ${BODY_TIMEOUT_MS}ms`)),
        BODY_TIMEOUT_MS,
      );
      const chunks: Buffer[] = [];
      let total = 0;
      res.on("data", (c: Buffer) => {
        total += c.byteLength;
        if (total > MAX_AUDIO_BYTES) {
          req.destroy(new Error(`Audio exceeds ${MAX_AUDIO_BYTES} bytes`));
          return;
        }
        chunks.push(c);
      });
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        const out = new ArrayBuffer(buf.byteLength);
        new Uint8Array(out).set(buf);
        resolve({ kind: "body", buf: out });
      });
      res.on("error", reject);
    });
    req.on("error", reject);
    // Жёсткий per-hop таймаут (не idle): медленный дриппинг тоже обрывается.
    timer = setTimeout(() => req.destroy(new Error(`Audio fetch timed out after ${TIMEOUT_MS}ms`)), TIMEOUT_MS);
    req.end();
  });
  return hop.finally(() => clearTimeout(timer));
}

/** Fetch external audio with SSRF + size + type guards. Throws on any violation. */
export async function fetchExternalAudio(rawUrl: string): Promise<ArrayBuffer> {
  let url = parseHttpUrl(rawUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const resolved = await resolvePublicAddrs(url);
    const out = await requestHop(url, resolved);
    if (out.kind === "body") return out.buf;
    // Location может быть относительным; новый URL проходит тот же полный цикл
    // (протокол → резолв → isPublicIp → pinned connect) на следующей итерации.
    url = parseHttpUrl(new URL(out.location, url).toString());
  }
  throw new Error(`Audio fetch exceeded ${MAX_REDIRECTS} redirects: ${rawUrl}`);
}
