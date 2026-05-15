import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readHookInstall } from "../commands/doctor.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  const dir = resolve(
    tmpdir(),
    `agentops-doctor-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeJsonFile(path: string, data: unknown): void {
  mkdirSync(require("node:path").dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2), "utf-8");
}

// Build a .claude/settings.json path under a given home dir
function settingsPath(homeDir: string, scope: "project" | "global" = "global"): string {
  return join(homeDir, ".claude", "settings.json");
}

// Build a ~/.agentops/credentials.json path under a given home dir
function credsPath(homeDir: string): string {
  return join(homeDir, ".agentops", "credentials.json");
}

function writeSettings(homeDir: string, hookCommand: string): string {
  const p = settingsPath(homeDir);
  writeJsonFile(p, {
    hooks: {
      SessionStart: [
        { matcher: "", hooks: [{ type: "command", command: hookCommand }] },
      ],
    },
  });
  return p;
}

function writeCreds(homeDir: string, opts: { server?: string; token?: string }): void {
  const p = credsPath(homeDir);
  writeJsonFile(p, {
    server: opts.server ?? "http://localhost:3000",
    token: opts.token ?? null,
    user: { id: "u1", email: "test@example.com", name: "Test", role: "admin" },
  });
}

// ─── Tests for readHookInstall ──────────────────────────────────────────────
// We test readHookInstall directly because it's the B8b-fixed logic.
// For full doctor runs we'd need to fully mock fetch and HOME; these
// direct-helper tests cover the critical mode-resolution path.

describe("readHookInstall", () => {
  let tmpDir: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    originalHome = process.env["HOME"];
    // Redirect HOME so readCredentials() reads from our tmp dir
    process.env["HOME"] = tmpDir;
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env["HOME"];
    else process.env["HOME"] = originalHome;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("missing settings file → installed: false, mode: null", () => {
    const p = join(tmpDir, "nonexistent", "settings.json");
    const result = readHookInstall(p);
    expect(result.installed).toBe(false);
    expect(result.mode).toBeNull();
  });

  it("settings.json with no agentops hook command → installed: false", () => {
    const p = settingsPath(tmpDir);
    writeJsonFile(p, {
      hooks: {
        SessionStart: [
          { matcher: "", hooks: [{ type: "command", command: "other-tool hook" }] },
        ],
      },
    });
    const result = readHookInstall(p);
    expect(result.installed).toBe(false);
    expect(result.mode).toBeNull();
  });

  it("hook command WITH AGENTOPS_SERVER_URL= prefix → mode: sdk, serverUrl matches prefix", () => {
    const p = writeSettings(tmpDir, "AGENTOPS_SERVER_URL=https://acme.example.com agentops hook session-start");
    const result = readHookInstall(p);
    expect(result.installed).toBe(true);
    expect(result.mode).toBe("sdk");
    expect(result.serverUrl).toBe("https://acme.example.com");
  });

  it("hook command WITHOUT prefix AND credentials.json has server+token → mode: sdk (B8b fix)", () => {
    // This is the B8b scenario: plain `agentops hook session-start` command,
    // but credentials.json has both server and token, so hook runtime
    // will choose SDK mode — readHookInstall must report that correctly.
    writeCreds(tmpDir, {
      server: "http://localhost:3000",
      token: "ao_some_token",
    });
    const p = writeSettings(tmpDir, "agentops hook session-start");
    const result = readHookInstall(p);
    expect(result.installed).toBe(true);
    expect(result.mode).toBe("sdk");
    expect(result.serverUrl).toBe("http://localhost:3000");
  });

  it("hook command WITHOUT prefix AND credentials.json has no token → mode: local", () => {
    // Creds file exists but has no token; hook runtime falls back to local
    writeCreds(tmpDir, {
      server: "http://localhost:3000",
      token: "",
    });
    const p = writeSettings(tmpDir, "agentops hook session-start");
    const result = readHookInstall(p);
    expect(result.installed).toBe(true);
    expect(result.mode).toBe("local");
  });

  it("hook command WITHOUT prefix AND no credentials.json → mode: local", () => {
    // No creds at all; fall back to local mode
    const p = writeSettings(tmpDir, "agentops hook session-start");
    const result = readHookInstall(p);
    expect(result.installed).toBe(true);
    expect(result.mode).toBe("local");
  });
});

// ─── Full doctor command run ─────────────────────────────────────────────────

describe("agentops doctor (full command)", () => {
  let tmpDir: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    originalHome = process.env["HOME"];
    process.env["HOME"] = tmpDir;
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env["HOME"];
    else process.env["HOME"] = originalHome;
    vi.unstubAllGlobals();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  async function runDoctorCommand(dbPath?: string): Promise<{ output: string; exitCode: number | undefined }> {
    const { Command } = await import("commander");
    const { registerDoctorCommand } = await import("../commands/doctor.js");

    let output = "";
    let exitCode: number | undefined;

    const originalLog = console.log;
    console.log = (...parts: unknown[]) => {
      output += parts.join(" ") + "\n";
    };
    const originalExit = process.exit.bind(process);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      exitCode = code;
    }) as never);

    try {
      const program = new Command();
      program
        .name("agentops")
        .allowUnknownOption()
        .option("--db-path <path>", "DB path", dbPath ?? resolve(tmpDir, "test.db"))
        .option("--json");
      registerDoctorCommand(program);
      await program.parseAsync(["node", "agentops", "doctor"]);
    } finally {
      console.log = originalLog;
      exitSpy.mockRestore();
    }

    return { output, exitCode };
  }

  it("no credentials and no hooks → warns 'Not logged in' and 'No AgentOps hooks installed'", async () => {
    // Stub fetch so reachDashboard never fires (no creds means it won't be called)
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })));

    const { output } = await runDoctorCommand();
    expect(output).toContain("Not logged in");
    expect(output).toContain("No AgentOps hooks installed");
  });

  it("doctor runs without throwing on a populated-home state", async () => {
    // Setup: credentials + settings with env-var prefix hook
    writeCreds(tmpDir, { server: "http://localhost:3000", token: "ao_token" });
    writeSettings(
      tmpDir,
      "AGENTOPS_SERVER_URL=http://localhost:3000 agentops hook session-start",
    );

    // Mock fetch to simulate a reachable dashboard
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ user: { email: "test@example.com", role: "admin" } }),
      })),
    );

    // Should not throw
    await expect(runDoctorCommand()).resolves.toBeDefined();
  });
});
