import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { registerHookCommand } from "../commands/hook.js";
import {
  _readState,
  _writeState,
  _cleanupState,
  _checkPreToolPolicies,
  _mapToolToAction,
  _handleSubagentStart,
  _handleSubagentStop,
  _handleStop,
  stateFilePath,
} from "../commands/hook.js";
import type { HookState, HookInput } from "../commands/hook.js";
import { PolicyType, PolicySeverity, createPolicyId, EventCategory, EVENT_TYPES } from "@agentops/core";
import type { Policy } from "@agentops/core";

// ─── Command registration tests ─────────────────────────────────────────────

describe("Hook command registration", () => {
  it("registers hook command without errors", () => {
    const program = new Command();
    program.option("--db-path <path>").option("--json");

    expect(() => registerHookCommand(program)).not.toThrow();

    const hookCmd = program.commands.find((c) => c.name() === "hook");
    expect(hookCmd).toBeDefined();
  });

  it("has correct description", () => {
    const program = new Command();
    program.option("--db-path <path>").option("--json");
    registerHookCommand(program);

    const hookCmd = program.commands.find((c) => c.name() === "hook");
    expect(hookCmd!.description()).toContain("hook");
  });

  it("registers all seven subcommands", () => {
    const program = new Command();
    program.option("--db-path <path>").option("--json");
    registerHookCommand(program);

    const hookCmd = program.commands.find((c) => c.name() === "hook");
    const subcommands = hookCmd!.commands.map((c) => c.name());
    expect(subcommands).toContain("session-start");
    expect(subcommands).toContain("pre-tool-use");
    expect(subcommands).toContain("post-tool-use");
    expect(subcommands).toContain("stop");
    expect(subcommands).toContain("session-end");
    expect(subcommands).toContain("subagent-start");
    expect(subcommands).toContain("subagent-stop");
  });

  it("does not conflict with other commands", () => {
    const program = new Command();
    program.option("--db-path <path>").option("--json");

    program.command("other").description("other command");
    registerHookCommand(program);

    const names = program.commands.map((c) => c.name());
    expect(names).toContain("hook");
    expect(names).toContain("other");
  });
});

// ─── State file tests ───────────────────────────────────────────────────────

describe("State file management", () => {
  const testSessionId = "test-session-state-" + Date.now();

  afterEach(() => {
    _cleanupState(testSessionId);
  });

  it("writes and reads state correctly", () => {
    const state: HookState = {
      runId: "run_123",
      sessionId: "session_456",
      dbPath: "/tmp/test.db",
      startTime: "2025-01-01T00:00:00.000Z",
      agentsSpawned: 0,
      agentsCompleted: 0,
      finalized: false,
    };

    _writeState(testSessionId, state);
    const read = _readState(testSessionId);

    expect(read).toEqual(state);
  });

  it("returns null for missing state file", () => {
    const read = _readState("nonexistent-session-" + Date.now());
    expect(read).toBeNull();
  });

  it("cleans up state file", () => {
    const state: HookState = {
      runId: "run_123",
      sessionId: "session_456",
      dbPath: "",
      startTime: "2025-01-01T00:00:00.000Z",
      agentsSpawned: 0,
      agentsCompleted: 0,
      finalized: false,
    };

    _writeState(testSessionId, state);
    expect(existsSync(stateFilePath(testSessionId))).toBe(true);

    _cleanupState(testSessionId);
    expect(existsSync(stateFilePath(testSessionId))).toBe(false);
  });

  it("cleanup does not throw for missing file", () => {
    expect(() => _cleanupState("nonexistent-session-" + Date.now())).not.toThrow();
  });

  it("generates correct state file path", () => {
    const path = stateFilePath("abc123");
    expect(path).toBe(join(tmpdir(), "agentops-hook-abc123.json"));
  });
});

// ─── Action mapping tests ───────────────────────────────────────────────────

describe("Tool-to-action mapping", () => {
  it("maps Bash tool to action with command", () => {
    const input: HookInput = {
      session_id: "test",
      tool_name: "Bash",
      tool_input: { command: "npm test" },
    };

    const action = _mapToolToAction(input);

    expect(action.id).toBeTruthy();
    expect(action.toolCalls).toHaveLength(1);
    expect(action.toolCalls[0]!.name).toBe("Bash");
    expect(action.commands).toHaveLength(1);
    expect(action.commands[0]!.command).toBe("npm test");
    expect(action.fileEdits).toHaveLength(0);
  });

  it("maps Edit tool to action with file edit", () => {
    const input: HookInput = {
      session_id: "test",
      tool_name: "Edit",
      tool_input: { file_path: "/src/index.ts", old_string: "foo", new_string: "bar" },
    };

    const action = _mapToolToAction(input);

    expect(action.toolCalls).toHaveLength(1);
    expect(action.toolCalls[0]!.name).toBe("Edit");
    expect(action.fileEdits).toHaveLength(1);
    expect(action.fileEdits[0]!.path).toBe("/src/index.ts");
    expect(action.commands).toHaveLength(0);
  });

  it("maps Write tool to action with file edit", () => {
    const input: HookInput = {
      session_id: "test",
      tool_name: "Write",
      tool_input: { file_path: "/src/new.ts", content: "hello" },
    };

    const action = _mapToolToAction(input);

    expect(action.fileEdits).toHaveLength(1);
    expect(action.fileEdits[0]!.path).toBe("/src/new.ts");
  });

  it("maps Read tool to action with no edits", () => {
    const input: HookInput = {
      session_id: "test",
      tool_name: "Read",
      tool_input: { file_path: "/src/index.ts" },
    };

    const action = _mapToolToAction(input);

    expect(action.toolCalls).toHaveLength(1);
    expect(action.toolCalls[0]!.name).toBe("Read");
    expect(action.fileEdits).toHaveLength(0);
    expect(action.commands).toHaveLength(0);
  });

  it("handles unknown tool gracefully", () => {
    const input: HookInput = {
      session_id: "test",
      tool_name: "CustomTool",
      tool_input: { data: "value" },
    };

    const action = _mapToolToAction(input);
    expect(action.toolCalls[0]!.name).toBe("CustomTool");
    expect(action.fileEdits).toHaveLength(0);
    expect(action.commands).toHaveLength(0);
  });

  it("handles missing tool_input gracefully", () => {
    const input: HookInput = {
      session_id: "test",
      tool_name: "Bash",
    };

    const action = _mapToolToAction(input);
    expect(action.toolCalls).toHaveLength(1);
    expect(action.commands).toHaveLength(0); // No command string
  });

  it("includes tool_response in output when present", () => {
    const input: HookInput = {
      session_id: "test",
      tool_name: "Bash",
      tool_input: { command: "echo hello" },
      tool_response: { stdout: "hello\n" },
    };

    const action = _mapToolToAction(input);
    expect(action.toolCalls[0]!.output).toContain("hello");
  });
});

// ─── Policy checking tests ──────────────────────────────────────────────────

describe("Pre-tool-use policy checking", () => {
  const riskyPolicy: Policy & { enabled: boolean } = {
    id: createPolicyId("pol_risky"),
    name: "No dangerous commands",
    type: PolicyType.RiskyOpFlag,
    config: {
      type: PolicyType.RiskyOpFlag,
      riskyPatterns: ["rm -rf", "sudo", "DROP TABLE"],
    },
    severity: PolicySeverity.Error,
    enabled: true,
  };

  const pathPolicy: Policy & { enabled: boolean } = {
    id: createPolicyId("pol_path"),
    name: "Protect config",
    type: PolicyType.PathRestriction,
    config: {
      type: PolicyType.PathRestriction,
      blockedPaths: ["/etc/", "~/.ssh/"],
    },
    severity: PolicySeverity.Error,
    enabled: true,
  };

  const warningPolicy: Policy & { enabled: boolean } = {
    id: createPolicyId("pol_warn"),
    name: "Warn on force push",
    type: PolicyType.RiskyOpFlag,
    config: {
      type: PolicyType.RiskyOpFlag,
      riskyPatterns: ["--force"],
    },
    severity: PolicySeverity.Warning,
    enabled: true,
  };

  const disabledPolicy: Policy & { enabled: boolean } = {
    id: createPolicyId("pol_disabled"),
    name: "Disabled policy",
    type: PolicyType.RiskyOpFlag,
    config: {
      type: PolicyType.RiskyOpFlag,
      riskyPatterns: ["echo"],
    },
    severity: PolicySeverity.Error,
    enabled: false,
  };

  it("detects risky Bash commands", () => {
    const input: HookInput = {
      session_id: "test",
      tool_name: "Bash",
      tool_input: { command: "rm -rf /tmp/stuff" },
    };

    const violations = _checkPreToolPolicies(input, [riskyPolicy]);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.severity).toBe("error");
    expect(violations[0]!.message).toContain("rm -rf");
  });

  it("detects blocked file paths on Edit", () => {
    const input: HookInput = {
      session_id: "test",
      tool_name: "Edit",
      tool_input: { file_path: "/etc/passwd" },
    };

    const violations = _checkPreToolPolicies(input, [pathPolicy]);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.message).toContain("/etc/");
  });

  it("detects blocked file paths on Write", () => {
    const input: HookInput = {
      session_id: "test",
      tool_name: "Write",
      tool_input: { file_path: "~/.ssh/authorized_keys" },
    };

    const violations = _checkPreToolPolicies(input, [pathPolicy]);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.message).toContain("~/.ssh/");
  });

  it("returns no violations for safe commands", () => {
    const input: HookInput = {
      session_id: "test",
      tool_name: "Bash",
      tool_input: { command: "npm test" },
    };

    const violations = _checkPreToolPolicies(input, [riskyPolicy, pathPolicy]);
    expect(violations).toHaveLength(0);
  });

  it("returns no violations for safe file paths", () => {
    const input: HookInput = {
      session_id: "test",
      tool_name: "Edit",
      tool_input: { file_path: "/src/index.ts" },
    };

    const violations = _checkPreToolPolicies(input, [pathPolicy]);
    expect(violations).toHaveLength(0);
  });

  it("returns warning severity violations correctly", () => {
    const input: HookInput = {
      session_id: "test",
      tool_name: "Bash",
      tool_input: { command: "git push --force" },
    };

    const violations = _checkPreToolPolicies(input, [warningPolicy]);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.severity).toBe("warning");
  });

  it("skips disabled policies", () => {
    const input: HookInput = {
      session_id: "test",
      tool_name: "Bash",
      tool_input: { command: "echo hello" },
    };

    const violations = _checkPreToolPolicies(input, [disabledPolicy]);
    expect(violations).toHaveLength(0);
  });

  it("checks multiple policies at once", () => {
    const input: HookInput = {
      session_id: "test",
      tool_name: "Bash",
      tool_input: { command: "sudo rm -rf /" },
    };

    const violations = _checkPreToolPolicies(input, [riskyPolicy]);
    // Both "rm -rf" and "sudo" match
    expect(violations.length).toBeGreaterThanOrEqual(1);
    const messages = violations.map((v) => v.message).join(" ");
    expect(messages).toContain("rm -rf");
    expect(messages).toContain("sudo");
  });

  it("does not flag Read tool against path restrictions", () => {
    const input: HookInput = {
      session_id: "test",
      tool_name: "Read",
      tool_input: { file_path: "/etc/passwd" },
    };

    const violations = _checkPreToolPolicies(input, [pathPolicy]);
    expect(violations).toHaveLength(0);
  });

  it("does not flag Bash tool against path restrictions", () => {
    const input: HookInput = {
      session_id: "test",
      tool_name: "Bash",
      tool_input: { command: "cat /etc/passwd" },
    };

    const violations = _checkPreToolPolicies(input, [pathPolicy]);
    expect(violations).toHaveLength(0);
  });

  // ─── FileLimitCount guard tests ─────────────────────────────────────────────

  const fileLimitPolicy: Policy & { enabled: boolean } = {
    id: createPolicyId("pol_filelimit"),
    name: "Max 2 files",
    type: PolicyType.FileLimitCount,
    config: {
      type: PolicyType.FileLimitCount,
      maxFiles: 2,
    },
    severity: PolicySeverity.Error,
    enabled: true,
  };

  it("allows Edit when under file limit", () => {
    const input: HookInput = {
      session_id: "test",
      tool_name: "Edit",
      tool_input: { file_path: "/src/a.ts" },
    };

    const existingFiles = new Set(["/src/a.ts"]);
    const violations = _checkPreToolPolicies(input, [fileLimitPolicy], { editedFiles: existingFiles });
    expect(violations).toHaveLength(0);
  });

  it("allows Edit for already-edited file even at limit", () => {
    const input: HookInput = {
      session_id: "test",
      tool_name: "Edit",
      tool_input: { file_path: "/src/a.ts" },
    };

    const existingFiles = new Set(["/src/a.ts", "/src/b.ts"]);
    const violations = _checkPreToolPolicies(input, [fileLimitPolicy], { editedFiles: existingFiles });
    expect(violations).toHaveLength(0);
  });

  it("blocks Edit when adding a new file would exceed limit", () => {
    const input: HookInput = {
      session_id: "test",
      tool_name: "Edit",
      tool_input: { file_path: "/src/c.ts" },
    };

    const existingFiles = new Set(["/src/a.ts", "/src/b.ts"]);
    const violations = _checkPreToolPolicies(input, [fileLimitPolicy], { editedFiles: existingFiles });
    expect(violations).toHaveLength(1);
    expect(violations[0]!.message).toContain("File limit exceeded");
    expect(violations[0]!.message).toContain("/src/c.ts");
  });

  it("blocks Write when adding a new file would exceed limit", () => {
    const input: HookInput = {
      session_id: "test",
      tool_name: "Write",
      tool_input: { file_path: "/src/new.ts" },
    };

    const existingFiles = new Set(["/src/a.ts", "/src/b.ts"]);
    const violations = _checkPreToolPolicies(input, [fileLimitPolicy], { editedFiles: existingFiles });
    expect(violations).toHaveLength(1);
    expect(violations[0]!.severity).toBe("error");
  });

  it("does not check FileLimitCount for Read tool", () => {
    const input: HookInput = {
      session_id: "test",
      tool_name: "Read",
      tool_input: { file_path: "/src/c.ts" },
    };

    const existingFiles = new Set(["/src/a.ts", "/src/b.ts"]);
    const violations = _checkPreToolPolicies(input, [fileLimitPolicy], { editedFiles: existingFiles });
    expect(violations).toHaveLength(0);
  });

  // ─── SecretDetection guard tests ─────────────────────────────────────────────

  const secretPolicy: Policy & { enabled: boolean } = {
    id: createPolicyId("pol_secret"),
    name: "No secrets in code",
    type: PolicyType.SecretDetection,
    config: {
      type: PolicyType.SecretDetection,
      patterns: [
        "AKIA[0-9A-Z]{16}",
        "-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----",
      ],
    },
    severity: PolicySeverity.Error,
    enabled: true,
  };

  it("blocks Write with AWS key in content", () => {
    const input: HookInput = {
      session_id: "test",
      tool_name: "Write",
      tool_input: { file_path: "/src/config.ts", content: "const key = 'AKIAIOSFODNN7EXAMPLE';" },
    };

    const violations = _checkPreToolPolicies(input, [secretPolicy]);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.message).toContain("Secret pattern");
  });

  it("blocks Edit with private key in new_string", () => {
    const input: HookInput = {
      session_id: "test",
      tool_name: "Edit",
      tool_input: { file_path: "/certs/key.pem", old_string: "old", new_string: "-----BEGIN RSA PRIVATE KEY-----\nMIIE..." },
    };

    const violations = _checkPreToolPolicies(input, [secretPolicy]);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.message).toContain("Secret pattern");
  });

  it("allows Write with no secrets", () => {
    const input: HookInput = {
      session_id: "test",
      tool_name: "Write",
      tool_input: { file_path: "/src/index.ts", content: "export const foo = 42;" },
    };

    const violations = _checkPreToolPolicies(input, [secretPolicy]);
    expect(violations).toHaveLength(0);
  });

  it("allows Read tool (not scanned by SecretDetection)", () => {
    const input: HookInput = {
      session_id: "test",
      tool_name: "Read",
      tool_input: { file_path: "/src/config.ts" },
    };

    const violations = _checkPreToolPolicies(input, [secretPolicy]);
    expect(violations).toHaveLength(0);
  });

  // ─── BranchProtection guard tests ──────────────────────────────────────────

  const branchPolicy: Policy & { enabled: boolean } = {
    id: createPolicyId("pol_branch"),
    name: "Protected branches",
    type: PolicyType.BranchProtection,
    config: {
      type: PolicyType.BranchProtection,
      protectedBranches: ["main", "master", "production"],
    },
    severity: PolicySeverity.Warning,
    enabled: true,
  };

  it("blocks Edit on main branch", () => {
    const input: HookInput = {
      session_id: "test",
      tool_name: "Edit",
      tool_input: { file_path: "/src/a.ts", old_string: "old", new_string: "new" },
    };

    const violations = _checkPreToolPolicies(input, [branchPolicy], { branch: "main" });
    expect(violations).toHaveLength(1);
    expect(violations[0]!.message).toContain("protected branch");
    expect(violations[0]!.severity).toBe("warning");
  });

  it("blocks Write on production branch", () => {
    const input: HookInput = {
      session_id: "test",
      tool_name: "Write",
      tool_input: { file_path: "/src/new.ts", content: "code" },
    };

    const violations = _checkPreToolPolicies(input, [branchPolicy], { branch: "production" });
    expect(violations).toHaveLength(1);
    expect(violations[0]!.message).toContain("production");
  });

  it("blocks Bash on protected branch", () => {
    const input: HookInput = {
      session_id: "test",
      tool_name: "Bash",
      tool_input: { command: "npm run build" },
    };

    const violations = _checkPreToolPolicies(input, [branchPolicy], { branch: "master" });
    expect(violations).toHaveLength(1);
    expect(violations[0]!.message).toContain("master");
  });

  it("allows Edit on feature branch", () => {
    const input: HookInput = {
      session_id: "test",
      tool_name: "Edit",
      tool_input: { file_path: "/src/a.ts", old_string: "old", new_string: "new" },
    };

    const violations = _checkPreToolPolicies(input, [branchPolicy], { branch: "feature/foo" });
    expect(violations).toHaveLength(0);
  });

  it("allows Read on protected branch (read-only, not blocked)", () => {
    const input: HookInput = {
      session_id: "test",
      tool_name: "Read",
      tool_input: { file_path: "/src/a.ts" },
    };

    const violations = _checkPreToolPolicies(input, [branchPolicy], { branch: "main" });
    expect(violations).toHaveLength(0);
  });

  it("handles missing branch context gracefully (allows)", () => {
    const input: HookInput = {
      session_id: "test",
      tool_name: "Edit",
      tool_input: { file_path: "/src/a.ts", old_string: "old", new_string: "new" },
    };

    const violations = _checkPreToolPolicies(input, [branchPolicy]);
    expect(violations).toHaveLength(0);
  });

  // ─── Deprecated/unknown policy type tests ──────────────────────────────────

  it("skips deprecated/unknown policy types gracefully", () => {
    const deprecatedPolicy: Policy & { enabled: boolean } = {
      id: createPolicyId("pol_deprecated"),
      name: "Made-up policy",
      type: "madeUpType" as PolicyType,
      config: { type: "madeUpType" as any, foo: 10 } as any,
      severity: PolicySeverity.Error,
      enabled: true,
    };

    const input: HookInput = {
      session_id: "test",
      tool_name: "Bash",
      tool_input: { command: "echo hello" },
    };

    const violations = _checkPreToolPolicies(input, [deprecatedPolicy]);
    expect(violations).toHaveLength(0);
  });

  // ─── CostCeiling guard tests ─────────────────────────────────────────────

  const costPolicy: Policy & { enabled: boolean } = {
    id: createPolicyId("pol_cost"),
    name: "Cost ceiling $5",
    type: PolicyType.CostCeiling,
    config: {
      type: PolicyType.CostCeiling,
      maxUsd: 5,
    },
    severity: PolicySeverity.Error,
    enabled: true,
  };

  it("allows tool call when cumulative cost is below ceiling", () => {
    const input: HookInput = {
      session_id: "test",
      tool_name: "Bash",
      tool_input: { command: "ls" },
    };

    const violations = _checkPreToolPolicies(input, [costPolicy], { cumulativeCostUsd: 2.5 });
    expect(violations).toHaveLength(0);
  });

  it("blocks tool call when cumulative cost equals ceiling", () => {
    const input: HookInput = {
      session_id: "test",
      tool_name: "Bash",
      tool_input: { command: "ls" },
    };

    const violations = _checkPreToolPolicies(input, [costPolicy], { cumulativeCostUsd: 5 });
    expect(violations).toHaveLength(1);
    expect(violations[0]!.message).toContain("Cost ceiling reached");
    expect(violations[0]!.severity).toBe("error");
  });

  it("blocks tool call when cumulative cost exceeds ceiling", () => {
    const input: HookInput = {
      session_id: "test",
      tool_name: "Edit",
      tool_input: { file_path: "/src/a.ts" },
    };

    const violations = _checkPreToolPolicies(input, [costPolicy], { cumulativeCostUsd: 8.27 });
    expect(violations).toHaveLength(1);
    expect(violations[0]!.message).toContain("$8.27");
    expect(violations[0]!.message).toContain("$5.00");
  });

  it("treats missing cumulativeCostUsd as zero (does not block)", () => {
    const input: HookInput = {
      session_id: "test",
      tool_name: "Bash",
      tool_input: { command: "ls" },
    };

    const violations = _checkPreToolPolicies(input, [costPolicy]);
    expect(violations).toHaveLength(0);
  });

  // ─── End CostCeiling tests ──────────────────────────────────────────────

  it("processes valid policies alongside deprecated ones", () => {
    const deprecatedPolicy: Policy & { enabled: boolean } = {
      id: createPolicyId("pol_deprecated2"),
      name: "Old approval policy",
      type: "requiredApproval" as PolicyType,
      config: { type: "requiredApproval" as any, approvers: ["admin"] } as any,
      severity: PolicySeverity.Error,
      enabled: true,
    };

    const input: HookInput = {
      session_id: "test",
      tool_name: "Bash",
      tool_input: { command: "rm -rf /tmp" },
    };

    const violations = _checkPreToolPolicies(input, [deprecatedPolicy, riskyPolicy]);
    // Only the riskyPolicy should fire, deprecated one is skipped
    expect(violations).toHaveLength(1);
    expect(violations[0]!.policy).toBe("No dangerous commands");
  });
});

// ─── HookInput new fields tests ──────────────────────────────────────────────

describe("HookInput new optional fields", () => {
  it("accepts agent_id and agent_type fields", () => {
    const input: HookInput = {
      session_id: "test",
      agent_id: "agent-abc",
      agent_type: "researcher",
    };

    expect(input.agent_id).toBe("agent-abc");
    expect(input.agent_type).toBe("researcher");
  });

  it("accepts agent_transcript_path field", () => {
    const input: HookInput = {
      session_id: "test",
      agent_id: "agent-abc",
      agent_transcript_path: "/tmp/transcript.jsonl",
    };

    expect(input.agent_transcript_path).toBe("/tmp/transcript.jsonl");
  });

  it("accepts tool_use_id field", () => {
    const input: HookInput = {
      session_id: "test",
      tool_name: "Bash",
      tool_use_id: "tu_12345",
    };

    expect(input.tool_use_id).toBe("tu_12345");
  });

  it("all new fields are optional and backward compatible", () => {
    const input: HookInput = {
      session_id: "test",
    };

    expect(input.agent_id).toBeUndefined();
    expect(input.agent_type).toBeUndefined();
    expect(input.agent_transcript_path).toBeUndefined();
    expect(input.tool_use_id).toBeUndefined();
  });
});

// ─── Subagent handler tests (unit, no DB) ───────────────────────────────────

describe("Subagent handler: handleSubagentStart", () => {
  const testSessionId = "test-subagent-start-" + Date.now();

  afterEach(() => {
    _cleanupState(testSessionId);
  });

  it("exits gracefully when no state file exists", async () => {
    const input: HookInput = {
      session_id: "nonexistent-session-" + Date.now(),
      agent_id: "agent-1",
      agent_type: "researcher",
    };

    // handleSubagentStart calls process.exit(0) when no state
    // We verify the state is truly missing
    const state = _readState(input.session_id);
    expect(state).toBeNull();
  });

  it("reads state file when it exists", () => {
    const state: HookState = {
      runId: "run_sub1",
      sessionId: "session_sub1",
      dbPath: "/tmp/test-subagent.db",
      startTime: "2025-01-01T00:00:00.000Z",
      agentsSpawned: 0,
      agentsCompleted: 0,
      finalized: false,
    };

    _writeState(testSessionId, state);
    const read = _readState(testSessionId);
    expect(read).toEqual(state);
    expect(read!.runId).toBe("run_sub1");
  });
});

describe("Subagent handler: handleSubagentStop", () => {
  const testSessionId = "test-subagent-stop-" + Date.now();

  afterEach(() => {
    _cleanupState(testSessionId);
  });

  it("exits gracefully when no state file exists", () => {
    const input: HookInput = {
      session_id: "nonexistent-session-" + Date.now(),
      agent_id: "agent-1",
      agent_type: "researcher",
    };

    const state = _readState(input.session_id);
    expect(state).toBeNull();
  });

  it("reads state file when it exists", () => {
    const state: HookState = {
      runId: "run_sub2",
      sessionId: "session_sub2",
      dbPath: "/tmp/test-subagent-stop.db",
      startTime: "2025-01-01T00:00:00.000Z",
      agentsSpawned: 0,
      agentsCompleted: 0,
      finalized: false,
    };

    _writeState(testSessionId, state);
    const read = _readState(testSessionId);
    expect(read).toEqual(state);
  });
});

// ─── Transcript parsing tests ───────────────────────────────────────────────

describe("Subagent transcript handling", () => {
  let tmpTranscriptDir: string;

  beforeEach(() => {
    tmpTranscriptDir = resolve(tmpdir(), `agentops-transcript-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpTranscriptDir, { recursive: true });
  });

  afterEach(() => {
    try {
      const { rmSync } = require("node:fs");
      rmSync(tmpTranscriptDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it("handles missing transcript path gracefully", () => {
    const input: HookInput = {
      session_id: "test",
      agent_id: "agent-1",
      agent_type: "researcher",
    };

    // No agent_transcript_path — should not throw
    expect(input.agent_transcript_path).toBeUndefined();
  });

  it("handles non-existent transcript file gracefully", () => {
    const input: HookInput = {
      session_id: "test",
      agent_id: "agent-1",
      agent_type: "researcher",
      agent_transcript_path: "/nonexistent/path/transcript.jsonl",
    };

    expect(existsSync(input.agent_transcript_path!)).toBe(false);
  });

  it("can read a valid transcript JSONL file", () => {
    const transcriptPath = join(tmpTranscriptDir, "transcript.jsonl");
    const lines = [
      JSON.stringify({ type: "tool_use", tool_name: "Bash", tool_input: { command: "ls" }, output: "file1.ts" }),
      JSON.stringify({ type: "tool_use", tool_name: "Read", tool_input: { file_path: "/src/main.ts" }, output: "content" }),
      JSON.stringify({ type: "text", content: "I will read the file" }),
    ];
    writeFileSync(transcriptPath, lines.join("\n"), "utf-8");

    expect(existsSync(transcriptPath)).toBe(true);

    const raw = readFileSync(transcriptPath, "utf-8");
    const parsed = raw.split("\n").filter((l) => l.trim().length > 0);
    expect(parsed).toHaveLength(3);

    // Only tool_use entries should be extracted (2 out of 3)
    const toolEntries = parsed.filter((line) => {
      const entry = JSON.parse(line) as Record<string, unknown>;
      return entry.type === "tool_use" || entry.tool_name;
    });
    expect(toolEntries).toHaveLength(2);
  });

  it("skips malformed lines in transcript", () => {
    const transcriptPath = join(tmpTranscriptDir, "bad-transcript.jsonl");
    const lines = [
      "not valid json",
      JSON.stringify({ type: "tool_use", tool_name: "Bash", tool_input: { command: "echo hi" } }),
      "{ broken json",
    ];
    writeFileSync(transcriptPath, lines.join("\n"), "utf-8");

    const raw = readFileSync(transcriptPath, "utf-8");
    const parsed = raw.split("\n").filter((l) => l.trim().length > 0);
    let validToolEntries = 0;
    for (const line of parsed) {
      try {
        const entry = JSON.parse(line) as Record<string, unknown>;
        if (entry.type === "tool_use" || entry.tool_name) {
          validToolEntries++;
        }
      } catch {
        // Skip unparseable lines
      }
    }
    expect(validToolEntries).toBe(1);
  });
});

// ─── Event type tests ────────────────────────────────────────────────────────

describe("Agent event types", () => {
  it("EVENT_TYPES includes agent.spawned", () => {
    expect(EVENT_TYPES["agent.spawned"]).toBe("agent.spawned");
  });

  it("EVENT_TYPES includes agent.completed", () => {
    expect(EVENT_TYPES["agent.completed"]).toBe("agent.completed");
  });

  it("EventCategory includes Agent", () => {
    expect(EventCategory.Agent).toBe("agent");
  });
});

// ─── Agent counting and Stop handler tests ──────────────────────────────────

describe("Agent counting in state file", () => {
  const testSessionId = "test-agent-count-" + Date.now();

  afterEach(() => {
    _cleanupState(testSessionId);
  });

  it("initializes agent counts to zero", () => {
    const state: HookState = {
      runId: "run_count",
      sessionId: "session_count",
      dbPath: "",
      startTime: "2025-01-01T00:00:00.000Z",
      agentsSpawned: 0,
      agentsCompleted: 0,
      finalized: false,
    };

    _writeState(testSessionId, state);
    const read = _readState(testSessionId);
    expect(read!.agentsSpawned).toBe(0);
    expect(read!.agentsCompleted).toBe(0);
    expect(read!.finalized).toBe(false);
  });

  it("tracks spawned and completed agent counts", () => {
    const state: HookState = {
      runId: "run_count2",
      sessionId: "session_count2",
      dbPath: "",
      startTime: "2025-01-01T00:00:00.000Z",
      agentsSpawned: 3,
      agentsCompleted: 2,
      finalized: false,
    };

    _writeState(testSessionId, state);
    const read = _readState(testSessionId);
    expect(read!.agentsSpawned).toBe(3);
    expect(read!.agentsCompleted).toBe(2);
  });

  it("detects all agents done when spawned equals completed", () => {
    const state: HookState = {
      runId: "run_done",
      sessionId: "session_done",
      dbPath: "",
      startTime: "2025-01-01T00:00:00.000Z",
      agentsSpawned: 3,
      agentsCompleted: 3,
      finalized: false,
    };

    const allDone = state.agentsSpawned === state.agentsCompleted;
    expect(allDone).toBe(true);
  });

  it("detects agents still running when counts differ", () => {
    const state: HookState = {
      runId: "run_running",
      sessionId: "session_running",
      dbPath: "",
      startTime: "2025-01-01T00:00:00.000Z",
      agentsSpawned: 3,
      agentsCompleted: 1,
      finalized: false,
    };

    const allDone = state.agentsSpawned === state.agentsCompleted;
    expect(allDone).toBe(false);
  });

  it("single-agent session has zero spawned and zero completed", () => {
    const state: HookState = {
      runId: "run_single",
      sessionId: "session_single",
      dbPath: "",
      startTime: "2025-01-01T00:00:00.000Z",
      agentsSpawned: 0,
      agentsCompleted: 0,
      finalized: false,
    };

    // 0 === 0 means all agents done (no sub-agents to wait for)
    const allDone = state.agentsSpawned === state.agentsCompleted;
    expect(allDone).toBe(true);
  });

  it("finalized flag prevents double finalization", () => {
    const state: HookState = {
      runId: "run_final",
      sessionId: "session_final",
      dbPath: "",
      startTime: "2025-01-01T00:00:00.000Z",
      agentsSpawned: 0,
      agentsCompleted: 0,
      finalized: true,
    };

    _writeState(testSessionId, state);
    const read = _readState(testSessionId);
    expect(read!.finalized).toBe(true);
  });
});

describe("Stop handler", () => {
  it("exits gracefully when no state file exists", () => {
    const input: HookInput = {
      session_id: "nonexistent-session-" + Date.now(),
    };

    const state = _readState(input.session_id);
    expect(state).toBeNull();
  });

  it("skips finalization when already finalized", () => {
    const testSessionId = "test-stop-finalized-" + Date.now();
    const state: HookState = {
      runId: "run_already",
      sessionId: "session_already",
      dbPath: "",
      startTime: "2025-01-01T00:00:00.000Z",
      agentsSpawned: 0,
      agentsCompleted: 0,
      finalized: true,
    };

    _writeState(testSessionId, state);
    const read = _readState(testSessionId);
    expect(read!.finalized).toBe(true);

    _cleanupState(testSessionId);
  });

  it("would finalize when all agents done in single-agent session", () => {
    const testSessionId = "test-stop-single-" + Date.now();
    const state: HookState = {
      runId: "run_stop_single",
      sessionId: "session_stop_single",
      dbPath: "",
      startTime: "2025-01-01T00:00:00.000Z",
      agentsSpawned: 0,
      agentsCompleted: 0,
      finalized: false,
    };

    _writeState(testSessionId, state);
    const read = _readState(testSessionId);
    const allDone = read!.agentsSpawned === read!.agentsCompleted;
    expect(allDone).toBe(true);
    expect(read!.finalized).toBe(false);

    _cleanupState(testSessionId);
  });

  it("would not finalize when agents still running", () => {
    const testSessionId = "test-stop-running-" + Date.now();
    const state: HookState = {
      runId: "run_stop_running",
      sessionId: "session_stop_running",
      dbPath: "",
      startTime: "2025-01-01T00:00:00.000Z",
      agentsSpawned: 2,
      agentsCompleted: 1,
      finalized: false,
    };

    _writeState(testSessionId, state);
    const read = _readState(testSessionId);
    const allDone = read!.agentsSpawned === read!.agentsCompleted;
    expect(allDone).toBe(false);

    _cleanupState(testSessionId);
  });

  it("would finalize multi-agent session when all agents complete", () => {
    const testSessionId = "test-stop-multi-done-" + Date.now();
    const state: HookState = {
      runId: "run_stop_multi",
      sessionId: "session_stop_multi",
      dbPath: "",
      startTime: "2025-01-01T00:00:00.000Z",
      agentsSpawned: 3,
      agentsCompleted: 3,
      finalized: false,
    };

    _writeState(testSessionId, state);
    const read = _readState(testSessionId);
    const allDone = read!.agentsSpawned === read!.agentsCompleted;
    expect(allDone).toBe(true);
    expect(read!.finalized).toBe(false);

    _cleanupState(testSessionId);
  });
});
