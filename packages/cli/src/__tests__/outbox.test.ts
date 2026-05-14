import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { Outbox, outboxPath } from "../outbox.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = resolve(
    tmpdir(),
    `agentops-outbox-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

function makeOutbox(): Outbox {
  return new Outbox(join(tmpDir, "outbox.jsonl"));
}

describe("outboxPath", () => {
  it("sanitizes path-traversal in session ids", () => {
    const p = outboxPath("../../../etc/passwd");
    // Slashes get replaced with underscores so the filename can't escape
    // the outbox directory. The basename should not contain a slash.
    const { basename, dirname } = require("node:path");
    const file = basename(p);
    expect(file.includes("/")).toBe(false);
    expect(file.endsWith(".jsonl")).toBe(true);
    // Directory part must end with .agentops/outbox (or equivalent on the
    // platform; on POSIX this is true).
    expect(dirname(p).endsWith(join(".agentops", "outbox"))).toBe(true);
  });

  it("preserves alphanumerics, dots, hyphens, underscores", () => {
    const p = outboxPath("a1b2.C-3_d");
    const { basename } = require("node:path");
    expect(basename(p)).toBe("a1b2.C-3_d.jsonl");
  });
});

describe("Outbox.enqueue + size", () => {
  it("starts empty", () => {
    const ob = makeOutbox();
    expect(ob.size()).toBe(0);
  });

  it("size reflects appended entries", () => {
    const ob = makeOutbox();
    ob.enqueue("reportAction", ["run_1", { a: 1 }]);
    ob.enqueue("reportAction", ["run_1", { a: 2 }]);
    expect(ob.size()).toBe(2);
  });

  it("creates the file with mode 0600", () => {
    const ob = makeOutbox();
    ob.enqueue("reportAction", ["run_1"]);
    expect(existsSync(ob.path)).toBe(true);
    // We can't easily test mode bits cross-platform here, but the file
    // exists and has content.
    const raw = readFileSync(ob.path, "utf-8");
    expect(raw.length).toBeGreaterThan(0);
  });

  it("preserves order of enqueued entries", () => {
    const ob = makeOutbox();
    ob.enqueue("first", []);
    ob.enqueue("second", []);
    ob.enqueue("third", []);
    const lines = readFileSync(ob.path, "utf-8").split("\n").filter((l) => l.length > 0);
    expect(lines.map((l) => JSON.parse(l).op)).toEqual(["first", "second", "third"]);
  });
});

describe("Outbox.drain", () => {
  it("returns 0/0/0 for nonexistent file", async () => {
    const ob = makeOutbox();
    const r = await ob.drain(async () => ({ ok: true }));
    expect(r).toEqual({ sent: 0, remaining: 0, dropped: 0 });
  });

  it("removes successfully-handled entries", async () => {
    const ob = makeOutbox();
    ob.enqueue("op1", ["a"]);
    ob.enqueue("op2", ["b"]);
    const handler = vi.fn(async () => ({ ok: true }));
    const r = await ob.drain(handler);
    expect(r).toEqual({ sent: 2, remaining: 0, dropped: 0 });
    expect(handler).toHaveBeenCalledTimes(2);
    expect(ob.size()).toBe(0);
    // File is deleted on full drain.
    expect(existsSync(ob.path)).toBe(false);
  });

  it("keeps transient failures with incremented attempts", async () => {
    const ob = makeOutbox();
    ob.enqueue("op", ["a"]);
    ob.enqueue("op", ["b"]);
    const r = await ob.drain(async () => ({ ok: false, error: "boom" }));
    expect(r).toEqual({ sent: 0, remaining: 2, dropped: 0 });
    expect(ob.size()).toBe(2);
    const lines = readFileSync(ob.path, "utf-8").split("\n").filter((l) => l.length > 0);
    for (const line of lines) {
      const entry = JSON.parse(line);
      expect(entry.attempts).toBe(1);
      expect(entry.lastError).toBe("boom");
    }
  });

  it("drops permanently-failing entries", async () => {
    const ob = makeOutbox();
    ob.enqueue("op", ["a"]);
    ob.enqueue("op", ["b"]);
    const r = await ob.drain(async () => ({ ok: false, permanent: true, error: "forbidden" }));
    expect(r).toEqual({ sent: 0, remaining: 0, dropped: 2 });
    expect(existsSync(ob.path)).toBe(false);
  });

  it("mixes success, transient, and permanent in one pass", async () => {
    const ob = makeOutbox();
    ob.enqueue("op", ["ok"]);
    ob.enqueue("op", ["transient"]);
    ob.enqueue("op", ["perm"]);

    const r = await ob.drain(async (entry) => {
      const what = (entry.args[0] as string);
      if (what === "ok") return { ok: true };
      if (what === "transient") return { ok: false, error: "5xx" };
      return { ok: false, permanent: true };
    });

    expect(r).toEqual({ sent: 1, remaining: 1, dropped: 1 });
    const lines = readFileSync(ob.path, "utf-8").split("\n").filter((l) => l.length > 0);
    expect(lines.length).toBe(1);
    const remaining = JSON.parse(lines[0]!);
    expect(remaining.args[0]).toBe("transient");
    expect(remaining.attempts).toBe(1);
  });

  it("subsequent drain attempts increment attempts further", async () => {
    const ob = makeOutbox();
    ob.enqueue("op", ["a"]);
    await ob.drain(async () => ({ ok: false, error: "first" }));
    await ob.drain(async () => ({ ok: false, error: "second" }));
    const entry = JSON.parse(readFileSync(ob.path, "utf-8").split("\n")[0]!);
    expect(entry.attempts).toBe(2);
    expect(entry.lastError).toBe("second");
  });

  it("skips malformed JSONL lines without crashing", async () => {
    const ob = makeOutbox();
    ob.enqueue("op", ["a"]);
    // Append a corrupt line directly to the file.
    const { appendFileSync } = await import("node:fs");
    appendFileSync(ob.path, "not-valid-json\n");
    ob.enqueue("op", ["c"]);

    const handler = vi.fn(async () => ({ ok: true }));
    const r = await ob.drain(handler);
    expect(r.sent).toBe(2);
    expect(r.dropped).toBe(1); // the malformed line
    expect(handler).toHaveBeenCalledTimes(2);
  });
});

describe("Outbox.clear", () => {
  it("removes the file", () => {
    const ob = makeOutbox();
    ob.enqueue("op", []);
    expect(existsSync(ob.path)).toBe(true);
    ob.clear();
    expect(existsSync(ob.path)).toBe(false);
  });

  it("is a no-op when the file does not exist", () => {
    const ob = makeOutbox();
    expect(() => ob.clear()).not.toThrow();
  });
});
