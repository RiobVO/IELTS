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
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const MAX_AUDIO_BYTES = 30 * 1024 * 1024;
const TIMEOUT_MS = 20_000;

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

async function readCapped(res: Response, max: number): Promise<ArrayBuffer> {
  const reader = res.body?.getReader();
  if (!reader) {
    const buf = await res.arrayBuffer();
    if (buf.byteLength > max) throw new Error(`Audio exceeds ${max} bytes`);
    return buf;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw new Error(`Audio exceeds ${max} bytes`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out.buffer;
}

/** Fetch external audio with SSRF + size + type guards. Throws on any violation. */
export async function fetchExternalAudio(rawUrl: string): Promise<ArrayBuffer> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Audio src is not a valid URL: ${rawUrl}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Audio src must be http(s), got ${url.protocol}`);
  }

  // Resolve the host and refuse if it (or ANY resolved address) is non-public.
  const host = url.hostname.replace(/^\[|\]$/g, ""); // strip IPv6 brackets
  const addrs = isIP(host) !== 0
    ? [host]
    : (await lookup(host, { all: true })).map((a) => a.address);
  if (!addrs.length) throw new Error(`Audio host does not resolve: ${host}`);
  for (const a of addrs) {
    if (!isPublicIp(a)) {
      throw new Error(`Audio host resolves to a non-public address (SSRF blocked): ${host} -> ${a}`);
    }
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: "error" });
    if (!res.ok) throw new Error(`Audio fetch failed: ${res.status} ${url}`);
    const ct = (res.headers.get("content-type") ?? "").toLowerCase();
    if (!ct.startsWith("audio/") && !ct.startsWith("application/octet-stream")) {
      throw new Error(`Audio src is not audio (content-type: ${ct || "none"})`);
    }
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_AUDIO_BYTES) {
      throw new Error(`Audio exceeds ${MAX_AUDIO_BYTES} bytes (declared ${declared})`);
    }
    return await readCapped(res, MAX_AUDIO_BYTES);
  } finally {
    clearTimeout(timer);
  }
}
