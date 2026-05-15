/**
 * Integration test: full hook lifecycle
 *
 * Drives handleSessionStart → handlePreToolUse (block) → handlePreToolUse
 * (allow) → handleSessionEnd against a single in-memory-equivalent SQLite DB
 * to verify the three handlers compose correctly as a continuous flow.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  _handleSessionStart,
  _handlePreToolUse,
  _handleSessionEnd,
  _readState,
  _cleanupState,
  stateFilePath,
  type HookInput,
} from "../commands/hook.js";
import {
  getDb,
  insertPolicy,
  listRuns,
  listSessions,
  listEvents,
  getPolicyResults,
  getRun,
  getSession,
} from "@agentops/db";
import {
  createPolicyId,
  createRunId,
  createSessionId,
  PolicyType,
  PolicySeverity,
} from "@agentops/core";

// ─── Test harness (mirrors hook-handlers.test.ts) ─────────────────────────────

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
  tmpHome = resolve(
    tmpdir(),
    `agentops-integration-test-home-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(tmpHome, { recursive: true });
  originalHome = process.env["HOME"];
  originalUserProfile = process.env["USERPROFILE"];
  process.env["HOME"] = tmpHome;
  process.env["USERPROFILE"] = tmpHome;

  testDbPath = resolve(
    tmpHome,
    `agentops-integration-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );
  usedSessionIds = [];
});

afterEach(() => {
  for (const sid of usedSessionIds) {
    _cleanupState(sid);
  }
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
  const id = `integ-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  usedSessionIds.push(id);
  return id;
}

// ─── Integration tests ─────────────────────────────────────────────────────────

describe("hook integration: full session lifecycle", () => {
  it("full session: start → block → allow → end → finalized", async () => {
    const sid = freshSessionId();
    const cwd = "/tmp/integ-test-cwd";

    // ── Step 1: seed a RiskyOpFlag policy before session start ────────────────
    insertPolicy(getDb(testDbPath), {
      id: createPolicyId("p_integ_risky"),
      name: "No rm -rf",
      type: PolicyType.RiskyOpFlag,
      config: { type: PolicyType.RiskyOpFlag, riskyPatterns: ["rm -rf"] },
      severity: PolicySeverity.Error,
      enabled: true,
      createdAt: new Date().toISOString(),
    });

    // ── Step 2: handleSessionStart ────────────────────────────────────────────
    await _handleSessionStart({ session_id: sid, cwd }, testDbPath);

    const state = _readState(sid);
    expect(state).not.toBeNull();
    expect(state!.runId).toBeTruthy();
    expect(state!.sessionId).toBeTruthy();

    const db = getDb(testDbPath);

    // run row must exist and be running
    const run = getRun(db, createRunId(state!.runId));
    expect(run).not.toBeNull();
    expect(run!.status).toBe("running");

    // session row must exist and be active
    const session = getSession(db, createSessionId(state!.sessionId));
    expect(session).not.toBeNull();
    expect(session!.status).toBe("active");

    // run.started event must have landed
    const eventsAfterStart = listEvents(db, { limit: 20 });
    const startedEvent = eventsAfterStart.find(
      (e) => e.type === "run.started" && e.sourceId === state!.runId,
    );
    expect(startedEvent).toBeDefined();

    // ── Step 3: handlePreToolUse with a risky command → block ─────────────────
    const blockResult = await runHook(() =>
      _handlePreToolUse(
        {
          session_id: sid,
          cwd,
          tool_name: "Bash",
          tool_input: { command: "rm -rf /tmp/whatever" },
        } satisfies HookInput,
        testDbPath,
      ),
    );

    expect(blockResult.exitCode).toBe(2);
    const blockDecision = JSON.parse(blockResult.stdout) as {
      decision: string;
      reason: string;
    };
    expect(blockDecision.decision).toBe("block");
    expect(blockDecision.reason).toContain("No rm -rf");

    // policy.violated event must exist
    const eventsAfterBlock = listEvents(getDb(testDbPath), { limit: 30 });
    const violatedEvent = eventsAfterBlock.find(
      (e) => e.type === "policy.violated" && e.sourceId === state!.runId,
    );
    expect(violatedEvent).toBeDefined();

    // policy_results row for the pre-tool block
    const resultsAfterBlock = getPolicyResults(
      getDb(testDbPath),
      createRunId(state!.runId),
    );
    const preToolRow = resultsAfterBlock.find(
      (r) => r.policyId === "p_integ_risky",
    );
    expect(preToolRow).toBeDefined();
    expect(preToolRow!.passed).toBe(false);
    expect(
      (preToolRow!.details as { source?: string; toolName?: string }).source,
    ).toBe("pre-tool");
    expect(
      (preToolRow!.details as { source?: string; toolName?: string }).toolName,
    ).toBe("Bash");

    // ── Step 4: handlePreToolUse with a benign command → allow ────────────────
    const allowResult = await runHook(() =>
      _handlePreToolUse(
        {
          session_id: sid,
          cwd,
          tool_name: "Bash",
          tool_input: { command: "ls /tmp" },
        } satisfies HookInput,
        testDbPath,
      ),
    );

    expect(allowResult.exitCode).toBe(0);
    expect(allowResult.stdout).toBe("");

    // ── Step 5: handleSessionEnd → finalize ───────────────────────────────────
    await runHook(() =>
      _handleSessionEnd({ session_id: sid, cwd } satisfies HookInput, testDbPath),
    );

    const dbFinal = getDb(testDbPath);

    // run must be completed (not failed)
    const finalRun = getRun(dbFinal, createRunId(state!.runId));
    expect(finalRun).not.toBeNull();
    expect(finalRun!.status).toBe("completed");

    // session must be terminated
    const finalSession = getSession(dbFinal, createSessionId(state!.sessionId));
    expect(finalSession).not.toBeNull();
    expect(finalSession!.status).toBe("terminated");

    // completedRunIds must include our run
    expect(finalSession!.completedRunIds).toContain(state!.runId);

    // run.completed event must exist
    const finalEvents = listEvents(dbFinal, { limit: 50 });
    const completedEvent = finalEvents.find(
      (e) => e.type === "run.completed" && e.sourceId === state!.runId,
    );
    expect(completedEvent).toBeDefined();

    // B4 rollup: a policy_results row with source==="run-complete" for the
    // active policy must have been written by handleSessionEnd
    const finalResults = getPolicyResults(
      dbFinal,
      createRunId(state!.runId),
    );
    const rollupRow = finalResults.find(
      (r) =>
        r.policyId === "p_integ_risky" &&
        (r.details as { source?: string }).source === "run-complete",
    );
    expect(rollupRow).toBeDefined();

    // state file must be gone
    const { existsSync } = await import("node:fs");
    expect(existsSync(stateFilePath(sid))).toBe(false);
  });

  it("start: run and session rows land in DB", async () => {
    const sid = freshSessionId();
    await _handleSessionStart({ session_id: sid, cwd: "/tmp/integ-cwd" }, testDbPath);

    const state = _readState(sid)!;
    const db = getDb(testDbPath);

    const runs = listRuns(db);
    expect(runs.some((r) => (r.id as string) === state.runId)).toBe(true);

    const sessions = listSessions(db);
    expect(sessions.some((s) => (s.id as string) === state.sessionId)).toBe(true);
  });

  it("pre-tool block: policy_results row has correct source and toolName", async () => {
    const sid = freshSessionId();
    await _handleSessionStart({ session_id: sid, cwd: "/tmp/integ-cwd" }, testDbPath);

    insertPolicy(getDb(testDbPath), {
      id: createPolicyId("p_integ_rm2"),
      name: "No dangerous rm",
      type: PolicyType.RiskyOpFlag,
      config: { type: PolicyType.RiskyOpFlag, riskyPatterns: ["rm -rf"] },
      severity: PolicySeverity.Error,
      enabled: true,
      createdAt: new Date().toISOString(),
    });

    await runHook(() =>
      _handlePreToolUse(
        {
          session_id: sid,
          cwd: "/tmp/integ-cwd",
          tool_name: "Bash",
          tool_input: { command: "rm -rf /var" },
        } satisfies HookInput,
        testDbPath,
      ),
    );

    const state = _readState(sid)!;
    const results = getPolicyResults(getDb(testDbPath), createRunId(state.runId));
    const row = results.find((r) => r.policyId === "p_integ_rm2");
    expect(row).toBeDefined();
    expect(row!.passed).toBe(false);
    expect(
      (row!.details as { source?: string; toolName?: string }).source,
    ).toBe("pre-tool");
    expect(
      (row!.details as { source?: string; toolName?: string }).toolName,
    ).toBe("Bash");
  });

  it("session end: rollup policy_results row per active policy", async () => {
    const sid = freshSessionId();
    await _handleSessionStart({ session_id: sid, cwd: "/tmp/integ-cwd" }, testDbPath);

    insertPolicy(getDb(testDbPath), {
      id: createPolicyId("p_integ_rollup"),
      name: "Rollup policy",
      type: PolicyType.RiskyOpFlag,
      config: { type: PolicyType.RiskyOpFlag, riskyPatterns: ["rm -rf"] },
      severity: PolicySeverity.Error,
      enabled: true,
      createdAt: new Date().toISOString(),
    });

    const state = _readState(sid)!;

    await runHook(() =>
      _handleSessionEnd(
        { session_id: sid, cwd: "/tmp/integ-cwd" } satisfies HookInput,
        testDbPath,
      ),
    );

    const results = getPolicyResults(getDb(testDbPath), createRunId(state.runId));
    const rollup = results.find(
      (r) =>
        r.policyId === "p_integ_rollup" &&
        (r.details as { source?: string }).source === "run-complete",
    );
    expect(rollup).toBeDefined();
  });
});
