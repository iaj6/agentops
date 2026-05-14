// HookOps abstracts the persistence layer used by hook handlers so the
// same handler code can run against:
//   - a local SQLite database (legacy / local-dev / single-user mode)
//   - a remote AgentOps dashboard via the SDK HTTP routes (multi-user)
//
// The two implementations share the same surface. Handlers in hook.ts
// call methods on a HookOps and never touch the DB or fetch directly.
//
// SDK mode is selected when both AGENTOPS_SERVER_URL is set (env or
// credentials.json) AND a bearer token is available. Otherwise the hook
// falls back to direct mode and uses --db-path or the default SQLite.

import { existsSync, readFileSync } from "node:fs";
import {
  createRun,
  startRun,
  addAction,
  addArtifact,
  completeRun,
  createActionId,
  createArtifactId,
  createSession,
  activateSession,
  assignRun,
  completeSessionRun,
  terminateSession,
  createEvent,
  EVENT_TYPES,
  EventCategory,
  computeScore,
  PolicyEngine,
  PolicySeverity,
  generateSummary,
  evaluatePreToolPolicies,
  type Action,
  type Metrics,
  type PolicyViolation,
  type Backend,
} from "@agentops/core";
import {
  getDb,
  insertRun,
  updateRun,
  getRun,
  insertSession,
  updateSession,
  getSession,
  insertEvent,
  listPolicies,
  updateRunSummary,
} from "@agentops/db";
import { credentialsPath } from "./credentials.js";

// ─── Public types ──────────────────────────────────────────────────────────

export interface PolicyDecision {
  readonly decision: "allow" | "block";
  readonly reason?: string;
  readonly violations: ReadonlyArray<PolicyViolation>;
  readonly warnings: ReadonlyArray<PolicyViolation>;
}

export interface StartArgs {
  readonly claudeSessionId: string;
  readonly cwd: string;
  readonly repo: string;
  readonly branch: string;
}

export interface FinalizeArgs {
  readonly runId: string;
  readonly sessionId: string;
  readonly metrics: Metrics;
  readonly diff?: string;
  readonly changedFilesCount: number;
}

export interface CheckPolicyArgs {
  readonly runId: string;
  readonly toolName: string;
  readonly toolInput: Record<string, unknown>;
  readonly cumulativeCostUsd: number;
}

export interface HookOps {
  /** Create a session + run pair for a new Claude Code session. */
  startSessionAndRun(args: StartArgs): Promise<{ runId: string; sessionId: string }>;
  /** Evaluate guard policies against a pending tool invocation. */
  checkPolicy(args: CheckPolicyArgs): Promise<PolicyDecision>;
  /** Record an Action against the run. */
  reportAction(runId: string, action: Action): Promise<void>;
  /** Finalize the run (artifacts + metrics + complete + summary + emit). */
  finalizeRun(args: FinalizeArgs): Promise<void>;
  /** Terminate the session (last step of session lifecycle). */
  terminateSession(sessionId: string): Promise<void>;
}

// ─── Mode selection ────────────────────────────────────────────────────────

export interface OpsConfig {
  readonly dbPath?: string;
  readonly serverUrl?: string;
  readonly token?: string;
}

export function isSdkMode(config: OpsConfig): boolean {
  return !!(config.serverUrl && config.token);
}

interface StoredCreds {
  readonly server?: string;
  readonly token?: string;
}

function readStoredCreds(): StoredCreds {
  try {
    const p = credentialsPath();
    if (!existsSync(p)) return {};
    return JSON.parse(readFileSync(p, "utf-8")) as StoredCreds;
  } catch {
    return {};
  }
}

/**
 * Determine the appropriate HookOps for this invocation. Precedence:
 *   AGENTOPS_SERVER_URL env > credentials.json server
 *   AGENTOPS_API_KEY env    > credentials.json token
 * If both URL and token resolve, use SdkOps. Otherwise DirectOps.
 */
export function resolveOpsConfig(dbPath?: string): OpsConfig {
  const stored = readStoredCreds();
  const serverUrl =
    process.env["AGENTOPS_SERVER_URL"]?.trim() || stored.server || undefined;
  const token =
    process.env["AGENTOPS_API_KEY"]?.trim() || stored.token || undefined;
  return {
    ...(dbPath ? { dbPath } : {}),
    ...(serverUrl ? { serverUrl: serverUrl.replace(/\/$/, "") } : {}),
    ...(token ? { token } : {}),
  };
}

export function createOps(config: OpsConfig): HookOps {
  if (isSdkMode(config)) {
    return new SdkOps(config.serverUrl!, config.token!);
  }
  return new DirectOps(config.dbPath);
}

// ─── DirectOps: writes straight to local SQLite ────────────────────────────

class DirectOps implements HookOps {
  private readonly dbPath: string | undefined;

  constructor(dbPath?: string) {
    this.dbPath = dbPath;
  }

  private db() {
    return getDb(this.dbPath);
  }

  async startSessionAndRun(args: StartArgs): Promise<{ runId: string; sessionId: string }> {
    const db = this.db();

    let session = createSession(`claude-code-${args.claudeSessionId}`, {
      claudeSessionId: args.claudeSessionId,
      cwd: args.cwd,
    });
    session = activateSession(session);

    let run = createRun(
      {
        humanReadable: `Claude Code session in ${args.cwd}`,
        structured: {
          type: "claude-code-hook",
          description: `Claude Code session in ${args.cwd}`,
          parameters: { cwd: args.cwd, claudeSessionId: args.claudeSessionId },
        },
      },
      {
        repo: args.repo,
        branch: args.branch,
        permissions: [],
        sandbox: { enabled: false, isolationLevel: "none" },
      },
    );
    run = startRun(run);

    session = assignRun(session, run.id);

    insertSession(db, session);
    insertRun(db, run);

    insertEvent(
      db,
      createEvent(EventCategory.Run, EVENT_TYPES["run.started"], run.id as string, {
        goal: run.goal.humanReadable,
        repo: args.repo,
        branch: args.branch,
        claudeSessionId: args.claudeSessionId,
      }),
    );

    return { runId: run.id as string, sessionId: session.id as string };
  }

  async checkPolicy(args: CheckPolicyArgs): Promise<PolicyDecision> {
    const db = this.db();
    const activePolicies = listPolicies(db, { enabled: true });
    const run = getRun(db, args.runId as never);

    const editedFiles = run
      ? new Set(run.actions.flatMap((a) => a.fileEdits.map((e) => e.path)))
      : new Set<string>();
    const branch = run?.environment.branch;

    const violations = evaluatePreToolPolicies(
      { toolName: args.toolName, toolInput: args.toolInput },
      activePolicies,
      {
        editedFiles,
        ...(branch ? { branch } : {}),
        cumulativeCostUsd: args.cumulativeCostUsd,
      },
    );

    const errors = violations.filter((v) => v.severity === PolicySeverity.Error);
    const warnings = violations.filter((v) => v.severity !== PolicySeverity.Error);

    if (errors.length > 0) {
      insertEvent(
        db,
        createEvent(EventCategory.Policy, EVENT_TYPES["policy.violated"], args.runId, {
          toolName: args.toolName,
          toolInput: Object.keys(args.toolInput),
          violations: errors,
        }),
      );
      return {
        decision: "block",
        reason: errors.map((v) => `[${v.policy}] ${v.message}`).join("; "),
        violations: errors,
        warnings,
      };
    }
    return { decision: "allow", violations: [], warnings };
  }

  async reportAction(runId: string, action: Action): Promise<void> {
    const db = this.db();
    const run = getRun(db, runId as never);
    if (!run) return;
    const updated = addAction(run, action);
    updateRun(db, updated.id, {
      actions: updated.actions,
      updatedAt: updated.updatedAt,
    });
    insertEvent(
      db,
      createEvent(EventCategory.Action, EVENT_TYPES["action.taken"], runId, {
        toolName: action.toolCalls[0]?.name ?? "unknown",
        toolInput: action.toolCalls[0] ? Object.keys(action.toolCalls[0].input) : [],
      }),
    );
  }

  async finalizeRun(args: FinalizeArgs): Promise<void> {
    const db = this.db();
    let run = getRun(db, args.runId as never);
    if (!run) return;
    if (run.status === "completed" || run.status === "failed") return;

    if (args.diff) {
      run = addArtifact(run, {
        id: createArtifactId(`artifact_${Date.now()}`),
        diffs: [args.diff],
        logs: [],
        testOutputs: [],
        reports: [],
      });
    }

    run = { ...run, metrics: args.metrics };

    const activePolicies = listPolicies(db, { enabled: true });
    const engine = new PolicyEngine();
    const policyResults = engine.evaluate(run, activePolicies);
    const policyChecks = policyResults.map((r) => ({
      policyId: r.policy.id,
      passed: r.passed,
      message: r.message,
    }));

    run = completeRun(run, {
      testResults: [],
      policyChecks,
      confidenceScore: 0,
    });

    updateRun(db, run.id, {
      status: run.status,
      actions: run.actions,
      artifacts: run.artifacts,
      metrics: run.metrics,
      evaluations: run.evaluations,
      decisions: run.decisions,
      updatedAt: run.updatedAt,
    });

    const score = computeScore(run, activePolicies);
    const summary = generateSummary(run, run.metrics, policyResults, score);
    updateRunSummary(db, run.id, summary);

    insertEvent(
      db,
      createEvent(EventCategory.Run, EVENT_TYPES["run.completed"], args.runId, {
        wallTimeMs: args.metrics.wallTimeMs,
        filesChanged: args.changedFilesCount,
        actionsCount: run.actions.length,
      }),
    );
  }

  async terminateSession(sessionId: string): Promise<void> {
    const db = this.db();
    let session = getSession(db, sessionId as never);
    if (!session) return;
    session = completeSessionRun(session);
    session = terminateSession(session);
    updateSession(db, session.id, {
      status: session.status,
      currentRunId: session.currentRunId,
      completedRunIds: session.completedRunIds,
      terminatedAt: session.terminatedAt,
      updatedAt: session.updatedAt,
    });
    insertEvent(
      db,
      createEvent(EventCategory.Session, EVENT_TYPES["session.terminated"], sessionId, {
        completedRuns: session.completedRunIds.length,
      }),
    );
  }
}

// ─── SdkOps: writes via HTTP to a remote dashboard ─────────────────────────

class SdkOps implements HookOps {
  private readonly base: string;
  private readonly token: string;

  constructor(serverUrl: string, token: string) {
    this.base = serverUrl;
    this.token = token;
  }

  private async post<T>(
    path: string,
    body: unknown,
  ): Promise<{ status: number; data: T }> {
    const res = await fetch(this.base + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as T;
    return { status: res.status, data };
  }

  async startSessionAndRun(args: StartArgs): Promise<{ runId: string; sessionId: string }> {
    // Two HTTP calls: create session, then create run linked to it.
    const sessionRes = await this.post<{ sessionId?: string; error?: string }>(
      "/api/sdk/sessions",
      {
        agentId: `claude-code-${args.claudeSessionId}`,
        metadata: { claudeSessionId: args.claudeSessionId, cwd: args.cwd },
      },
    );
    if (sessionRes.status !== 201 || !sessionRes.data.sessionId) {
      throw new SdkError("createSession", sessionRes.status, sessionRes.data.error);
    }
    const sessionId = sessionRes.data.sessionId;

    const runRes = await this.post<{ runId?: string; error?: string }>(
      "/api/sdk/runs",
      {
        sessionId,
        goal: {
          humanReadable: `Claude Code session in ${args.cwd}`,
          structured: {
            type: "claude-code-hook",
            description: `Claude Code session in ${args.cwd}`,
            parameters: { cwd: args.cwd, claudeSessionId: args.claudeSessionId },
          },
        },
        environment: {
          repo: args.repo,
          branch: args.branch,
          permissions: [],
          sandbox: { enabled: false, isolationLevel: "none" },
        },
      },
    );
    if (runRes.status !== 201 || !runRes.data.runId) {
      throw new SdkError("createRun", runRes.status, runRes.data.error);
    }
    return { runId: runRes.data.runId, sessionId };
  }

  async checkPolicy(args: CheckPolicyArgs): Promise<PolicyDecision> {
    const res = await this.post<{
      decision?: "allow" | "block";
      reason?: string;
      violations?: PolicyViolation[];
      warnings?: PolicyViolation[];
      error?: string;
    }>("/api/sdk/policy/check", {
      runId: args.runId,
      toolName: args.toolName,
      toolInput: args.toolInput,
      cumulativeCostUsd: args.cumulativeCostUsd,
    });
    if (res.status !== 200 || !res.data.decision) {
      throw new SdkError("checkPolicy", res.status, res.data.error);
    }
    return {
      decision: res.data.decision,
      ...(res.data.reason ? { reason: res.data.reason } : {}),
      violations: res.data.violations ?? [],
      warnings: res.data.warnings ?? [],
    };
  }

  async reportAction(runId: string, action: Action): Promise<void> {
    const res = await this.post<{ ok?: boolean; error?: string }>(
      `/api/sdk/runs/${encodeURIComponent(runId)}/actions`,
      {
        id: action.id,
        toolCalls: action.toolCalls,
        fileEdits: action.fileEdits,
        commands: action.commands,
        timestamp: action.timestamp,
      },
    );
    if (res.status !== 200) {
      throw new SdkError("reportAction", res.status, res.data.error);
    }
  }

  async finalizeRun(args: FinalizeArgs): Promise<void> {
    // Three calls: artifacts (if diff), metrics, complete.
    if (args.diff) {
      const r = await this.post<{ ok?: boolean; error?: string }>(
        `/api/sdk/runs/${encodeURIComponent(args.runId)}/artifacts`,
        { diffs: [args.diff], logs: [], testOutputs: [], reports: [] },
      );
      if (r.status !== 200) {
        throw new SdkError("reportArtifact", r.status, r.data.error);
      }
    }

    const m = await this.post<{ ok?: boolean; error?: string }>(
      `/api/sdk/runs/${encodeURIComponent(args.runId)}/metrics`,
      {
        costUsd: args.metrics.costUsd,
        wallTimeMs: args.metrics.wallTimeMs,
        flakeRate: args.metrics.flakeRate,
        tokenUsage: args.metrics.tokenUsage,
      },
    );
    if (m.status !== 200) {
      throw new SdkError("reportMetrics", m.status, m.data.error);
    }

    const c = await this.post<{ error?: string }>(
      `/api/sdk/runs/${encodeURIComponent(args.runId)}/complete`,
      {},
    );
    if (c.status !== 200) {
      throw new SdkError("completeRun", c.status, c.data.error);
    }
  }

  async terminateSession(sessionId: string): Promise<void> {
    const res = await this.post<{ error?: string }>(
      `/api/sdk/sessions/${encodeURIComponent(sessionId)}/terminate`,
      {},
    );
    if (res.status !== 200) {
      throw new SdkError("terminateSession", res.status, res.data.error);
    }
  }
}

export class SdkError extends Error {
  constructor(
    public readonly op: string,
    public readonly status: number,
    detail?: string,
  ) {
    super(`SDK ${op} failed with HTTP ${status}${detail ? `: ${detail}` : ""}`);
    this.name = "SdkError";
  }
}

// Suppress unused import warning — Backend stays available for future use.
export type { Backend };
