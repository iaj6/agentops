import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));
import { lookup } from "node:dns/promises";
import { isBlockedIp, validateOutboundUrl, assertResolvesToPublic } from "@/lib/ssrf";

const mockLookup = vi.mocked(lookup);
beforeEach(() => mockLookup.mockReset());

describe("isBlockedIp", () => {
  it.each([
    "0.0.0.0",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254", // cloud metadata
    "172.16.5.4",
    "172.31.255.255",
    "192.168.1.1",
    "198.18.0.1",
  ])("blocks private/reserved IPv4 %s", (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });

  it.each(["8.8.8.8", "93.184.216.34", "1.1.1.1", "172.32.0.1"])(
    "allows public IPv4 %s",
    (ip) => {
      expect(isBlockedIp(ip)).toBe(false);
    },
  );

  it.each([
    "::1",
    "::",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "fe80::1%eth0", // with zone id
    "::ffff:127.0.0.1", // IPv4-mapped, dotted form
    "::ffff:7f00:1", // IPv4-mapped 127.0.0.1, HEX form (the bypass)
    "::ffff:a9fe:a9fe", // IPv4-mapped 169.254.169.254 metadata, hex form
    "::ffff:c0a8:101", // IPv4-mapped 192.168.1.1, hex form
    "::ffff:192.168.1.1", // IPv4-mapped private, dotted
    "0:0:0:0:0:ffff:7f00:1", // fully-expanded IPv4-mapped loopback
    "::127.0.0.1", // deprecated IPv4-compatible loopback
    // Malformed IPv4-mapped variants (0xffff off the canonical position) and
    // other special-use ::/16 addresses — conservatively blocked.
    "::ffff:0:7f00:1",
    "0:ffff::7f00:1",
    "::ffff:1:7f00:1",
    "::1:0:0:0",
  ])("blocks private/reserved IPv6 %s", (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });

  it.each([
    "2001:4860:4860::8888",
    "2606:4700:4700::1111",
    "::ffff:8.8.8.8", // IPv4-mapped PUBLIC address stays allowed
  ])("allows public IPv6 %s", (ip) => {
    expect(isBlockedIp(ip)).toBe(false);
  });

  it("treats a non-IP string as blocked", () => {
    expect(isBlockedIp("not-an-ip")).toBe(true);
  });
});

describe("validateOutboundUrl (sync, no DNS)", () => {
  it.each([
    "ftp://example.com/x",
    "file:///etc/passwd",
    "http://localhost/x",
    "http://localhost.:3000/x",
    "http://api.localhost/x",
    "http://printer.local/x",
    "http://127.0.0.1/x",
    "http://169.254.169.254/latest/meta-data/",
    "http://10.0.0.5/x",
    "https://192.168.1.1/x",
    "http://[::1]/x",
    "not a url",
  ])("rejects %s", (url) => {
    expect(validateOutboundUrl(url).ok).toBe(false);
  });

  it.each([
    "https://example.com/hook",
    "https://receiver.example/r",
    "http://93.184.216.34/hook", // public IP literal
  ])("accepts %s", (url) => {
    expect(validateOutboundUrl(url).ok).toBe(true);
  });
});

describe("assertResolvesToPublic (DNS-rebinding aware)", () => {
  it("blocks a hostname that resolves to a private address", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "169.254.169.254", family: 4 }] as never);
    const res = await assertResolvesToPublic("https://sneaky.example/hook");
    expect(res.ok).toBe(false);
    expect(res.reason).toContain("169.254.169.254");
  });

  it("allows a hostname that resolves to a public address", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }] as never);
    expect((await assertResolvesToPublic("https://good.example/hook")).ok).toBe(true);
  });

  it("blocks when ANY resolved address is private (multi-record DNS)", async () => {
    mockLookup.mockResolvedValueOnce([
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.5", family: 4 },
    ] as never);
    const res = await assertResolvesToPublic("https://mixed.example/hook");
    expect(res.ok).toBe(false);
    expect(res.reason).toContain("10.0.0.5");
  });

  it("blocks an IP literal without doing DNS", async () => {
    const res = await assertResolvesToPublic("http://127.0.0.1/x");
    expect(res.ok).toBe(false);
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it("does not block on DNS failure (lets the fetch surface the error)", async () => {
    mockLookup.mockRejectedValueOnce(new Error("ENOTFOUND"));
    expect((await assertResolvesToPublic("https://nope.example/x")).ok).toBe(true);
  });
});
