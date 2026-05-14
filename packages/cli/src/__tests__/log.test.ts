import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, statSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";

// We have to monkey-patch homedir() by overriding HOME so logFilePath
// resolves into a tempdir for tests. Node honors HOME on POSIX and
// USERPROFILE on Windows; we'll set both.
let originalHome: string | undefined;
let originalUserProfile: string | undefined;
let tmpHome: string;

beforeEach(async () => {
  tmpHome = resolve(
    tmpdir(),
    `agentops-log-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(tmpHome, { recursive: true });
  originalHome = process.env["HOME"];
  originalUserProfile = process.env["USERPROFILE"];
  process.env["HOME"] = tmpHome;
  process.env["USERPROFILE"] = tmpHome;
  // Force a fresh module so logFilePath uses the new env var. Vitest
  // hoists imports; we re-import inside each test for cleanliness.
});

afterEach(() => {
  if (originalHome === undefined) delete process.env["HOME"];
  else process.env["HOME"] = originalHome;
  if (originalUserProfile === undefined) delete process.env["USERPROFILE"];
  else process.env["USERPROFILE"] = originalUserProfile;
  try {
    rmSync(tmpHome, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("hook log", () => {
  it("writes JSON line to ~/.agentops/logs/hook.log", async () => {
    const { log, logFilePath } = await import("../log.js");
    log.info({ msg: "hello", sessionId: "abc" });
    const path = logFilePath();
    expect(existsSync(path)).toBe(true);
    const content = readFileSync(path, "utf-8").trim();
    const entry = JSON.parse(content);
    expect(entry.msg).toBe("hello");
    expect(entry.sessionId).toBe("abc");
    expect(entry.level).toBe("info");
    expect(typeof entry.ts).toBe("string");
    expect(typeof entry.pid).toBe("number");
  });

  it("respects AGENTOPS_LOG_LEVEL", async () => {
    process.env["AGENTOPS_LOG_LEVEL"] = "warn";
    try {
      const { log, logFilePath } = await import("../log.js");
      log.info({ msg: "should-not-appear" });
      log.error({ msg: "should-appear" });
      const content = existsSync(logFilePath())
        ? readFileSync(logFilePath(), "utf-8")
        : "";
      expect(content).not.toContain("should-not-appear");
      expect(content).toContain("should-appear");
    } finally {
      delete process.env["AGENTOPS_LOG_LEVEL"];
    }
  });

  it("never throws even if the log dir creation fails", async () => {
    // Point HOME at a path that can't be a directory (we make it a file).
    const blocked = join(tmpHome, "blocked");
    writeFileSync(blocked, "");
    process.env["HOME"] = blocked;
    process.env["USERPROFILE"] = blocked;
    const { log } = await import("../log.js");
    expect(() => log.error({ msg: "anywhere" })).not.toThrow();
  });

  it("rotates when the file exceeds the size cap", async () => {
    const { log, logFilePath } = await import("../log.js");
    const path = logFilePath();
    // Seed a > 5 MB log file so the next emit triggers rotation.
    mkdirSync(join(tmpHome, ".agentops", "logs"), { recursive: true });
    writeFileSync(path, "x".repeat(6 * 1024 * 1024));
    expect(statSync(path).size).toBeGreaterThan(5 * 1024 * 1024);

    log.info({ msg: "triggers-rotation" });

    expect(existsSync(`${path}.1`)).toBe(true);
    const fresh = readFileSync(path, "utf-8");
    expect(fresh).toContain("triggers-rotation");
    // The rotated file holds the seed content.
    expect(statSync(`${path}.1`).size).toBeGreaterThan(5 * 1024 * 1024);
  });
});
