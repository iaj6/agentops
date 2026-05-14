import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { Command } from "commander";
import { registerSetupCommand, getSettingsPath } from "../commands/setup.js";

function makeTmpDir(): string {
  const dir = resolve(tmpdir(), `agentops-setup-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function readJson(filePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(filePath, "utf-8")) as Record<string, unknown>;
}

function runSetup(args: string[], cwd: string): string {
  let output = "";
  const originalLog = console.log;
  console.log = (msg: string) => { output += msg + "\n"; };
  const originalCwd = process.cwd;
  process.cwd = () => cwd;

  try {
    const program = new Command();
    program.name("agentops").option("--db-path <path>").option("--json");
    registerSetupCommand(program);
    program.parse(["node", "agentops", "setup", ...args]);
  } finally {
    console.log = originalLog;
    process.cwd = originalCwd;
  }

  return output;
}

describe("agentops setup", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates settings.json in a new .claude directory", () => {
    runSetup([], tmpDir);

    const settingsPath = resolve(tmpDir, ".claude", "settings.json");
    expect(existsSync(settingsPath)).toBe(true);

    const settings = readJson(settingsPath);
    expect(settings.hooks).toBeDefined();

    const hooks = settings.hooks as Record<string, unknown>;
    expect(hooks.SessionStart).toBeDefined();
    expect(hooks.PreToolUse).toBeDefined();
    expect(hooks.PostToolUse).toBeDefined();
    expect(hooks.Stop).toBeDefined();
    expect(hooks.SessionEnd).toBeDefined();
    expect(hooks.SubagentStop).toBeDefined();
    // SubagentStart is intentionally absent — not a real Claude Code event.
    expect(hooks.SubagentStart).toBeUndefined();
  });

  it("generates correct hook commands", () => {
    runSetup([], tmpDir);

    const settingsPath = resolve(tmpDir, ".claude", "settings.json");
    const settings = readJson(settingsPath);
    const hooks = settings.hooks as Record<string, Array<{ matcher: string; hooks: Array<{ type: string; command: string }> }>>;

    expect(hooks.SessionStart![0]!.hooks[0]!.command).toBe("agentops hook session-start");
    expect(hooks.PreToolUse![0]!.matcher).toBe("Bash|Edit|Write|NotebookEdit");
    expect(hooks.PreToolUse![0]!.hooks[0]!.command).toBe("agentops hook pre-tool-use");
    expect(hooks.PostToolUse![0]!.matcher).toBe(".*");
    expect(hooks.PostToolUse![0]!.hooks[0]!.command).toBe("agentops hook post-tool-use");
    expect(hooks.Stop![0]!.hooks[0]!.command).toBe("agentops hook stop");
    expect(hooks.SessionEnd![0]!.hooks[0]!.command).toBe("agentops hook session-end");
    expect(hooks.SubagentStop![0]!.matcher).toBe("");
    expect(hooks.SubagentStop![0]!.hooks[0]!.command).toBe("agentops hook subagent-stop");
  });

  it("merges with existing settings without overwriting them", () => {
    const claudeDir = resolve(tmpDir, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(
      resolve(claudeDir, "settings.json"),
      JSON.stringify({ theme: "dark", editor: "vim" }, null, 2),
      "utf-8",
    );

    runSetup([], tmpDir);

    const settings = readJson(resolve(claudeDir, "settings.json"));
    expect(settings.theme).toBe("dark");
    expect(settings.editor).toBe("vim");
    expect(settings.hooks).toBeDefined();
  });

  it("preserves hooks from other tools", () => {
    const claudeDir = resolve(tmpDir, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(
      resolve(claudeDir, "settings.json"),
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: ".*",
              hooks: [{ type: "command", command: "other-tool pre-hook" }],
            },
          ],
        },
      }, null, 2),
      "utf-8",
    );

    runSetup([], tmpDir);

    const settings = readJson(resolve(claudeDir, "settings.json"));
    const hooks = settings.hooks as Record<string, Array<{ matcher: string; hooks: Array<{ type: string; command: string }> }>>;

    // Other tool's hook should be preserved
    const preToolMatchers = hooks.PreToolUse!;
    expect(preToolMatchers.length).toBe(2);

    const otherToolMatcher = preToolMatchers.find(
      (m) => m.hooks.some((h) => h.command === "other-tool pre-hook"),
    );
    expect(otherToolMatcher).toBeDefined();

    const agentOpsMatcher = preToolMatchers.find(
      (m) => m.hooks.some((h) => h.command.includes("agentops hook")),
    );
    expect(agentOpsMatcher).toBeDefined();
  });

  it("is idempotent — running setup twice produces the same result", () => {
    runSetup([], tmpDir);
    const settingsPath = resolve(tmpDir, ".claude", "settings.json");
    const first = readFileSync(settingsPath, "utf-8");

    runSetup([], tmpDir);
    const second = readFileSync(settingsPath, "utf-8");

    expect(second).toBe(first);
  });

  it("--uninstall removes only AgentOps hooks", () => {
    const claudeDir = resolve(tmpDir, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(
      resolve(claudeDir, "settings.json"),
      JSON.stringify({
        theme: "dark",
        hooks: {
          PreToolUse: [
            { matcher: ".*", hooks: [{ type: "command", command: "other-tool pre-hook" }] },
            { matcher: "Bash|Edit|Write|NotebookEdit", hooks: [{ type: "command", command: "agentops hook pre-tool-use" }] },
          ],
          SessionStart: [
            { matcher: "", hooks: [{ type: "command", command: "agentops hook session-start" }] },
          ],
        },
      }, null, 2),
      "utf-8",
    );

    runSetup(["--uninstall"], tmpDir);

    const settings = readJson(resolve(claudeDir, "settings.json"));
    expect(settings.theme).toBe("dark");

    const hooks = settings.hooks as Record<string, unknown[]> | undefined;

    // PreToolUse should still exist with the other tool's hook
    expect(hooks).toBeDefined();
    expect(hooks!.PreToolUse).toBeDefined();
    expect((hooks!.PreToolUse as unknown[]).length).toBe(1);

    // SessionStart should be removed entirely since it only had AgentOps hooks
    expect(hooks!.SessionStart).toBeUndefined();
  });

  it("--uninstall with no hooks reports nothing to do", () => {
    const claudeDir = resolve(tmpDir, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(
      resolve(claudeDir, "settings.json"),
      JSON.stringify({ theme: "dark" }, null, 2),
      "utf-8",
    );

    const output = runSetup(["--uninstall"], tmpDir);
    expect(output).toContain("No hooks found");
  });

  it("--uninstall removes hooks key when all hooks are gone", () => {
    const claudeDir = resolve(tmpDir, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(
      resolve(claudeDir, "settings.json"),
      JSON.stringify({
        theme: "dark",
        hooks: {
          SessionStart: [
            { matcher: "", hooks: [{ type: "command", command: "agentops hook session-start" }] },
          ],
        },
      }, null, 2),
      "utf-8",
    );

    runSetup(["--uninstall"], tmpDir);

    const settings = readJson(resolve(claudeDir, "settings.json"));
    expect(settings.theme).toBe("dark");
    expect(settings.hooks).toBeUndefined();
  });

  it("--dry-run does not write any files", () => {
    const output = runSetup(["--dry-run"], tmpDir);

    const settingsPath = resolve(tmpDir, ".claude", "settings.json");
    expect(existsSync(settingsPath)).toBe(false);
    expect(output).toContain("Dry run");
    expect(output).toContain("SessionStart");
  });

  it("--dry-run with --json outputs JSON", () => {
    const output = runSetup(["--dry-run", "--json"], tmpDir);

    const parsed = JSON.parse(output.trim());
    expect(parsed.status).toBe("dry-run");
    expect(parsed.action).toBe("install");
    expect(parsed.settings.hooks).toBeDefined();
  });

  it("--json flag outputs JSON on install", () => {
    const output = runSetup(["--json"], tmpDir);

    const parsed = JSON.parse(output.trim());
    expect(parsed.status).toBe("configured");
    expect(parsed.hooks).toContain("SessionStart");
    expect(parsed.hooks).toContain("PreToolUse");
    expect(parsed.hooks).toContain("PostToolUse");
    expect(parsed.hooks).toContain("Stop");
    expect(parsed.hooks).toContain("SessionEnd");
    expect(parsed.hooks).toContain("SubagentStop");
    expect(parsed.hooks).not.toContain("SubagentStart");
  });

  it("--db-path flag adds path to all hook commands", () => {
    runSetup(["--db-path", "/tmp/test.db"], tmpDir);

    const settingsPath = resolve(tmpDir, ".claude", "settings.json");
    const settings = readJson(settingsPath);
    const hooks = settings.hooks as Record<string, Array<{ hooks: Array<{ command: string }> }>>;

    for (const matchers of Object.values(hooks)) {
      for (const matcher of matchers) {
        for (const hook of matcher.hooks) {
          expect(hook.command).toContain("--db-path /tmp/test.db");
        }
      }
    }
  });

  it("--global flag uses home directory path", () => {
    const globalPath = getSettingsPath(true);
    expect(globalPath).toContain(".claude");
    expect(globalPath).toContain("settings.json");

    // Verify it uses homedir, not cwd
    const projectPath = getSettingsPath(false, "/some/project");
    expect(projectPath).toBe(resolve("/some/project", ".claude", "settings.json"));
    expect(globalPath).not.toBe(projectPath);
  });

  it("registers setup command without errors", () => {
    const program = new Command();
    program.option("--db-path <path>").option("--json");

    expect(() => registerSetupCommand(program)).not.toThrow();

    const setupCmd = program.commands.find((c) => c.name() === "setup");
    expect(setupCmd).toBeDefined();
  });
});
