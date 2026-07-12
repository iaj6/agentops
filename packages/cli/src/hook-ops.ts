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
  evaluateBudgetPolicies,
  evaluateBudgetWarnings,
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
  insertPolicyResult,
  listPolicies,
  updateRunSummary,
} from "@agentops/db";
import { credentialsPath } from "./credentials.js";
import { resolveLocalUserId } from "./attribution.js";
import { Outbox, outboxPath, type OutboxEntry } from "./outbox.js";

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

export interface CheckBudgetArgs {
  readonly runId: string;
  readonly cumulativeCostUsd: number;
}

export interface HookOps {
  /** Create a session + run pair for a new Claude Code session. */
  startSessionAndRun(args: StartArgs): Promise<{ runId: string; sessionId: string }>;
  /** Evaluate guard policies against a pending tool invocation. */
  checkPolicy(args: CheckPolicyArgs): Promise<PolicyDecision>;
  /**
   * Evaluate turn-boundary policies (CostCeiling) given the session's
   * cumulative cost AND persist the outcome on violation (event +
   * policy_result row). Used by UserPromptSubmit, where the block is
   * an actionable event the dashboard / webhooks need to see.
   */
  checkBudget(args: CheckBudgetArgs): Promise<PolicyDecision>;
  /**
   * Same evaluation as checkBudget but read-only — no event emission,
   * no policy_result writes. Used by Stop, which fires after every
   * Claude response and would otherwise spam duplicate rows. Stop
   * only consumes the warnings/decision to emit stderr messages.
   */
  evaluateBudget(args: CheckBudgetArgs): Promise<PolicyDecision>;
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

/**
 * claudeSessionId is required when the caller wants SdkOps to use a local
 * outbox for transient retry. Without it, SdkOps still works but transient
 * failures result in dropped events (logged to stderr) instead of being
 * queued for retry on the next hook fire.
 */
export function createOps(config: OpsConfig, claudeSessionId?: string): HookOps {
  if (isSdkMode(config)) {
    return new SdkOps(config.serverUrl!, config.token!, claudeSessionId);
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

    // Attribute at write time so local rows aren't stranded with a NULL
    // user_id (the SDK path already attributes via bearer auth). Resolves to
    // null when attribution can't be determined, preserving prior behavior.
    const userId = resolveLocalUserId(db);
    run = { ...run, userId };
    session = { ...session, userId };

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
      // Resolve violation names → policy IDs once; used for both the
      // event payload (so the EventCard / webhooks can cross-link) and
      // the policy_result row inserts further down.
      const policyIdByName = new Map<string, string>();
      for (const p of activePolicies) policyIdByName.set(p.name, p.id as string);
      const policyIds = errors
        .map((v) => policyIdByName.get(v.policy))
        .filter((id): id is string => !!id);

      insertEvent(
        db,
        createEvent(EventCategory.Policy, EVENT_TYPES["policy.violated"], args.runId, {
          toolName: args.toolName,
          toolInput: Object.keys(args.toolInput),
          violations: errors,
          policyIds,
        }),
      );

      // Persist a policy_result row per violation (B4 live block trail).
      const now = new Date().toISOString();
      for (const v of errors) {
        const policyId = policyIdByName.get(v.policy);
        if (!policyId) continue;
        insertPolicyResult(db, {
          id: `pr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          runId: args.runId as string,
          policyId,
          passed: false,
          message: v.message,
          details: {
            source: "pre-tool",
            toolName: args.toolName,
            severity: v.severity,
          },
          evaluatedAt: now,
        });
      }

      return {
        decision: "block",
        reason: errors.map((v) => `[${v.policy}] ${v.message}`).join("; "),
        violations: errors,
        warnings,
      };
    }
    return { decision: "allow", violations: [], warnings };
  }

  async checkBudget(args: CheckBudgetArgs): Promise<PolicyDecision> {
    const db = this.db();
    const activePolicies = listPolicies(db, { enabled: true });

    const violations = evaluateBudgetPolicies(
      { cumulativeCostUsd: args.cumulativeCostUsd },
      activePolicies,
    );
    const approaching = evaluateBudgetWarnings(
      { cumulativeCostUsd: args.cumulativeCostUsd },
      activePolicies,
    );

    const errors = violations.filter((v) => v.severity === PolicySeverity.Error);
    // Merge severity-based non-error violations with approaching-ceiling
    // warnings. Stop / UserPromptSubmit handlers stream all of these to
    // stderr via the existing warning emission loop.
    const warnings = [
      ...violations.filter((v) => v.severity !== PolicySeverity.Error),
      ...approaching,
    ];

    if (errors.length > 0) {
      // Resolve violation names → policy IDs once; reused by the event
      // payload (so EventCard + webhooks can cross-link) and the
      // policy_result rows below.
      const policyIdByName = new Map<string, string>();
      for (const p of activePolicies) policyIdByName.set(p.name, p.id as string);
      const policyIds = errors
        .map((v) => policyIdByName.get(v.policy))
        .filter((id): id is string => !!id);

      insertEvent(
        db,
        createEvent(EventCategory.Policy, EVENT_TYPES["policy.violated"], args.runId, {
          source: "turn-boundary",
          violations: errors,
          policyIds,
        }),
      );

      // Source tag "turn-boundary" so the Policy detail page can
      // distinguish chat-turn blocks from PreToolUse blocks.
      const now = new Date().toISOString();
      for (const v of errors) {
        const policyId = policyIdByName.get(v.policy);
        if (!policyId) continue;
        insertPolicyResult(db, {
          id: `pr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          runId: args.runId as string,
          policyId,
          passed: false,
          message: v.message,
          details: {
            source: "turn-boundary",
            severity: v.severity,
          },
          evaluatedAt: now,
        });
      }

      return {
        decision: "block",
        reason: errors.map((v) => `[${v.policy}] ${v.message}`).join("; "),
        violations: errors,
        warnings,
      };
    }
    return { decision: "allow", violations: [], warnings };
  }

  async evaluateBudget(args: CheckBudgetArgs): Promise<PolicyDecision> {
    const db = this.db();
    const activePolicies = listPolicies(db, { enabled: true });

    const violations = evaluateBudgetPolicies(
      { cumulativeCostUsd: args.cumulativeCostUsd },
      activePolicies,
    );
    const approaching = evaluateBudgetWarnings(
      { cumulativeCostUsd: args.cumulativeCostUsd },
      activePolicies,
    );

    const errors = violations.filter((v) => v.severity === PolicySeverity.Error);
    const warnings = [
      ...violations.filter((v) => v.severity !== PolicySeverity.Error),
      ...approaching,
    ];

    if (errors.length > 0) {
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

    // Persist one policy_result row per active policy as the run-end
    // rollup (B4). Pre-tool blocks write additional rows during the
    // run via checkPolicy above. Together they give the Policy detail
    // page a complete evaluation history.
    const evaluatedAt = new Date().toISOString();
    for (const r of policyResults) {
      insertPolicyResult(db, {
        id: `pr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        runId: run.id as string,
        policyId: r.policy.id as string,
        passed: r.passed,
        message: r.message,
        details: { ...r.details, source: "run-complete" },
        evaluatedAt,
      });
    }

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
//
// Transient failures (5xx, network errors) on reportAction/reportArtifact/
// reportMetrics are queued in a per-session local outbox and retried on
// every subsequent SDK call. Permanent failures (4xx — auth or bad input)
// are NOT queued; they propagate as SdkError so the caller can fail-open.
//
// startSessionAndRun is never outboxed: without successful IDs there's
// nothing to anchor future calls against. terminateSession and completeRun
// (the "session-final" calls) also skip the outbox — if they fail, the run
// stays in "running" status until an admin intervenes, which is surfaced
// to the operator via a loud stderr warning.

// Every SDK HTTP call is bounded by this timeout. Without one, a dashboard
// that HANGS (rather than refuses the connection) stalls checkPolicy on
// every PreToolUse until Claude Code's own hook timeout (60s default),
// freezing the user's session once per tool call — the fail-open path only
// helps when the request errors. Default 5s; override with the
// AGENTOPS_SDK_TIMEOUT_MS env var (positive integer, milliseconds).
//
// A timeout rejects the fetch, which post() catches like any other network
// error (status 0) — so it flows through the existing transient semantics:
// SdkError(status 0) → outboxed for reportAction/reportArtifact/
// reportMetrics, fail-open (or AGENTOPS_FAIL_CLOSED block) for
// checkPolicy/checkBudget.
const DEFAULT_SDK_TIMEOUT_MS = 5000;

export function sdkTimeoutMs(): number {
  const raw = process.env["AGENTOPS_SDK_TIMEOUT_MS"]?.trim();
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return DEFAULT_SDK_TIMEOUT_MS;
}

class SdkOps implements HookOps {
  private readonly base: string;
  private readonly token: string;
  /** Per-session outbox. Null when claudeSessionId was not provided. */
  private readonly outbox: Outbox | null;

  constructor(serverUrl: string, token: string, claudeSessionId?: string) {
    this.base = serverUrl;
    this.token = token;
    this.outbox = claudeSessionId
      ? new Outbox(outboxPath(claudeSessionId))
      : null;
  }

  // Public method so the hook can drain any leftover before exiting.
  async drainOutbox(): Promise<{ sent: number; remaining: number; dropped: number }> {
    if (!this.outbox) return { sent: 0, remaining: 0, dropped: 0 };
    return this.outbox.drain((entry) => this.dispatchOutboxEntry(entry));
  }

  outboxSize(): number {
    return this.outbox?.size() ?? 0;
  }

  private isPermanentFailure(err: unknown): boolean {
    // 4xx are permanent — auth, validation, ownership; retrying won't help.
    // 5xx + network failures (status=0 / no SdkError) are transient.
    if (err instanceof SdkError) {
      return err.status >= 400 && err.status < 500;
    }
    return false;
  }

  private async post<T>(
    path: string,
    body: unknown,
  ): Promise<{ status: number; data: T }> {
    try {
      const res = await fetch(this.base + path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify(body),
        // Bound every call so a hanging dashboard can't stall the hook
        // (and with it, the user's Claude Code session). See sdkTimeoutMs.
        signal: AbortSignal.timeout(sdkTimeoutMs()),
      });
      const data = (await res.json().catch(() => ({}))) as T;
      return { status: res.status, data };
    } catch (err) {
      // Network failure (including timeout aborts) surfaces as status 0
      // so callers treat it as transient.
      const message = err instanceof Error ? err.message : String(err);
      return { status: 0, data: { error: message } as unknown as T };
    }
  }

  // ── Direct HTTP calls (used by both public methods and outbox replay) ───

  private async doReportAction(runId: string, action: Action): Promise<void> {
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

  private async doReportArtifactDiff(runId: string, diff: string): Promise<void> {
    const r = await this.post<{ ok?: boolean; error?: string }>(
      `/api/sdk/runs/${encodeURIComponent(runId)}/artifacts`,
      { diffs: [diff], logs: [], testOutputs: [], reports: [] },
    );
    if (r.status !== 200) {
      throw new SdkError("reportArtifact", r.status, r.data.error);
    }
  }

  private async doReportMetrics(runId: string, metrics: Metrics): Promise<void> {
    const m = await this.post<{ ok?: boolean; error?: string }>(
      `/api/sdk/runs/${encodeURIComponent(runId)}/metrics`,
      {
        costUsd: metrics.costUsd,
        wallTimeMs: metrics.wallTimeMs,
        flakeRate: metrics.flakeRate,
        tokenUsage: metrics.tokenUsage,
        // Forward backend + per-model cost so SDK-mode runs are tagged too;
        // otherwise only local-mode runs get segmented and SDK runs all read
        // as unclassified.
        ...(metrics.backend ? { backend: metrics.backend } : {}),
        ...(metrics.byModel ? { byModel: metrics.byModel } : {}),
      },
    );
    if (m.status !== 200) {
      throw new SdkError("reportMetrics", m.status, m.data.error);
    }
  }

  private async doCompleteRun(runId: string): Promise<void> {
    const c = await this.post<{ error?: string }>(
      `/api/sdk/runs/${encodeURIComponent(runId)}/complete`,
      {},
    );
    if (c.status !== 200) {
      throw new SdkError("completeRun", c.status, c.data.error);
    }
  }

  private async doTerminateSession(sessionId: string): Promise<void> {
    const res = await this.post<{ error?: string }>(
      `/api/sdk/sessions/${encodeURIComponent(sessionId)}/terminate`,
      {},
    );
    if (res.status !== 200) {
      throw new SdkError("terminateSession", res.status, res.data.error);
    }
  }

  // ── Outbox dispatch (replay of queued entries) ────────────────────────

  private async dispatchOutboxEntry(entry: OutboxEntry) {
    try {
      switch (entry.op) {
        case "reportAction":
          await this.doReportAction(
            entry.args[0] as string,
            entry.args[1] as Action,
          );
          return { ok: true };
        case "reportArtifact":
          await this.doReportArtifactDiff(
            entry.args[0] as string,
            entry.args[1] as string,
          );
          return { ok: true };
        case "reportMetrics":
          await this.doReportMetrics(
            entry.args[0] as string,
            entry.args[1] as Metrics,
          );
          return { ok: true };
        default:
          // Unknown op type — drop it (likely added by a newer CLI).
          return { ok: false, permanent: true };
      }
    } catch (err) {
      const permanent = this.isPermanentFailure(err);
      return {
        ok: false,
        permanent,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // ── Retriable wrapper for the three "queueable" call types ───────────

  private async withOutbox<T>(
    op: string,
    args: ReadonlyArray<unknown>,
    doIt: () => Promise<T>,
  ): Promise<T | void> {
    // Best-effort drain of any prior backlog before issuing the new call.
    await this.drainOutbox();
    try {
      return await doIt();
    } catch (err) {
      if (this.isPermanentFailure(err) || !this.outbox) {
        throw err;
      }
      const detail = err instanceof Error ? err.message : String(err);
      this.outbox.enqueue(op, args, detail);
      process.stderr.write(
        `[agentops] ${op} queued for retry (outbox: ${this.outbox.size()}). Reason: ${detail}\n`,
      );
      return;
    }
  }

  // ── Public API ────────────────────────────────────────────────────────

  async startSessionAndRun(args: StartArgs): Promise<{ runId: string; sessionId: string }> {
    // Never outboxed — without the returned IDs there's nothing to anchor
    // subsequent calls against. If this fails the hook fails-open and the
    // session is invisible to the dashboard.
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
    // Synchronous decision — never outbox. Drain pending writes first so
    // the server sees the latest state when it evaluates.
    await this.drainOutbox();
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

  async checkBudget(args: CheckBudgetArgs): Promise<PolicyDecision> {
    // Synchronous decision, never outbox. Same drain-first pattern as
    // checkPolicy so the server sees the latest state.
    await this.drainOutbox();
    const res = await this.post<{
      decision?: "allow" | "block";
      reason?: string;
      violations?: PolicyViolation[];
      warnings?: PolicyViolation[];
      error?: string;
    }>("/api/sdk/policy/check-budget", {
      runId: args.runId,
      cumulativeCostUsd: args.cumulativeCostUsd,
    });
    if (res.status !== 200 || !res.data.decision) {
      throw new SdkError("checkBudget", res.status, res.data.error);
    }
    return {
      decision: res.data.decision,
      ...(res.data.reason ? { reason: res.data.reason } : {}),
      violations: res.data.violations ?? [],
      warnings: res.data.warnings ?? [],
    };
  }

  async evaluateBudget(args: CheckBudgetArgs): Promise<PolicyDecision> {
    // Read-only evaluation. The server route below skips all side
    // effects (no event, no policy_result, no budget-threshold check)
    // so Stop can call this on every Claude response without spamming.
    await this.drainOutbox();
    const res = await this.post<{
      decision?: "allow" | "block";
      reason?: string;
      violations?: PolicyViolation[];
      warnings?: PolicyViolation[];
      error?: string;
    }>("/api/sdk/policy/evaluate-budget", {
      runId: args.runId,
      cumulativeCostUsd: args.cumulativeCostUsd,
    });
    if (res.status !== 200 || !res.data.decision) {
      throw new SdkError("evaluateBudget", res.status, res.data.error);
    }
    return {
      decision: res.data.decision,
      ...(res.data.reason ? { reason: res.data.reason } : {}),
      violations: res.data.violations ?? [],
      warnings: res.data.warnings ?? [],
    };
  }

  async reportAction(runId: string, action: Action): Promise<void> {
    await this.withOutbox("reportAction", [runId, action], () =>
      this.doReportAction(runId, action));
  }

  async finalizeRun(args: FinalizeArgs): Promise<void> {
    // Drain everything pending before we report the final state.
    await this.drainOutbox();

    if (args.diff) {
      await this.withOutbox(
        "reportArtifact",
        [args.runId, args.diff],
        () => this.doReportArtifactDiff(args.runId, args.diff!),
      );
    }
    await this.withOutbox(
      "reportMetrics",
      [args.runId, args.metrics],
      () => this.doReportMetrics(args.runId, args.metrics),
    );
    // Complete is NOT outboxed — failure here means the run stays "running"
    // in the dashboard. The hook surfaces the failure to the operator via
    // logSdkFailure in hook.ts.
    await this.doCompleteRun(args.runId);

    if (this.outbox && this.outbox.size() > 0) {
      process.stderr.write(
        `[agentops] WARNING: session is finalizing but ${this.outbox.size()} event(s) remain in the outbox at ${this.outbox.path}. ` +
          `These will be retried the next time agentops runs against this session id — typically not at all. ` +
          `If the dashboard recovers, you can drop the outbox manually.\n`,
      );
    }
  }

  async terminateSession(sessionId: string): Promise<void> {
    // Last call of the session lifecycle — no outboxing. If this fails the
    // session row stays "active". Surfaced via logSdkFailure in hook.ts.
    await this.doTerminateSession(sessionId);
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
