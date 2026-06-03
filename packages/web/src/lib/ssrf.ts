// SSRF guard for outbound webhook URLs.
//
// Webhook targets are admin-configured and then fetched server-side, so an
// unvalidated URL lets a request reach loopback / private / link-local
// addresses — including the cloud metadata endpoint 169.254.169.254.
//
// Two layers:
//   - validateOutboundUrl  (sync, no network): protocol + reject IP-literal
//     hosts in private/reserved ranges and obvious local hostnames. Used at
//     registration (POST/PATCH) for fast feedback and as a cheap re-check.
//   - assertResolvesToPublic (async): structural check + DNS resolution,
//     rejecting if ANY resolved address is private/reserved. Used by the
//     dispatcher right before each fetch, so it's DNS-rebinding-aware (a
//     hostname that passed registration but now points inward is blocked).

import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

export interface UrlCheck {
  readonly ok: boolean;
  readonly reason?: string;
}

const OK: UrlCheck = { ok: true };
const bad = (reason: string): UrlCheck => ({ ok: false, reason });

// ── IPv4 ────────────────────────────────────────────────────────────────────
function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const octet = Number(p);
    if (octet > 255) return null;
    n = n * 256 + octet;
  }
  return n >>> 0;
}

function isBlockedIpv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return true; // unparseable → treat as unsafe
  const inRange = (base: number, bits: number): boolean =>
    n >>> (32 - bits) === base >>> (32 - bits);
  return (
    inRange(0x00000000, 8) || // 0.0.0.0/8      "this" network
    inRange(0x0a000000, 8) || // 10.0.0.0/8     private
    inRange(0x64400000, 10) || // 100.64.0.0/10  carrier-grade NAT
    inRange(0x7f000000, 8) || // 127.0.0.0/8    loopback
    inRange(0xa9fe0000, 16) || // 169.254.0.0/16 link-local (incl. 169.254.169.254 metadata)
    inRange(0xac100000, 12) || // 172.16.0.0/12  private
    inRange(0xc0000000, 24) || // 192.0.0.0/24   IETF protocol assignments
    inRange(0xc0a80000, 16) || // 192.168.0.0/16 private
    inRange(0xc6120000, 15) || // 198.18.0.0/15  benchmarking
    inRange(0xe0000000, 4) || // 224.0.0.0/4    multicast
    inRange(0xf0000000, 4) // 240.0.0.0/4    reserved + 255.255.255.255
  );
}

// ── IPv6 ────────────────────────────────────────────────────────────────────

// Expand an IPv6 string (any "::" compression, optional trailing dotted-quad
// IPv4) into exactly 8 16-bit groups. Returns null if it doesn't parse.
function expandIpv6(input: string): number[] | null {
  let addr = input;

  // Embedded IPv4 in dotted form (::ffff:1.2.3.4 / ::1.2.3.4): fold the dotted
  // quad into two hex groups so it's handled uniformly with the hex form.
  const lastColon = addr.lastIndexOf(":");
  if (lastColon !== -1 && addr.slice(lastColon + 1).includes(".")) {
    const n = ipv4ToInt(addr.slice(lastColon + 1));
    if (n === null) return null;
    addr =
      addr.slice(0, lastColon + 1) +
      ((n >>> 16) & 0xffff).toString(16) +
      ":" +
      (n & 0xffff).toString(16);
  }

  const halves = addr.split("::");
  if (halves.length > 2) return null;

  const parseGroups = (s: string): number[] | null => {
    if (s === "") return [];
    const out: number[] = [];
    for (const part of s.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
      out.push(parseInt(part, 16));
    }
    return out;
  };

  const head = parseGroups(halves[0] ?? "");
  if (head === null) return null;

  if (halves.length === 2) {
    const tail = parseGroups(halves[1] ?? "");
    if (tail === null) return null;
    const fill = 8 - head.length - tail.length;
    if (fill < 0) return null;
    return [...head, ...new Array<number>(fill).fill(0), ...tail];
  }
  return head.length === 8 ? head : null;
}

function hextetsToIpv4(hi: number, lo: number): string {
  return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
}

function isBlockedIpv6(ip: string): boolean {
  let addr = ip.toLowerCase();
  const zone = addr.indexOf("%");
  if (zone !== -1) addr = addr.slice(0, zone); // strip scope id

  const h = expandIpv6(addr);
  if (h === null || h.length !== 8) return true; // unparseable → unsafe
  const g = (i: number): number => h[i] ?? 0;

  const topZero = g(0) === 0 && g(1) === 0 && g(2) === 0 && g(3) === 0 && g(4) === 0;

  // IPv4-mapped (::ffff:a.b.c.d, incl. hex form ::ffff:7f00:1) — range-check
  // the embedded v4. This is the form an attacker uses to smuggle 127.0.0.1 /
  // 169.254.169.254 / 192.168.x past a naive v6 check.
  if (topZero && g(5) === 0xffff) {
    return isBlockedIpv4(hextetsToIpv4(g(6), g(7)));
  }
  // Unspecified (::), loopback (::1), and deprecated IPv4-compatible (::a.b.c.d).
  if (topZero && g(5) === 0) {
    const low = ((g(6) << 16) | g(7)) >>> 0;
    if (low === 0 || low === 1) return true; // :: or ::1
    return isBlockedIpv4(hextetsToIpv4(g(6), g(7)));
  }

  // Any remaining address with a zero leading hextet lives in the special-use
  // ::/16 space — deprecated, reserved, or a malformed IPv4-mapped variant
  // (e.g. ::ffff:0:7f00:1, 0:ffff::7f00:1) whose 0xffff marker landed off the
  // canonical position. No legitimate public receiver uses these, and we can't
  // soundly decode their intent, so block conservatively. (Genuine public
  // IPv4-mapped addresses like ::ffff:8.8.8.8 were already allowed above.)
  if (g(0) === 0) return true;

  if ((g(0) & 0xfe00) === 0xfc00) return true; // fc00::/7  unique-local
  if ((g(0) & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g(0) & 0xff00) === 0xff00) return true; // ff00::/8  multicast
  return false;
}

/** True if `ip` (v4 or v6 literal) is in a loopback/private/link-local/reserved range. */
export function isBlockedIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isBlockedIpv4(ip);
  if (kind === 6) return isBlockedIpv6(ip);
  return true; // not a valid IP literal → unsafe
}

function hostOf(rawUrl: string): { url: URL; host: string } | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  let host = url.hostname.toLowerCase();
  // WHATWG URL keeps brackets on IPv6 hostnames (e.g. "[::1]").
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  return { url, host };
}

/** Synchronous structural check — no DNS. */
export function validateOutboundUrl(rawUrl: string): UrlCheck {
  const parsed = hostOf(rawUrl);
  if (!parsed) return bad("not a valid URL");
  const { url, host } = parsed;

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return bad("URL must use http:// or https://");
  }
  if (host === "localhost" || host === "localhost." || host.endsWith(".localhost")) {
    return bad("URL host is localhost");
  }
  if (host.endsWith(".local") || host.endsWith(".local.")) {
    return bad("URL host is a .local (mDNS) name");
  }
  // IP-literal host: range-check it directly.
  if (isIP(host) !== 0 && isBlockedIp(host)) {
    return bad(`URL host ${host} is in a private/reserved range`);
  }
  return OK;
}

/**
 * Structural check + DNS resolution. Rejects if the host resolves to any
 * private/reserved address. On DNS failure we do NOT block — the real fetch
 * will surface the error rather than us masking a transient lookup failure as
 * an SSRF block.
 */
export async function assertResolvesToPublic(rawUrl: string): Promise<UrlCheck> {
  const structural = validateOutboundUrl(rawUrl);
  if (!structural.ok) return structural;

  const parsed = hostOf(rawUrl);
  if (!parsed) return bad("not a valid URL");
  const { host } = parsed;

  // IP-literal hosts were already range-checked structurally.
  if (isIP(host) !== 0) return OK;

  let addresses: ReadonlyArray<{ address: string }>;
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    return OK; // let the fetch fail naturally on a genuine DNS error
  }
  for (const { address } of addresses) {
    if (isBlockedIp(address)) {
      return bad(
        `URL host ${host} resolves to a private/reserved address (${address})`,
      );
    }
  }
  return OK;
}
