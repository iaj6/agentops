import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  _readState,
  _cleanupState,
  _handleSessionStart,
  _handleUserPromptSubmit,
  _handlePreToolUse,
  _handlePostToolUse,
  _handleSessionEnd,
  _handleStop,
  _handleSubagentStop,
  stateFilePath,
  type HookInput,
} from "../commands/hook.js";
import {
  getDb,
  insertPolicy,
  listRuns,
  listSessions,
  getRun,
  getSession,
  getPolicyResults,
  listEvents,
} from "@agentops/db";
import {
  createPolicyId,
  createRunId,
  createSessionId,
  PolicyType,
  PolicySeverity,
} from "@agentops/core";

// ─── Test harness ──────────────────────────────────────────────────────────
//
// Hook handlers call process.exit() at well-defined points. We need to
// capture the exit code without actually killing the test process, and we
// want to assert on stdout/stderr (block JSON, warnings). The runHook
// helper wraps a single handler invocation in all of that.

class ExitError extends Error {
  constructor(public readonly code: number | undefined) {
    super(`process.exit(${code})`);
  }
}

interface HookResult {
  exitCode: number | undefined;
  stdout: string;
  stderr: string;
}

async function runHook(fn: () => Promise<void>): Promise<HookResult> {
  let exitCode: number | undefined = undefined;
  let stdout = "";
  let stderr = "";

  const exitSpy = vi
    .spyOn(process, "exit")
    .mockImplementation(((code?: number) => {
      exitCode = code;
      throw new ExitError(code);
    }) as never);
  const outSpy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation(((chunk: unknown) => {
      stdout += String(chunk);
      return true;
    }) as never);
  const errSpy = vi
    .spyOn(process.stderr, "write")
    .mockImplementation(((chunk: unknown) => {
      stderr += String(chunk);
      return true;
    }) as never);

  try {
    await fn();
  } catch (e) {
    if (!(e instanceof ExitError)) throw e;
  } finally {
    exitSpy.mockRestore();
    outSpy.mockRestore();
    errSpy.mockRestore();
  }

  return { exitCode, stdout, stderr };
}

let testDbPath: string;
let usedSessionIds: string[];
let tmpHome: string;
let originalHome: string | undefined;
let originalUserProfile: string | undefined;

beforeEach(() => {
  // Redirect HOME to a tmpdir so resolveOpsConfig() can't pick up the
  // test runner's real ~/.agentops/credentials.json and flip into SDK
  // mode. Also keeps state files, log files, and transcript fixtures
  // scoped to this test run.
  tmpHome = resolve(
    tmpdir(),
    `agentops-hook-test-home-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(tmpHome, { recursive: true });
  originalHome = process.env["HOME"];
  originalUserProfile = process.env["USERPROFILE"];
  process.env["HOME"] = tmpHome;
  process.env["USERPROFILE"] = tmpHome;

  // Real on-disk SQLite so insertions persist across getDb() calls.
  testDbPath = resolve(
    tmpHome,
    `agentops-hook-handler-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );
  usedSessionIds = [];
});

afterEach(() => {
  for (const sid of usedSessionIds) {
    _cleanupState(sid);
  }
  // tmpHome cleanup handles state files, log files, transcripts.
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

function freshSessionId(): string {
  const id = `t${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  usedSessionIds.push(id);
  return id;
}

// Helpers for transcripts (so cost-ceiling tests can simulate token usage).

function transcriptDirFor(cwd: string): string {
  const encoded = cwd.replace(/\//g, "-");
  return join(process.env["HOME"] ?? "/tmp", ".claude", "projects", encoded);
}

function writeFakeTranscript(
  cwd: string,
  sessionId: string,
  usageEntries: ReadonlyArray<{
    model: string;
    input?: number;
    output?: number;
    cache_read?: number;
    cache_write?: number;
  }>,
): void {
  const dir = transcriptDirFor(cwd);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${sessionId}.jsonl`);
  const lines = usageEntries.map((u) =>
    JSON.stringify({
      type: "assistant",
      message: {
        model: u.model,
        usage: {
          input_tokens: u.input ?? 0,
          output_tokens: u.output ?? 0,
          cache_read_input_tokens: u.cache_read ?? 0,
          cache_creation_input_tokens: u.cache_write ?? 0,
        },
      },
    }),
  );
  writeFileSync(path, lines.join("\n") + "\n", "utf-8");
}

function cleanupTranscriptFile(sessionId: string, cwd: string): void {
  const path = join(transcriptDirFor(cwd), `${sessionId}.jsonl`);
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    /* ignore */
  }
}

// ─── handleSessionStart ────────────────────────────────────────────────────

describe("handleSessionStart (DirectOps mode)", () => {
  it("creates a session, a run, and emits run.started", async () => {
    const sid = freshSessionId();
    const input: HookInput = { session_id: sid, cwd: "/tmp/test-cwd" };

    await _handleSessionStart(input, testDbPath);

    const state = _readState(sid);
    expect(state).not.toBeNull();
    expect(state!.runId).toBeTruthy();
    expect(state!.sessionId).toBeTruthy();
    expect(state!.serverUrl).toBeUndefined(); // direct mode
    expect(state!.cwd).toBe("/tmp/test-cwd");

    const db = getDb(testDbPath);
    const run = getRun(db, createRunId(state!.runId));
    expect(run).not.toBeNull();
    expect(run!.status).toBe("running");

    const session = getSession(db, createSessionId(state!.sessionId));
    expect(session).not.toBeNull();
    expect(session!.status).toBe("active");

    const events = listEvents(db, { limit: 10 });
    const startedEvent = events.find(
      (e) => e.type === "run.started" && e.sourceId === state!.runId,
    );
    expect(startedEvent).toBeDefined();
  });

  it("writes a state file with mode 0600 perms-adjacent", async () => {
    const sid = freshSessionId();
    await _handleSessionStart({ session_id: sid, cwd: "/tmp/test-cwd" }, testDbPath);

    const path = stateFilePath(sid);
    expect(existsSync(path)).toBe(true);
    // We don't easily test the file mode cross-platform; just verify the
    // content is valid JSON with the expected shape.
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.runId).toBeTruthy();
    expect(parsed.sessionId).toBeTruthy();
  });
});

// ─── handleUserPromptSubmit ────────────────────────────────────────────────

describe("handleUserPromptSubmit (DirectOps mode)", () => {
  it("no state file → exits 0 silently (fail-open default)", async () => {
    const sid = freshSessionId();
    const result = await runHook(() =>
      _handleUserPromptSubmit({ session_id: sid }, testDbPath),
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("no policies → exits 0 (allow)", async () => {
    const sid = freshSessionId();
    await _handleSessionStart({ session_id: sid, cwd: "/tmp/test-cwd" }, testDbPath);

    const result = await runHook(() =>
      _handleUserPromptSubmit({ session_id: sid, cwd: "/tmp/test-cwd" }, testDbPath),
    );
    expect(result.exitCode).toBe(0);
  });

  it("cost under ceiling → exits 0 (allow)", async () => {
    const sid = freshSessionId();
    const cwd = "/tmp/test-cwd";
    await _handleSessionStart({ session_id: sid, cwd }, testDbPath);

    insertPolicy(getDb(testDbPath), {
      id: createPolicyId("p_cost"),
      name: "Ceiling $5",
      type: PolicyType.CostCeiling,
      config: { type: PolicyType.CostCeiling, maxUsd: 5 },
      severity: PolicySeverity.Error,
      enabled: true,
      createdAt: new Date().toISOString(),
    });

    // Tiny usage well under the ceiling.
    writeFakeTranscript(cwd, sid, [{ model: "claude-opus-4-7", input: 100 }]);

    const result = await runHook(() =>
      _handleUserPromptSubmit({ session_id: sid, cwd }, testDbPath),
    );
    expect(result.exitCode).toBe(0);
    cleanupTranscriptFile(sid, cwd);
  });

  it("cost over ceiling → exits 2 with block JSON", async () => {
    const sid = freshSessionId();
    const cwd = "/tmp/test-cwd";
    await _handleSessionStart({ session_id: sid, cwd }, testDbPath);

    insertPolicy(getDb(testDbPath), {
      id: createPolicyId("p_cost"),
      name: "Ceiling $0.01",
      type: PolicyType.CostCeiling,
      config: { type: PolicyType.CostCeiling, maxUsd: 0.01 },
      severity: PolicySeverity.Error,
      enabled: true,
      createdAt: new Date().toISOString(),
    });

    // ~$0.075 of usage on opus-4-7 — blows past the $0.01 ceiling.
    writeFakeTranscript(cwd, sid, [{ model: "claude-opus-4-7", input: 5000 }]);

    const result = await runHook(() =>
      _handleUserPromptSubmit({ session_id: sid, cwd }, testDbPath),
    );

    expect(result.exitCode).toBe(2);
    const decision = JSON.parse(result.stdout);
    expect(decision.decision).toBe("block");
    expect(decision.reason).toContain("Cost ceiling reached");
    cleanupTranscriptFile(sid, cwd);
  });

  it("emits policy.violated event with source=turn-boundary on block", async () => {
    const sid = freshSessionId();
    const cwd = "/tmp/test-cwd";
    await _handleSessionStart({ session_id: sid, cwd }, testDbPath);
    const state = _readState(sid)!;

    insertPolicy(getDb(testDbPath), {
      id: createPolicyId("p_audit"),
      name: "Audit ceiling",
      type: PolicyType.CostCeiling,
      config: { type: PolicyType.CostCeiling, maxUsd: 0.01 },
      severity: PolicySeverity.Error,
      enabled: true,
      createdAt: new Date().toISOString(),
    });
    writeFakeTranscript(cwd, sid, [{ model: "claude-opus-4-7", input: 5000 }]);

    await runHook(() => _handleUserPromptSubmit({ session_id: sid, cwd }, testDbPath));

    const events = listEvents(getDb(testDbPath), { limit: 20 });
    const violation = events.find(
      (e) => e.type === "policy.violated" && e.sourceId === state.runId,
    );
    expect(violation).toBeDefined();
    expect((violation!.payload as { source?: string }).source).toBe("turn-boundary");
    cleanupTranscriptFile(sid, cwd);
  });

  it("writes a policy_result row with source=turn-boundary on block", async () => {
    const sid = freshSessionId();
    const cwd = "/tmp/test-cwd";
    await _handleSessionStart({ session_id: sid, cwd }, testDbPath);
    const state = _readState(sid)!;

    insertPolicy(getDb(testDbPath), {
      id: createPolicyId("p_history"),
      name: "History ceiling",
      type: PolicyType.CostCeiling,
      config: { type: PolicyType.CostCeiling, maxUsd: 0.01 },
      severity: PolicySeverity.Error,
      enabled: true,
      createdAt: new Date().toISOString(),
    });
    writeFakeTranscript(cwd, sid, [{ model: "claude-opus-4-7", input: 5000 }]);

    await runHook(() => _handleUserPromptSubmit({ session_id: sid, cwd }, testDbPath));

    const results = getPolicyResults(getDb(testDbPath), state.runId);
    const blockRow = results.find((r) => r.policyId === "p_history");
    expect(blockRow).toBeDefined();
    expect(blockRow!.passed).toBe(false);
    expect((blockRow!.details as { source?: string }).source).toBe("turn-boundary");
    cleanupTranscriptFile(sid, cwd);
  });
});

// ─── handlePreToolUse ──────────────────────────────────────────────────────

describe("handlePreToolUse (DirectOps mode)", () => {
  it("no state file → exits 0 silently", async () => {
    const sid = freshSessionId(); // not started
    const result = await runHook(() =>
      _handlePreToolUse(
        {
          session_id: sid,
          cwd: "/tmp/test-cwd",
          tool_name: "Bash",
          tool_input: { command: "ls" },
        },
        testDbPath,
      ),
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("allow path: no policies → exits 0 with no stdout", async () => {
    const sid = freshSessionId();
    await _handleSessionStart({ session_id: sid, cwd: "/tmp/test-cwd" }, testDbPath);

    const result = await runHook(() =>
      _handlePreToolUse(
        {
          session_id: sid,
          cwd: "/tmp/test-cwd",
          tool_name: "Bash",
          tool_input: { command: "ls" },
        },
        testDbPath,
      ),
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("block path: risky-op policy violation → exits 2 with JSON block", async () => {
    const sid = freshSessionId();
    await _handleSessionStart({ session_id: sid, cwd: "/tmp/test-cwd" }, testDbPath);

    insertPolicy(getDb(testDbPath), {
      id: createPolicyId("p_risky"),
      name: "No rm -rf",
      type: PolicyType.RiskyOpFlag,
      config: { type: PolicyType.RiskyOpFlag, riskyPatterns: ["rm -rf"] },
      severity: PolicySeverity.Error,
      enabled: true,
      createdAt: new Date().toISOString(),
    });

    const result = await runHook(() =>
      _handlePreToolUse(
        {
          session_id: sid,
          cwd: "/tmp/test-cwd",
          tool_name: "Bash",
          tool_input: { command: "rm -rf /tmp/x" },
        },
        testDbPath,
      ),
    );

    expect(result.exitCode).toBe(2);
    const decision = JSON.parse(result.stdout);
    expect(decision.decision).toBe("block");
    expect(decision.reason).toContain("No rm -rf");

    // B4: pre-tool block also writes a policy_result row so the
    // Policy detail page's Evaluation History accumulates the trail.
    const state = _readState(sid)!;
    const results = getPolicyResults(getDb(testDbPath), createRunId(state.runId));
    const blockRow = results.find((r) => r.policyId === "p_risky");
    expect(blockRow).toBeDefined();
    expect(blockRow!.passed).toBe(false);
    expect((blockRow!.details as { source?: string }).source).toBe("pre-tool");
  });

  it("warning severity → stderr message, exits 0", async () => {
    const sid = freshSessionId();
    await _handleSessionStart({ session_id: sid, cwd: "/tmp/test-cwd" }, testDbPath);

    insertPolicy(getDb(testDbPath), {
      id: createPolicyId("p_warn"),
      name: "Branch warn",
      type: PolicyType.BranchProtection,
      config: { type: PolicyType.BranchProtection, protectedBranches: ["main"] },
      severity: PolicySeverity.Warning,
      enabled: true,
      createdAt: new Date().toISOString(),
    });

    // The session-start auto-detected branch will be whatever this repo is
    // checked out on. We mutate the stored run's environment.branch so the
    // warning fires deterministically.
    const state = _readState(sid)!;
    const db = getDb(testDbPath);
    const run = getRun(db, createRunId(state.runId))!;
    const { updateRun } = await import("@agentops/db");
    updateRun(db, createRunId(state.runId), {
      environment: { ...run.environment, branch: "main" },
    });

    const result = await runHook(() =>
      _handlePreToolUse(
        {
          session_id: sid,
          cwd: "/tmp/test-cwd",
          tool_name: "Edit",
          tool_input: { file_path: "/src/x.ts" },
        },
        testDbPath,
      ),
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("Branch warn");
  });

  it("CostCeiling: cumulative cost over limit → block with cost-ceiling reason", async () => {
    const sid = freshSessionId();
    const cwd = "/tmp/test-cwd";
    await _handleSessionStart({ session_id: sid, cwd }, testDbPath);

    insertPolicy(getDb(testDbPath), {
      id: createPolicyId("p_cost"),
      name: "Ceiling $0.01",
      type: PolicyType.CostCeiling,
      config: { type: PolicyType.CostCeiling, maxUsd: 0.01 },
      severity: PolicySeverity.Error,
      enabled: true,
      createdAt: new Date().toISOString(),
    });

    // Simulate $0.075 of usage: 5000 base input tokens on opus 4.7.
    writeFakeTranscript(cwd, sid, [
      { model: "claude-opus-4-7", input: 5000 },
    ]);

    const result = await runHook(() =>
      _handlePreToolUse(
        {
          session_id: sid,
          cwd,
          tool_name: "Bash",
          tool_input: { command: "ls" },
        },
        testDbPath,
      ),
    );

    expect(result.exitCode).toBe(2);
    const decision = JSON.parse(result.stdout);
    expect(decision.decision).toBe("block");
    expect(decision.reason).toContain("Cost ceiling reached");
  });
});

// ─── handlePostToolUse ─────────────────────────────────────────────────────

describe("handlePostToolUse (DirectOps mode)", () => {
  it("no state file → exits 0 silently", async () => {
    const sid = freshSessionId();
    const result = await runHook(() =>
      _handlePostToolUse(
        {
          session_id: sid,
          tool_name: "Bash",
          tool_input: { command: "ls" },
        },
        testDbPath,
      ),
    );
    expect(result.exitCode).toBe(0);
  });

  it("records an action on the active run", async () => {
    const sid = freshSessionId();
    await _handleSessionStart({ session_id: sid, cwd: "/tmp/test-cwd" }, testDbPath);
    const state = _readState(sid)!;

    await runHook(() =>
      _handlePostToolUse(
        {
          session_id: sid,
          cwd: "/tmp/test-cwd",
          tool_name: "Bash",
          tool_input: { command: "ls" },
          tool_response: { stdout: "file1\nfile2" },
        },
        testDbPath,
      ),
    );

    const run = getRun(getDb(testDbPath), createRunId(state.runId))!;
    expect(run.actions.length).toBe(1);
    expect(run.actions[0]!.toolCalls[0]!.name).toBe("Bash");
    expect(run.actions[0]!.commands.length).toBe(1);
  });

  it("emits action.taken event", async () => {
    const sid = freshSessionId();
    await _handleSessionStart({ session_id: sid, cwd: "/tmp/test-cwd" }, testDbPath);
    const state = _readState(sid)!;

    await runHook(() =>
      _handlePostToolUse(
        {
          session_id: sid,
          tool_name: "Edit",
          tool_input: { file_path: "/x.ts" },
        },
        testDbPath,
      ),
    );

    const events = listEvents(getDb(testDbPath), { limit: 20 });
    const taken = events.find(
      (e) => e.type === "action.taken" && e.sourceId === state.runId,
    );
    expect(taken).toBeDefined();
  });
});

// ─── handleStop ────────────────────────────────────────────────────────────

describe("handleStop", () => {
  it("no state file → exits 0 silently", async () => {
    const sid = freshSessionId();
    const result = await runHook(() => _handleStop({ session_id: sid }, testDbPath));
    expect(result.exitCode).toBe(0);
  });

  it("with state file → still exits 0 (Stop is informational only)", async () => {
    const sid = freshSessionId();
    await _handleSessionStart({ session_id: sid, cwd: "/tmp/test-cwd" }, testDbPath);
    const state = _readState(sid)!;

    const result = await runHook(() =>
      _handleStop({ session_id: sid, cwd: "/tmp/test-cwd" }, testDbPath),
    );

    expect(result.exitCode).toBe(0);
    // Run should NOT be completed after Stop — that's SessionEnd's job.
    const run = getRun(getDb(testDbPath), createRunId(state.runId))!;
    expect(run.status).toBe("running");
  });
});

// ─── handleSessionEnd / finalizeSession ───────────────────────────────────

describe("handleSessionEnd", () => {
  it("finalizes the run, terminates session, deletes state file", async () => {
    const sid = freshSessionId();
    await _handleSessionStart({ session_id: sid, cwd: "/tmp/test-cwd" }, testDbPath);
    const state = _readState(sid)!;

    await runHook(() =>
      _handleSessionEnd({ session_id: sid, cwd: "/tmp/test-cwd" }, testDbPath),
    );

    const db = getDb(testDbPath);
    const run = getRun(db, createRunId(state.runId))!;
    expect(run.status).toBe("completed");

    const session = getSession(db, createSessionId(state.sessionId))!;
    expect(session.status).toBe("terminated");
    expect(session.terminatedAt).toBeTruthy();

    expect(existsSync(stateFilePath(sid))).toBe(false);
  });

  it("populates run metrics from the transcript", async () => {
    const sid = freshSessionId();
    const cwd = "/tmp/test-cwd";
    await _handleSessionStart({ session_id: sid, cwd }, testDbPath);
    const state = _readState(sid)!;

    // $15 of usage exactly: 1M base input tokens on Opus 4.7 ($15/M).
    writeFakeTranscript(cwd, sid, [
      { model: "claude-opus-4-7", input: 1_000_000 },
    ]);

    await runHook(() => _handleSessionEnd({ session_id: sid, cwd }, testDbPath));

    const run = getRun(getDb(testDbPath), createRunId(state.runId))!;
    expect(run.metrics.costUsd).toBeCloseTo(15, 4);
    expect(run.metrics.tokenUsage.input).toBe(1_000_000);
  });

  it("emits run.completed event", async () => {
    const sid = freshSessionId();
    await _handleSessionStart({ session_id: sid, cwd: "/tmp/test-cwd" }, testDbPath);
    const state = _readState(sid)!;

    await runHook(() =>
      _handleSessionEnd({ session_id: sid, cwd: "/tmp/test-cwd" }, testDbPath),
    );

    const events = listEvents(getDb(testDbPath), { limit: 20 });
    const completed = events.find(
      (e) => e.type === "run.completed" && e.sourceId === state.runId,
    );
    expect(completed).toBeDefined();
  });

  it("already-finalized state → cleans up without re-finalizing", async () => {
    const sid = freshSessionId();
    await _handleSessionStart({ session_id: sid, cwd: "/tmp/test-cwd" }, testDbPath);

    // First end finalizes.
    await runHook(() =>
      _handleSessionEnd({ session_id: sid, cwd: "/tmp/test-cwd" }, testDbPath),
    );
    expect(existsSync(stateFilePath(sid))).toBe(false);

    // Second end is a no-op (state file gone).
    const result = await runHook(() =>
      _handleSessionEnd({ session_id: sid, cwd: "/tmp/test-cwd" }, testDbPath),
    );
    expect(result.exitCode).toBe(0);
  });

  it("writes a policy_result row per active policy (B4 rollup)", async () => {
    const sid = freshSessionId();
    await _handleSessionStart({ session_id: sid, cwd: "/tmp/test-cwd" }, testDbPath);

    insertPolicy(getDb(testDbPath), {
      id: createPolicyId("p_rollup_local"),
      name: "Local rollup",
      type: PolicyType.RiskyOpFlag,
      config: { type: PolicyType.RiskyOpFlag, riskyPatterns: ["rm -rf"] },
      severity: PolicySeverity.Error,
      enabled: true,
      createdAt: new Date().toISOString(),
    });

    const state = _readState(sid)!;
    await runHook(() =>
      _handleSessionEnd({ session_id: sid, cwd: "/tmp/test-cwd" }, testDbPath),
    );

    const results = getPolicyResults(
      getDb(testDbPath),
      createRunId(state.runId),
    );
    const rollup = results.find((r) => r.policyId === "p_rollup_local");
    expect(rollup).toBeDefined();
    expect((rollup!.details as { source?: string }).source).toBe("run-complete");
  });
});

// ─── handleSubagentStop ────────────────────────────────────────────────────

describe("handleSubagentStop", () => {
  it("with no state file → exits 0", async () => {
    const sid = freshSessionId();
    const result = await runHook(() =>
      _handleSubagentStop({ session_id: sid }, testDbPath),
    );
    expect(result.exitCode).toBe(0);
  });

  it("increments agentsCompleted counter", async () => {
    const sid = freshSessionId();
    await _handleSessionStart({ session_id: sid, cwd: "/tmp/test-cwd" }, testDbPath);

    await runHook(() =>
      _handleSubagentStop(
        { session_id: sid, agent_id: "sub-1", agent_type: "researcher" },
        testDbPath,
      ),
    );

    const state = _readState(sid)!;
    expect(state.agentsCompleted).toBe(1);
  });

  it("rejects transcript paths outside ~/.claude/projects/", async () => {
    const sid = freshSessionId();
    await _handleSessionStart({ session_id: sid, cwd: "/tmp/test-cwd" }, testDbPath);
    const state = _readState(sid)!;

    // Spoofed transcript path that points OUTSIDE the safe root.
    const tmpFile = resolve(
      tmpdir(),
      `agentops-spoof-${Date.now()}.jsonl`,
    );
    writeFileSync(
      tmpFile,
      JSON.stringify({
        type: "tool_use",
        tool_name: "Bash",
        tool_input: { command: "rm -rf /" },
      }) + "\n",
      "utf-8",
    );

    await runHook(() =>
      _handleSubagentStop(
        {
          session_id: sid,
          agent_transcript_path: tmpFile,
        },
        testDbPath,
      ),
    );

    // No actions should have been recorded — the path was rejected.
    const run = getRun(getDb(testDbPath), createRunId(state.runId))!;
    expect(run.actions).toHaveLength(0);

    try {
      unlinkSync(tmpFile);
    } catch {
      /* ignore */
    }
  });
});

// ─── Fail-closed enforcement (AGENTOPS_FAIL_CLOSED=1) ──────────────────────

describe("AGENTOPS_FAIL_CLOSED behaviour", () => {
  let savedFailClosed: string | undefined;

  beforeEach(() => {
    savedFailClosed = process.env["AGENTOPS_FAIL_CLOSED"];
  });

  afterEach(() => {
    if (savedFailClosed === undefined) delete process.env["AGENTOPS_FAIL_CLOSED"];
    else process.env["AGENTOPS_FAIL_CLOSED"] = savedFailClosed;
  });

  it("PreToolUse with no state + fail-closed → exits 2 with block JSON", async () => {
    process.env["AGENTOPS_FAIL_CLOSED"] = "1";
    const sid = freshSessionId();

    const result = await runHook(() =>
      _handlePreToolUse(
        {
          session_id: sid,
          cwd: "/tmp/test-cwd",
          tool_name: "Bash",
          tool_input: { command: "ls" },
        },
        testDbPath,
      ),
    );

    expect(result.exitCode).toBe(2);
    const decision = JSON.parse(result.stdout);
    expect(decision.decision).toBe("block");
    expect(decision.reason).toContain("offline");
    // Recovery hint must be in the block message so the operator can self-unstick.
    expect(decision.reason).toContain("AGENTOPS_FAIL_CLOSED");
  });

  it("PreToolUse with no state + fail-closed unset → still allows (default)", async () => {
    delete process.env["AGENTOPS_FAIL_CLOSED"];
    const sid = freshSessionId();

    const result = await runHook(() =>
      _handlePreToolUse(
        {
          session_id: sid,
          tool_name: "Bash",
          tool_input: { command: "ls" },
        },
        testDbPath,
      ),
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("PreToolUse with no state + fail-closed=true (lowercase) → blocks", async () => {
    process.env["AGENTOPS_FAIL_CLOSED"] = "true";
    const sid = freshSessionId();

    const result = await runHook(() =>
      _handlePreToolUse(
        {
          session_id: sid,
          tool_name: "Bash",
          tool_input: { command: "ls" },
        },
        testDbPath,
      ),
    );

    expect(result.exitCode).toBe(2);
  });

  it("PreToolUse with no state + fail-closed=0 → allows (explicit off)", async () => {
    process.env["AGENTOPS_FAIL_CLOSED"] = "0";
    const sid = freshSessionId();

    const result = await runHook(() =>
      _handlePreToolUse(
        {
          session_id: sid,
          tool_name: "Bash",
          tool_input: { command: "ls" },
        },
        testDbPath,
      ),
    );

    expect(result.exitCode).toBe(0);
  });

  it("SessionStart SDK 401 + fail-closed → blocks with login hint", async () => {
    // Simulate the exact scenario observed in real Claude Code: SDK mode
    // selected from credentials.json, server returns 401, customer set
    // AGENTOPS_FAIL_CLOSED=1 because they want enforcement or nothing.
    process.env["AGENTOPS_FAIL_CLOSED"] = "1";
    const savedUrl = process.env["AGENTOPS_SERVER_URL"];
    const savedKey = process.env["AGENTOPS_API_KEY"];
    process.env["AGENTOPS_SERVER_URL"] = "http://localhost:9999";
    process.env["AGENTOPS_API_KEY"] = "ao_expired_token";

    try {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          ({
            ok: false,
            status: 401,
            json: async () => ({ error: "Invalid or expired token" }),
          }) as Response,
        ),
      );

      const sid = freshSessionId();
      const result = await runHook(() =>
        _handleSessionStart({ session_id: sid, cwd: "/tmp/test-cwd" }, testDbPath),
      );

      expect(result.exitCode).toBe(2);
      const decision = JSON.parse(result.stdout);
      expect(decision.decision).toBe("block");
      expect(decision.reason).toContain("session start failed");
      expect(decision.reason).toContain("agentops login");

      // State file must NOT exist when session-start failed.
      expect(_readState(sid)).toBeNull();
    } finally {
      vi.unstubAllGlobals();
      if (savedUrl === undefined) delete process.env["AGENTOPS_SERVER_URL"];
      else process.env["AGENTOPS_SERVER_URL"] = savedUrl;
      if (savedKey === undefined) delete process.env["AGENTOPS_API_KEY"];
      else process.env["AGENTOPS_API_KEY"] = savedKey;
    }
  });

  it("SessionStart SDK 401 + fail-closed unset → fail-open with stderr warning", async () => {
    // Same scenario, default mode: we log loudly but allow.
    delete process.env["AGENTOPS_FAIL_CLOSED"];
    const savedUrl = process.env["AGENTOPS_SERVER_URL"];
    const savedKey = process.env["AGENTOPS_API_KEY"];
    process.env["AGENTOPS_SERVER_URL"] = "http://localhost:9999";
    process.env["AGENTOPS_API_KEY"] = "ao_expired_token";

    try {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          ({
            ok: false,
            status: 401,
            json: async () => ({ error: "Invalid or expired token" }),
          }) as Response,
        ),
      );

      const sid = freshSessionId();
      const result = await runHook(() =>
        _handleSessionStart({ session_id: sid, cwd: "/tmp/test-cwd" }, testDbPath),
      );

      // No exit() called from the success path of handleSessionStart, so
      // runHook captures undefined. No stdout (no block decision).
      expect(result.stdout).toBe("");
      // stderr must contain the failure + login hint so the operator notices.
      expect(result.stderr).toContain("session start failed");
      expect(result.stderr).toContain("agentops login");
      // No state file written.
      expect(_readState(sid)).toBeNull();
    } finally {
      vi.unstubAllGlobals();
      if (savedUrl === undefined) delete process.env["AGENTOPS_SERVER_URL"];
      else process.env["AGENTOPS_SERVER_URL"] = savedUrl;
      if (savedKey === undefined) delete process.env["AGENTOPS_API_KEY"];
      else process.env["AGENTOPS_API_KEY"] = savedKey;
    }
  });
});

// ─── userId scoping in DirectOps mode ──────────────────────────────────────

describe("hook handlers and userId on inserted rows", () => {
  it("DirectOps inserts run/session with userId = null", async () => {
    const sid = freshSessionId();
    await _handleSessionStart({ session_id: sid, cwd: "/tmp/test-cwd" }, testDbPath);
    const state = _readState(sid)!;

    const runs = listRuns(getDb(testDbPath));
    const ours = runs.find((r) => (r.id as string) === state.runId);
    expect(ours).toBeDefined();
    expect(ours!.userId).toBeNull();

    const sessions = listSessions(getDb(testDbPath));
    const oursS = sessions.find((s) => (s.id as string) === state.sessionId);
    expect(oursS).toBeDefined();
    expect(oursS!.userId).toBeNull();
  });
});
