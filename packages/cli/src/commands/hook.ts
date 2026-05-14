import { Command } from "commander";
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createRun,
  startRun,
  completeRun,
  addAction,
  addArtifact,
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
  PolicyType,
  PolicySeverity,
  generateSummary,
} from "@agentops/core";
import type { Action, ToolCall, FileEdit, Command as CmdType, Policy, FileLimitCountConfig, SecretDetectionConfig, BranchProtectionConfig, ToolRestrictionConfig, CostCeilingConfig, Backend } from "@agentops/core";
import { getDb, insertRun, updateRun, getRun, insertSession, updateSession, insertEvent, listPolicies, updateRunSummary } from "@agentops/db";
import { getCurrentRepo, getCurrentBranch, getChangedFiles, getWorkingTreeDiff } from "../git.js";
import { readSessionUsage, transcriptPath, ZERO_USAGE, detectBackend, type SessionUsage } from "../transcript.js";

// ─── Stdin helper ─────────────────────────────────────────────────────────────

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    process.stdin.on("error", reject);
    // If stdin is already ended (piped and closed), handle gracefully
    if (process.stdin.readableEnded) {
      resolve(Buffer.concat(chunks).toString("utf-8"));
    }
  });
}

// ─── State file helpers ───────────────────────────────────────────────────────

export interface HookState {
  runId: string;
  sessionId: string;
  dbPath: string;
  startTime: string;
  agentsSpawned: number;
  agentsCompleted: number;
  finalized: boolean;
  cwd?: string;
  backend?: Backend;
}

export function stateFilePath(claudeSessionId: string): string {
  return join(tmpdir(), `agentops-hook-${claudeSessionId}.json`);
}

function writeState(claudeSessionId: string, state: HookState): void {
  writeFileSync(stateFilePath(claudeSessionId), JSON.stringify(state), "utf-8");
}

function readState(claudeSessionId: string): HookState | null {
  const path = stateFilePath(claudeSessionId);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as HookState;
  } catch {
    return null;
  }
}

function cleanupState(claudeSessionId: string): void {
  const path = stateFilePath(claudeSessionId);
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    // Ignore cleanup errors
  }
}

// ─── Stdin JSON shape from Claude Code ────────────────────────────────────────

interface HookInput {
  session_id: string;
  cwd?: string;
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: Record<string, unknown>;
  agent_id?: string;
  agent_type?: string;
  agent_transcript_path?: string;
  tool_use_id?: string;
}

// ─── Stale state detection ───────────────────────────────────────────────────

function handleStaleState(sessionId: string, state: HookState): void {
  process.stderr.write(
    `[agentops] Stale session detected (database was reset). Restart Claude Code to begin tracking.\n`,
  );
  cleanupState(sessionId);
}

// ─── Tool-to-action mapping ──────────────────────────────────────────────────

function mapToolToAction(input: HookInput): Action {
  const toolName = input.tool_name ?? "unknown";
  const toolInput = input.tool_input ?? {};
  const toolOutput = input.tool_response
    ? JSON.stringify(input.tool_response).slice(0, 2000)
    : "";
  const timestamp = new Date().toISOString();

  const toolCall: ToolCall = {
    name: toolName,
    input: toolInput,
    output: toolOutput,
    timestamp,
  };

  const fileEdits: FileEdit[] = [];
  const commands: CmdType[] = [];

  if (toolName === "Bash" && typeof toolInput["command"] === "string") {
    commands.push({
      command: toolInput["command"] as string,
      exitCode: 0,
      stdout: toolOutput.slice(0, 10000),
      stderr: "",
      timestamp,
    });
  }

  if ((toolName === "Edit" || toolName === "Write") && typeof toolInput["file_path"] === "string") {
    fileEdits.push({
      path: toolInput["file_path"] as string,
      diff: "",
      timestamp,
    });
  }

  return {
    id: createActionId(`action_${Date.now()}`),
    toolCalls: [toolCall],
    fileEdits,
    commands,
    timestamp,
  };
}

// ─── Pre-tool-use policy checking ────────────────────────────────────────────

interface PolicyViolation {
  policy: string;
  message: string;
  severity: string;
}

interface GuardContext {
  editedFiles?: ReadonlySet<string>;
  branch?: string;
  cumulativeCostUsd?: number;
}

function checkPreToolPolicies(
  input: HookInput,
  activePolicies: ReadonlyArray<Policy & { enabled: boolean }>,
  context?: GuardContext,
): PolicyViolation[] {
  const violations: PolicyViolation[] = [];
  const toolName = input.tool_name ?? "";
  const toolInput = input.tool_input ?? {};

  // Known policy types for skipping deprecated/unknown types
  const knownTypes = new Set(Object.values(PolicyType) as string[]);

  for (const policy of activePolicies) {
    if (!policy.enabled) continue;

    // Skip unknown/deprecated policy types gracefully
    if (!knownTypes.has(policy.config.type as string)) continue;

    if (
      policy.config.type === PolicyType.RiskyOpFlag &&
      toolName === "Bash" &&
      typeof toolInput["command"] === "string"
    ) {
      const cmd = toolInput["command"] as string;
      const flagged = policy.config.riskyPatterns.filter((pattern) =>
        cmd.includes(pattern),
      );
      if (flagged.length > 0) {
        violations.push({
          policy: policy.name,
          message: `Risky operation detected: ${flagged.join(", ")} in command "${cmd}"`,
          severity: policy.severity,
        });
      }
    }

    if (
      policy.config.type === PolicyType.PathRestriction &&
      (toolName === "Edit" || toolName === "Write") &&
      typeof toolInput["file_path"] === "string"
    ) {
      const filePath = toolInput["file_path"] as string;
      const blocked = policy.config.blockedPaths.filter((p) =>
        filePath.startsWith(p),
      );
      if (blocked.length > 0) {
        violations.push({
          policy: policy.name,
          message: `Path restriction violated: ${filePath} matches blocked path(s): ${blocked.join(", ")}`,
          severity: policy.severity,
        });
      }
    }

    if (
      policy.config.type === PolicyType.FileLimitCount &&
      (toolName === "Edit" || toolName === "Write") &&
      typeof toolInput["file_path"] === "string"
    ) {
      const filePath = toolInput["file_path"] as string;
      const config = policy.config as FileLimitCountConfig;
      const currentFiles = context?.editedFiles ?? new Set<string>();
      // If this file is already in the set, it won't increase the count
      if (!currentFiles.has(filePath) && currentFiles.size >= config.maxFiles) {
        violations.push({
          policy: policy.name,
          message: `File limit exceeded: editing "${filePath}" would be file ${currentFiles.size + 1}, limit is ${config.maxFiles}`,
          severity: policy.severity,
        });
      }
    }

    if (
      policy.config.type === PolicyType.SecretDetection &&
      (toolName === "Write" || toolName === "Edit")
    ) {
      const content = toolName === "Write"
        ? (typeof toolInput["content"] === "string" ? toolInput["content"] as string : "")
        : (typeof toolInput["new_string"] === "string" ? toolInput["new_string"] as string : "");

      if (content) {
        const config = policy.config as SecretDetectionConfig;
        const matched: string[] = [];
        for (const pattern of config.patterns) {
          const re = new RegExp(pattern);
          if (re.test(content)) {
            matched.push(pattern);
          }
        }
        if (matched.length > 0) {
          violations.push({
            policy: policy.name,
            message: `Secret pattern(s) detected: ${matched.join(", ")}`,
            severity: policy.severity,
          });
        }
      }
    }

    if (
      policy.config.type === PolicyType.BranchProtection &&
      (toolName === "Write" || toolName === "Edit" || toolName === "Bash")
    ) {
      const branch = context?.branch;
      if (branch) {
        const config = policy.config as BranchProtectionConfig;
        if (config.protectedBranches.some((b) => b === branch)) {
          violations.push({
            policy: policy.name,
            message: `Mutation on protected branch "${branch}"`,
            severity: policy.severity,
          });
        }
      }
    }

    if (policy.config.type === PolicyType.ToolRestriction) {
      const config = policy.config as ToolRestrictionConfig;
      if (config.allowedTools) {
        if (!config.allowedTools.includes(toolName)) {
          violations.push({
            policy: policy.name,
            message: `Tool "${toolName}" is not in the allowed list`,
            severity: policy.severity,
          });
        }
      } else if (config.blockedTools) {
        if (config.blockedTools.includes(toolName)) {
          violations.push({
            policy: policy.name,
            message: `Tool "${toolName}" is blocked by policy`,
            severity: policy.severity,
          });
        }
      }
    }

    if (policy.config.type === PolicyType.CostCeiling) {
      const config = policy.config as CostCeilingConfig;
      const cost = context?.cumulativeCostUsd ?? 0;
      if (cost >= config.maxUsd) {
        violations.push({
          policy: policy.name,
          message: `Cost ceiling reached: $${cost.toFixed(2)} spent, limit is $${config.maxUsd.toFixed(2)}`,
          severity: policy.severity,
        });
      }
    }
  }

  return violations;
}

// ─── Event handlers ──────────────────────────────────────────────────────────

async function handleSessionStart(input: HookInput, dbPath?: string): Promise<void> {
  const db = getDb(dbPath);
  const cwd = input.cwd ?? process.cwd();

  // Auto-detect repo/branch from cwd
  const repo = getCurrentRepo();
  const branch = getCurrentBranch();

  // Create session
  let session = createSession(`claude-code-${input.session_id}`, {
    claudeSessionId: input.session_id,
    cwd,
  });
  session = activateSession(session);

  // Create and start run
  let run = createRun(
    {
      humanReadable: `Claude Code session in ${cwd}`,
      structured: {
        type: "claude-code-hook",
        description: `Claude Code session in ${cwd}`,
        parameters: { cwd, claudeSessionId: input.session_id },
      },
    },
    {
      repo,
      branch,
      permissions: [],
      sandbox: { enabled: false, isolationLevel: "none" },
    },
  );
  run = startRun(run);

  // Assign run to session
  session = assignRun(session, run.id);

  // Persist to DB
  insertSession(db, session);
  insertRun(db, run);

  // Emit run.started event
  insertEvent(
    db,
    createEvent(EventCategory.Run, EVENT_TYPES["run.started"], run.id as string, {
      goal: run.goal.humanReadable,
      repo,
      branch,
      claudeSessionId: input.session_id,
    }),
  );

  // Write state file for subsequent hook calls
  const resolvedDbPath = dbPath ?? "";
  writeState(input.session_id, {
    runId: run.id as string,
    sessionId: session.id as string,
    dbPath: resolvedDbPath,
    startTime: new Date().toISOString(),
    agentsSpawned: 0,
    agentsCompleted: 0,
    finalized: false,
    cwd,
    backend: detectBackend(),
  });
}

async function handlePreToolUse(input: HookInput, dbPath?: string): Promise<void> {
  const state = readState(input.session_id);
  if (!state) {
    // No session state — silently allow
    process.exit(0);
  }

  const db = getDb(state.dbPath || dbPath || undefined);

  // Load active policies
  const activePolicies = listPolicies(db, { enabled: true });

  // Read transcript usage if any CostCeiling policy is enabled
  const hasCostPolicy = activePolicies.some(
    (p) => p.config.type === PolicyType.CostCeiling,
  );
  const cwd = state.cwd ?? input.cwd;
  const backend = state.backend ?? detectBackend();
  let usage: SessionUsage = ZERO_USAGE;
  if (hasCostPolicy && cwd) {
    usage = readSessionUsage(transcriptPath(cwd, input.session_id), backend);
  }

  // Build guard context from current run
  const currentRun = getRun(db, state.runId as any);
  const context: GuardContext = {
    editedFiles: currentRun
      ? new Set(currentRun.actions.flatMap((a) => a.fileEdits.map((e) => e.path)))
      : undefined,
    branch: currentRun?.environment.branch,
    cumulativeCostUsd: usage.totalCostUsd,
  };

  // Check policies
  const violations = checkPreToolPolicies(input, activePolicies, context);

  // Check for error-severity violations that should block
  const errorViolations = violations.filter((v) => v.severity === PolicySeverity.Error);

  if (errorViolations.length > 0) {
    // Emit policy.violated event
    insertEvent(
      db,
      createEvent(EventCategory.Policy, EVENT_TYPES["policy.violated"], state.runId, {
        toolName: input.tool_name,
        toolInput: input.tool_input,
        violations: errorViolations,
      }),
    );

    // Output block response and exit 2
    const reason = errorViolations.map((v) => `[${v.policy}] ${v.message}`).join("; ");
    process.stdout.write(JSON.stringify({ decision: "block", reason }));
    process.exit(2);
  }

  // Warnings — print to stderr (not stdout) so Claude Code doesn't interpret as block
  const warnings = violations.filter((v) => v.severity !== PolicySeverity.Error);
  if (warnings.length > 0) {
    for (const w of warnings) {
      process.stderr.write(`[agentops warning] ${w.policy}: ${w.message}\n`);
    }
  }

  // Allow — exit 0 silently
  process.exit(0);
}

async function handlePostToolUse(input: HookInput, dbPath?: string): Promise<void> {
  const state = readState(input.session_id);
  if (!state) {
    process.exit(0);
  }

  const db = getDb(state.dbPath || dbPath || undefined);

  // Get current run
  const run = getRun(db, state.runId as any);
  if (!run) {
    handleStaleState(input.session_id, state);
    process.exit(0);
  }

  // Map tool call to action and add to run
  const action = mapToolToAction(input);
  const updatedRun = addAction(run, action);

  // Persist updated run
  updateRun(db, updatedRun.id, {
    actions: updatedRun.actions,
    updatedAt: updatedRun.updatedAt,
  });

  // Emit action.taken event
  const actionPayload: Record<string, unknown> = {
    toolName: input.tool_name,
    toolInput: input.tool_input ? Object.keys(input.tool_input) : [],
  };
  if (input.tool_use_id) {
    actionPayload.toolUseId = input.tool_use_id;
  }
  insertEvent(
    db,
    createEvent(EventCategory.Action, EVENT_TYPES["action.taken"], state.runId, actionPayload),
  );

  process.exit(0);
}

// ─── Shared finalization logic ───────────────────────────────────────────────

async function finalizeSession(input: HookInput, state: HookState, dbPath?: string): Promise<void> {
  const db = getDb(state.dbPath || dbPath || undefined);

  // Get current run
  let run = getRun(db, state.runId as any);
  if (!run) {
    handleStaleState(input.session_id, state);
    return;
  }

  // Skip if run is already completed/failed
  if (run.status === "completed" || run.status === "failed") {
    cleanupState(input.session_id);
    return;
  }

  // Compute git diff (changed files since session start)
  const changedFiles = getChangedFiles();
  const diff = getWorkingTreeDiff();

  // Add diff as artifact
  if (diff) {
    run = addArtifact(run, {
      id: createArtifactId(`artifact_${Date.now()}`),
      diffs: [diff],
      logs: [],
      testOutputs: [],
      reports: [],
    });
  }

  // Compute wall time
  const wallTimeMs = Date.now() - new Date(state.startTime).getTime();

  // Read final cost/token usage from transcript
  const cwd = state.cwd ?? input.cwd;
  const backend = state.backend ?? detectBackend();
  const usage: SessionUsage = cwd
    ? readSessionUsage(transcriptPath(cwd, input.session_id), backend)
    : ZERO_USAGE;

  // Update metrics
  run = {
    ...run,
    metrics: {
      ...run.metrics,
      wallTimeMs,
      costUsd: usage.totalCostUsd,
      tokenUsage: {
        input: usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens,
        output: usage.outputTokens,
        total:
          usage.inputTokens +
          usage.cacheReadTokens +
          usage.cacheWriteTokens +
          usage.outputTokens,
      },
    },
  };

  // Evaluate policies before completing the run
  const activePolicies = listPolicies(db, { enabled: true });
  const engine = new PolicyEngine();
  const policyResults = engine.evaluate(run, activePolicies);
  const policyChecks = policyResults.map(r => ({
    policyId: r.policy.id,
    passed: r.passed,
    message: r.message,
  }));

  // Complete the run with real policy checks
  run = completeRun(run, {
    testResults: [],
    policyChecks,
    confidenceScore: 0,
  });

  // Persist final state
  updateRun(db, run.id, {
    status: run.status,
    actions: run.actions,
    artifacts: run.artifacts,
    metrics: run.metrics,
    evaluations: run.evaluations,
    decisions: run.decisions,
    updatedAt: run.updatedAt,
  });

  // Run scoring and generate summary (reuse activePolicies/policyResults)
  const score = computeScore(run, activePolicies);
  const summary = generateSummary(run, run.metrics, policyResults, score, undefined, backend);
  updateRunSummary(db, run.id, summary);

  // Emit run.completed event
  insertEvent(
    db,
    createEvent(EventCategory.Run, EVENT_TYPES["run.completed"], state.runId, {
      wallTimeMs,
      filesChanged: changedFiles.length,
      actionsCount: run.actions.length,
    }),
  );

  // Terminate session
  let session = (await import("@agentops/db")).getSession(db, state.sessionId as any);
  if (session) {
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
      createEvent(EventCategory.Session, EVENT_TYPES["session.terminated"], state.sessionId, {
        wallTimeMs,
        completedRuns: session.completedRunIds.length,
      }),
    );
  }

  // Mark as finalized and clean up state file
  writeState(input.session_id, { ...state, finalized: true });
  cleanupState(input.session_id);
}

// ─── Stop handler (fires after every Claude response) ────────────────────────

async function handleStop(input: HookInput, _dbPath?: string): Promise<void> {
  // Stop fires after every Claude response within a session — it is NOT a
  // reliable "session ended" signal. We do not finalize here; SessionEnd
  // is the sole finalization path. This handler exists only to acknowledge
  // the event and exit cleanly so Claude Code is not blocked.
  const state = readState(input.session_id);
  if (!state) {
    process.exit(0);
  }
  process.exit(0);
}

// ─── SessionEnd handler (backup — may not always fire) ───────────────────────

async function handleSessionEnd(input: HookInput, dbPath?: string): Promise<void> {
  const state = readState(input.session_id);
  if (!state) {
    process.exit(0);
  }

  // If already finalized by Stop handler, just clean up
  if (state.finalized) {
    cleanupState(input.session_id);
    process.exit(0);
  }

  // Finalize now — this is our last chance
  await finalizeSession(input, state, dbPath);

  process.exit(0);
}

// ─── Sub-agent lifecycle handlers ────────────────────────────────────────────

async function handleSubagentStart(input: HookInput, dbPath?: string): Promise<void> {
  const state = readState(input.session_id);
  if (!state) {
    process.exit(0);
  }

  const db = getDb(state.dbPath || dbPath || undefined);

  // Check run still exists
  const run = getRun(db, state.runId as any);
  if (!run) {
    handleStaleState(input.session_id, state);
    process.exit(0);
  }

  // Increment spawned agent count
  const updatedState = { ...state, agentsSpawned: (state.agentsSpawned ?? 0) + 1 };
  writeState(input.session_id, updatedState);

  // Emit agent.spawned event
  insertEvent(
    db,
    createEvent(EventCategory.Agent, EVENT_TYPES["agent.spawned"], state.runId, {
      agentId: input.agent_id,
      agentType: input.agent_type,
      sessionId: state.sessionId,
      claudeSessionId: input.session_id,
    }),
  );

  process.exit(0);
}

async function handleSubagentStop(input: HookInput, dbPath?: string): Promise<void> {
  const state = readState(input.session_id);
  if (!state) {
    process.exit(0);
  }

  const db = getDb(state.dbPath || dbPath || undefined);

  // Check run still exists
  const runCheck = getRun(db, state.runId as any);
  if (!runCheck) {
    handleStaleState(input.session_id, state);
    process.exit(0);
  }

  // Increment completed agent count
  const updatedState = { ...state, agentsCompleted: (state.agentsCompleted ?? 0) + 1 };
  writeState(input.session_id, updatedState);

  // If transcript path is provided, attempt to read and extract tool calls
  const extractedActions: Action[] = [];
  if (input.agent_transcript_path) {
    try {
      if (existsSync(input.agent_transcript_path)) {
        const transcriptRaw = readFileSync(input.agent_transcript_path, "utf-8");
        const lines = transcriptRaw.split("\n").filter((line) => line.trim().length > 0);
        for (const line of lines) {
          try {
            const entry = JSON.parse(line) as Record<string, unknown>;
            if (entry.type === "tool_use" || entry.tool_name) {
              const toolCall: ToolCall = {
                name: (entry.tool_name as string) ?? (entry.name as string) ?? "unknown",
                input: (entry.tool_input as Record<string, unknown>) ?? (entry.input as Record<string, unknown>) ?? {},
                output: typeof entry.output === "string" ? entry.output : JSON.stringify(entry.output ?? "").slice(0, 2000),
                timestamp: (entry.timestamp as string) ?? new Date().toISOString(),
              };
              extractedActions.push({
                id: createActionId(`action_subagent_${Date.now()}_${extractedActions.length}`),
                toolCalls: [toolCall],
                fileEdits: [],
                commands: [],
                timestamp: toolCall.timestamp,
              });
            }
          } catch {
            // Skip unparseable lines
          }
        }
      }
    } catch {
      // Don't fail if transcript can't be read
    }
  }

  // Persist extracted actions to the run
  if (extractedActions.length > 0) {
    let run = getRun(db, state.runId as any);
    if (run) {
      for (const action of extractedActions) {
        run = addAction(run, action);
      }
      updateRun(db, run.id, {
        actions: run.actions,
        updatedAt: run.updatedAt,
      });
    }
  }

  // Emit agent.completed event
  insertEvent(
    db,
    createEvent(EventCategory.Agent, EVENT_TYPES["agent.completed"], state.runId, {
      agentId: input.agent_id,
      agentType: input.agent_type,
      sessionId: state.sessionId,
      claudeSessionId: input.session_id,
      extractedActionsCount: extractedActions.length,
    }),
  );

  process.exit(0);
}

// ─── Command registration ───────────────────────────────────────────────────

export function registerHookCommand(program: Command): void {
  const hook = program
    .command("hook")
    .description("Handle Claude Code hook events (session-start, stop, pre-tool-use, post-tool-use, session-end, subagent-start, subagent-stop)");

  hook
    .command("session-start")
    .description("Called when Claude Code starts a session")
    .action(async () => {
      const dbPath = program.opts()["dbPath"] as string | undefined;
      const raw = await readStdin();
      try {
        const input = JSON.parse(raw) as HookInput;
        await handleSessionStart(input, dbPath);
      } catch (error) {
        if (error instanceof SyntaxError) {
          console.error(`AgentOps hook: invalid JSON input: ${error.message}`);
        } else {
          console.error(`AgentOps hook error: ${error}`);
        }
        process.exit(1);
      }
    });

  hook
    .command("pre-tool-use")
    .description("Called before every tool call (can block with exit code 2)")
    .action(async () => {
      const dbPath = program.opts()["dbPath"] as string | undefined;
      const raw = await readStdin();
      try {
        const input = JSON.parse(raw) as HookInput;
        await handlePreToolUse(input, dbPath);
      } catch (error) {
        if (error instanceof SyntaxError) {
          console.error(`AgentOps hook: invalid JSON input: ${error.message}`);
        } else {
          console.error(`AgentOps hook error: ${error}`);
        }
        process.exit(1);
      }
    });

  hook
    .command("post-tool-use")
    .description("Called after every tool call")
    .action(async () => {
      const dbPath = program.opts()["dbPath"] as string | undefined;
      const raw = await readStdin();
      try {
        const input = JSON.parse(raw) as HookInput;
        await handlePostToolUse(input, dbPath);
      } catch (error) {
        if (error instanceof SyntaxError) {
          console.error(`AgentOps hook: invalid JSON input: ${error.message}`);
        } else {
          console.error(`AgentOps hook error: ${error}`);
        }
        process.exit(1);
      }
    });

  hook
    .command("stop")
    .description("Called when Claude finishes a response (reliable session completion)")
    .action(async () => {
      const dbPath = program.opts()["dbPath"] as string | undefined;
      const raw = await readStdin();
      try {
        const input = JSON.parse(raw) as HookInput;
        await handleStop(input, dbPath);
      } catch (error) {
        if (error instanceof SyntaxError) {
          console.error(`AgentOps hook: invalid JSON input: ${error.message}`);
        } else {
          console.error(`AgentOps hook error: ${error}`);
        }
        process.exit(1);
      }
    });

  hook
    .command("session-end")
    .description("Called when Claude Code session ends (backup — may not always fire)")
    .action(async () => {
      const dbPath = program.opts()["dbPath"] as string | undefined;
      const raw = await readStdin();
      try {
        const input = JSON.parse(raw) as HookInput;
        await handleSessionEnd(input, dbPath);
      } catch (error) {
        if (error instanceof SyntaxError) {
          console.error(`AgentOps hook: invalid JSON input: ${error.message}`);
        } else {
          console.error(`AgentOps hook error: ${error}`);
        }
        process.exit(1);
      }
    });

  hook
    .command("subagent-start")
    .description("Called when a sub-agent is spawned")
    .action(async () => {
      const dbPath = program.opts()["dbPath"] as string | undefined;
      const raw = await readStdin();
      try {
        const input = JSON.parse(raw) as HookInput;
        await handleSubagentStart(input, dbPath);
      } catch (error) {
        if (error instanceof SyntaxError) {
          console.error(`AgentOps hook: invalid JSON input: ${error.message}`);
        } else {
          console.error(`AgentOps hook error: ${error}`);
        }
        process.exit(1);
      }
    });

  hook
    .command("subagent-stop")
    .description("Called when a sub-agent completes")
    .action(async () => {
      const dbPath = program.opts()["dbPath"] as string | undefined;
      const raw = await readStdin();
      try {
        const input = JSON.parse(raw) as HookInput;
        await handleSubagentStop(input, dbPath);
      } catch (error) {
        if (error instanceof SyntaxError) {
          console.error(`AgentOps hook: invalid JSON input: ${error.message}`);
        } else {
          console.error(`AgentOps hook error: ${error}`);
        }
        process.exit(1);
      }
    });
}

// ─── Exports for testing ────────────────────────────────────────────────────

export {
  readState as _readState,
  writeState as _writeState,
  cleanupState as _cleanupState,
  checkPreToolPolicies as _checkPreToolPolicies,
  mapToolToAction as _mapToolToAction,
  finalizeSession as _finalizeSession,
  handleSessionStart as _handleSessionStart,
  handlePreToolUse as _handlePreToolUse,
  handlePostToolUse as _handlePostToolUse,
  handleStop as _handleStop,
  handleSessionEnd as _handleSessionEnd,
  handleSubagentStart as _handleSubagentStart,
  handleSubagentStop as _handleSubagentStop,
};
export type { HookInput, GuardContext };
