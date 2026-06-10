import { Command } from "commander";
import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync, chmodSync, statSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import {
  createActionId,
  PolicySeverity,
  evaluatePreToolPolicies,
} from "@agentops/core";
import type {
  Action,
  ToolCall,
  FileEdit,
  Command as CmdType,
  Policy,
  Backend,
  GuardContext,
  PolicyViolation,
} from "@agentops/core";
import { getCurrentRepo, getCurrentBranch, getChangedFiles, getWorkingTreeDiff } from "../git.js";
import { readSessionUsage, transcriptPath, ZERO_USAGE, detectBackend, type SessionUsage } from "../transcript.js";
import { createOps, resolveOpsConfig, isSdkMode, SdkError } from "../hook-ops.js";
import { log } from "../log.js";

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
  // When set, this session was created in SDK mode against this dashboard.
  // Subsequent hook events re-resolve credentials but lock the server URL
  // for the duration of the session.
  serverUrl?: string;
}

// State files live under ~/.agentops/state/ (not /tmp). /tmp is shared across
// users on multi-user systems and the filename is predictable from the Claude
// session id — a hostile local user could pre-create the path as a symlink to
// a target file before our writeFileSync clobbers it. Confining state to a
// user-private directory with mode 0700 closes that.
function stateDir(): string {
  return join(homedir(), ".agentops", "state");
}

export function stateFilePath(claudeSessionId: string): string {
  // Sanitize the session id to prevent path traversal from a malicious stdin.
  const safe = claudeSessionId.replace(/[^A-Za-z0-9._-]/g, "_");
  return join(stateDir(), `${safe}.json`);
}

function writeState(claudeSessionId: string, state: HookState): void {
  const dir = stateDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  const path = stateFilePath(claudeSessionId);
  writeFileSync(path, JSON.stringify(state), { encoding: "utf-8", mode: 0o600 });
  // chmod in case the file already existed with looser perms.
  try {
    chmodSync(path, 0o600);
  } catch {
    // Best-effort; not all filesystems support chmod.
  }
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

// ─── Fail-closed enforcement ─────────────────────────────────────────────────
//
// Default behavior is fail-open: when the SDK can't reach the dashboard or
// the token is rejected, the hook logs and allows the tool. This is the
// dev-friendly default — we never want AgentOps to brick a working session.
//
// AGENTOPS_FAIL_CLOSED=1 flips this for production: any inability to verify
// the call blocks the tool. The block message contains the recovery
// instruction so a confused operator can unset the flag and keep working.

function isFailClosed(): boolean {
  const v = process.env["AGENTOPS_FAIL_CLOSED"]?.trim().toLowerCase();
  return v === "1" || v === "true";
}

function emitOfflineBlock(reason: string): void {
  const blockReason =
    `AgentOps enforcement is offline (${reason}). ` +
    `Run 'agentops login' to restore enforcement, ` +
    `or unset AGENTOPS_FAIL_CLOSED to allow tools while offline.`;
  process.stdout.write(JSON.stringify({ decision: "block", reason: blockReason }));
}

function emitOfflineWarning(context: string): void {
  process.stderr.write(
    `[agentops] ⚠ ENFORCEMENT OFFLINE — ${context}. ` +
      `Set AGENTOPS_FAIL_CLOSED=1 to block tools while offline, ` +
      `or run 'agentops login' to restore.\n`,
  );
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
// Implementation lives in @agentops/core. This wrapper adapts the HookInput
// shape (Claude Code's stdin payload) to the ToolInvocation shape that the
// core function consumes. Same wrapper is used by the SDK server route.

function checkPreToolPolicies(
  input: HookInput,
  activePolicies: ReadonlyArray<Policy & { enabled: boolean }>,
  context?: GuardContext,
): PolicyViolation[] {
  return evaluatePreToolPolicies(
    { toolName: input.tool_name ?? "", toolInput: input.tool_input ?? {} },
    activePolicies,
    context,
  );
}

// ─── Event handlers ──────────────────────────────────────────────────────────
//
// Handlers delegate to a HookOps (direct-SQLite or SDK-over-HTTP, decided
// at session-start). Once a session has a state file with serverUrl set
// (or unset for direct), subsequent events reuse that mode — credentials
// are re-resolved from disk each fire (so logging out invalidates active
// sessions), but the dashboard URL is locked.

function logSdkFailure(op: string, err: unknown): void {
  const detail = err instanceof Error ? err.message : String(err);
  // Structured trail goes to the log file.
  log.error({
    msg: "sdk_call_failed",
    op,
    err: detail,
    ...(err instanceof SdkError ? { status: err.status } : {}),
  });
  // Human-readable hint goes to stderr (Claude Code surfaces this).
  process.stderr.write(`[agentops] ${op} failed: ${detail}\n`);
  if (err instanceof SdkError && (err.status === 401 || err.status === 403)) {
    process.stderr.write(
      `[agentops] Token may be invalid or revoked. Run: agentops login\n`,
    );
  }
}

async function handleSessionStart(input: HookInput, dbPath?: string): Promise<void> {
  const cwd = input.cwd ?? process.cwd();
  // Pass cwd to git lookups — Claude Code's hook subprocess inherits
  // the launcher's cwd which may not be the user's working repo.
  const repo = getCurrentRepo(cwd);
  const branch = getCurrentBranch(cwd);

  const config = resolveOpsConfig(dbPath);
  const ops = createOps(config, input.session_id);

  let runId: string;
  let sessionId: string;
  try {
    const r = await ops.startSessionAndRun({
      claudeSessionId: input.session_id,
      cwd,
      repo,
      branch,
    });
    runId = r.runId;
    sessionId = r.sessionId;
  } catch (err) {
    logSdkFailure("session start", err);
    if (isFailClosed()) {
      // Fail-closed: surface a block decision so the very first tool call
      // can't slip through before PreToolUse runs. PreToolUse will also
      // block on the missing state file, but emitting here makes the
      // failure visible immediately to the operator.
      emitOfflineBlock("session start failed — no run was created");
      process.exit(2);
    }
    // Fail-open default: log and return without writing state. Subsequent
    // hooks for this session will see no state file and silently allow —
    // we never want AgentOps to break a developer's Claude Code session.
    return;
  }

  const mode = isSdkMode(config) ? "sdk" : "local";
  writeState(input.session_id, {
    runId,
    sessionId,
    dbPath: config.dbPath ?? "",
    ...(isSdkMode(config) ? { serverUrl: config.serverUrl } : {}),
    startTime: new Date().toISOString(),
    agentsSpawned: 0,
    agentsCompleted: 0,
    finalized: false,
    cwd,
    backend: detectBackend(),
  });

  log.info({
    msg: "session_started",
    sessionId,
    runId,
    mode,
    cwd,
    repo,
    branch,
    claudeSessionId: input.session_id,
  });
}

async function handlePreToolUse(input: HookInput, dbPath?: string): Promise<void> {
  const state = readState(input.session_id);
  if (!state) {
    if (isFailClosed()) {
      emitOfflineBlock(
        "no active session state — session-start did not complete",
      );
      process.exit(2);
    }
    // No session state, fail-open. Warn loudly in BOTH sdk and local mode so
    // the operator knows enforcement isn't running for this tool call — the
    // only other hint is session-start's stderr line, which can scroll away.
    emitOfflineWarning(
      `no session state for tool ${input.tool_name ?? "?"} (session-start may have failed; policy enforcement is OFF)`,
    );
    process.exit(0);
  }

  // Transcript reading is always local: the .jsonl lives on this machine.
  // We compute cumulative cost client-side and pass it to the ops layer;
  // the server (in SDK mode) trusts our number, the local DB uses it the
  // same way.
  const cwd = state.cwd ?? input.cwd;
  const backend = state.backend ?? detectBackend();
  const usage: SessionUsage = cwd
    ? readSessionUsage(transcriptPath(cwd, input.session_id), backend)
    : ZERO_USAGE;

  const ops = createOps(opsConfigFromState(state, dbPath), input.session_id);

  let decision: { decision: "allow" | "block"; reason?: string; warnings: ReadonlyArray<PolicyViolation> };
  try {
    decision = await ops.checkPolicy({
      runId: state.runId,
      toolName: input.tool_name ?? "",
      toolInput: input.tool_input ?? {},
      cumulativeCostUsd: usage.totalCostUsd,
    });
  } catch (err) {
    logSdkFailure("policy check", err);
    if (isFailClosed()) {
      const reason = err instanceof Error ? err.message : String(err);
      emitOfflineBlock(`policy check failed: ${reason}`);
      process.exit(2);
    }
    // Fail-open default: better to skip enforcement on a transient server
    // hiccup than to brick the developer's Claude Code session.
    process.exit(0);
  }

  if (decision.decision === "block") {
    const reason = decision.reason ?? "Policy violation";
    log.warn({
      msg: "policy_blocked",
      sessionId: state.sessionId,
      runId: state.runId,
      toolName: input.tool_name ?? "",
      reason,
      claudeSessionId: input.session_id,
    });
    process.stdout.write(JSON.stringify({ decision: "block", reason }));
    process.exit(2);
  }

  // Warnings → stderr (not stdout, so Claude Code doesn't interpret as block)
  for (const w of decision.warnings) {
    process.stderr.write(`[agentops warning] ${w.policy}: ${w.message}\n`);
  }
  process.exit(0);
}

async function handlePostToolUse(input: HookInput, dbPath?: string): Promise<void> {
  const state = readState(input.session_id);
  if (!state) {
    process.exit(0);
  }

  const action = mapToolToAction(input);
  const ops = createOps(opsConfigFromState(state, dbPath), input.session_id);

  try {
    await ops.reportAction(state.runId, action);
  } catch (err) {
    logSdkFailure("report action", err);
  }
  process.exit(0);
}

// Derive an OpsConfig from a stored state file. If state.serverUrl is set,
// we're in SDK mode for the rest of this session; otherwise direct-SQLite
// against the dbPath captured at session-start.
function opsConfigFromState(state: HookState, dbPath?: string) {
  const config = resolveOpsConfig(state.dbPath || dbPath);
  if (state.serverUrl) {
    return {
      ...config,
      serverUrl: state.serverUrl,
    };
  }
  // Explicit direct mode — strip any serverUrl that snuck in from env.
  return { dbPath: state.dbPath || dbPath || config.dbPath };
}

// ─── Shared finalization logic ───────────────────────────────────────────────

async function finalizeSession(input: HookInput, state: HookState, dbPath?: string): Promise<void> {
  const ops = createOps(opsConfigFromState(state, dbPath), input.session_id);

  // Compute wall time + git diff locally — both are on this machine.
  const changedFiles = getChangedFiles();
  const diff = getWorkingTreeDiff();
  const wallTimeMs = Date.now() - new Date(state.startTime).getTime();

  // Read final cost/token usage from the local transcript.
  const cwd = state.cwd ?? input.cwd;
  const backend = state.backend ?? detectBackend();
  const usage: SessionUsage = cwd
    ? readSessionUsage(transcriptPath(cwd, input.session_id), backend)
    : ZERO_USAGE;

  const metrics = {
    tokenUsage: {
      input: usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens,
      output: usage.outputTokens,
      total:
        usage.inputTokens +
        usage.cacheReadTokens +
        usage.cacheWriteTokens +
        usage.outputTokens,
    },
    wallTimeMs,
    costUsd: usage.totalCostUsd,
    flakeRate: 0,
    // backend + per-model cost are already computed above; persist them so the
    // dashboard can segment spend by backend (Bedrock vs direct) instead of
    // discarding the signal it just used to price the run.
    backend,
    byModel: usage.byModel,
  };

  let finalizeOk = true;
  try {
    await ops.finalizeRun({
      runId: state.runId,
      sessionId: state.sessionId,
      metrics,
      ...(diff ? { diff } : {}),
      changedFilesCount: changedFiles.length,
    });
  } catch (err) {
    finalizeOk = false;
    logSdkFailure("finalize run", err);
    // Continue to terminateSession + state cleanup; the run may be in a
    // partial state but we'd rather not leave a permanently-running row.
  }

  let terminateOk = true;
  try {
    await ops.terminateSession(state.sessionId);
  } catch (err) {
    terminateOk = false;
    logSdkFailure("terminate session", err);
  }

  log.info({
    msg: "session_ended",
    sessionId: state.sessionId,
    runId: state.runId,
    finalizeOk,
    terminateOk,
    costUsd: metrics.costUsd,
    wallTimeMs: metrics.wallTimeMs,
    filesChanged: changedFiles.length,
  });

  writeState(input.session_id, { ...state, finalized: true });
  cleanupState(input.session_id);
}

// ─── UserPromptSubmit handler (turn-boundary budget gate) ────────────────────
//
// Fires when the user submits a prompt, *before* Claude starts the next turn.
// PreToolUse only catches turns that use tools; chat-only turns (analysis,
// explanation, long pastes) can blow CostCeiling caps without ever firing
// PreToolUse. UserPromptSubmit closes that gap by re-reading the transcript
// and evaluating budget policies before the next turn is allowed to start.
//
// Block protocol matches PreToolUse: `{decision: "block", reason}` on stdout
// + exit code 2. Claude Code surfaces the reason to the user and refuses the
// prompt. Fail-open by default, honors AGENTOPS_FAIL_CLOSED.

async function handleUserPromptSubmit(input: HookInput, dbPath?: string): Promise<void> {
  const state = readState(input.session_id);
  if (!state) {
    if (isFailClosed()) {
      emitOfflineBlock(
        "no active session state — session-start did not complete",
      );
      process.exit(2);
    }
    if (isSdkMode(resolveOpsConfig(dbPath))) {
      emitOfflineWarning(
        "no session state for user prompt (session-start may have failed)",
      );
    }
    process.exit(0);
  }

  const cwd = state.cwd ?? input.cwd;
  const backend = state.backend ?? detectBackend();
  const usage: SessionUsage = cwd
    ? readSessionUsage(transcriptPath(cwd, input.session_id), backend)
    : ZERO_USAGE;

  const ops = createOps(opsConfigFromState(state, dbPath), input.session_id);

  let decision: { decision: "allow" | "block"; reason?: string; warnings: ReadonlyArray<PolicyViolation> };
  try {
    decision = await ops.checkBudget({
      runId: state.runId,
      cumulativeCostUsd: usage.totalCostUsd,
    });
  } catch (err) {
    logSdkFailure("budget check", err);
    if (isFailClosed()) {
      const reason = err instanceof Error ? err.message : String(err);
      emitOfflineBlock(`budget check failed: ${reason}`);
      process.exit(2);
    }
    process.exit(0);
  }

  if (decision.decision === "block") {
    const reason = decision.reason ?? "Budget exceeded";
    log.warn({
      msg: "budget_blocked",
      sessionId: state.sessionId,
      runId: state.runId,
      cumulativeCostUsd: usage.totalCostUsd,
      reason,
      claudeSessionId: input.session_id,
    });
    process.stdout.write(JSON.stringify({ decision: "block", reason }));
    process.exit(2);
  }

  for (const w of decision.warnings) {
    process.stderr.write(`[agentops warning] ${w.policy}: ${w.message}\n`);
  }
  process.exit(0);
}

// ─── Stop handler (fires after every Claude response) ────────────────────────
//
// Stop is NOT a session-end signal — that's SessionEnd's job. We don't
// finalize here. But Stop IS the only post-turn signal that fires when
// Claude finishes WITHOUT calling a tool (long chat answer, analysis-only,
// document Q&A), which is exactly where PreToolUse can't see the cost.
//
// So Stop reads the transcript-based cost and surfaces a stderr warning
// when the user is approaching a CostCeiling (default ≥80% of any cap)
// or has already crossed it. Stop never blocks — returning a block JSON
// from a Stop hook means "force Claude to continue", the opposite of
// what we want. Hard enforcement happens at UserPromptSubmit (next turn).
//
// Uses ops.evaluateBudget (read-only) so chat-heavy turns don't spam
// duplicate policy_result rows on every Stop fire.

async function handleStop(input: HookInput, dbPath?: string): Promise<void> {
  const state = readState(input.session_id);
  if (!state) {
    process.exit(0);
  }

  const cwd = state.cwd ?? input.cwd;
  const backend = state.backend ?? detectBackend();
  const usage: SessionUsage = cwd
    ? readSessionUsage(transcriptPath(cwd, input.session_id), backend)
    : ZERO_USAGE;

  const ops = createOps(opsConfigFromState(state, dbPath), input.session_id);

  let decision: { decision: "allow" | "block"; reason?: string; warnings: ReadonlyArray<PolicyViolation> };
  try {
    decision = await ops.evaluateBudget({
      runId: state.runId,
      cumulativeCostUsd: usage.totalCostUsd,
    });
  } catch (err) {
    // Stop is informational — never break the session on an eval
    // failure. Log and exit 0.
    logSdkFailure("budget evaluate (stop)", err);
    process.exit(0);
  }

  for (const w of decision.warnings) {
    process.stderr.write(`[agentops warning] ${w.policy}: ${w.message}\n`);
  }
  if (decision.decision === "block") {
    const reason = decision.reason ?? "Budget exceeded";
    process.stderr.write(
      `[agentops] ⚠ Budget exceeded — the next prompt will be blocked. ${reason}\n`,
    );
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

async function handleSubagentStart(input: HookInput, _dbPath?: string): Promise<void> {
  // SubagentStart is not a real Claude Code hook event (agentops setup
  // never registers it as of Phase 1). This handler stays for backwards
  // compat with manually-configured hooks but does nothing — there is no
  // event to record and no signal to update.
  const state = readState(input.session_id);
  if (!state) process.exit(0);
  process.exit(0);
}

async function handleSubagentStop(input: HookInput, dbPath?: string): Promise<void> {
  const state = readState(input.session_id);
  if (!state) {
    process.exit(0);
  }

  // Update local counter (informational; not used for any gate after
  // Phase 1's Stop-handler simplification).
  const updatedState = { ...state, agentsCompleted: (state.agentsCompleted ?? 0) + 1 };
  writeState(input.session_id, updatedState);

  // If a transcript path is provided, extract tool_use entries and report
  // them as actions. agent_transcript_path comes from stdin (untrusted) so
  // we confine the read to ~/.claude/projects/ and cap the file size.
  const MAX_TRANSCRIPT_BYTES = 16 * 1024 * 1024;
  const extractedActions: Action[] = [];
  if (input.agent_transcript_path) {
    const claudeProjectsRoot = join(homedir(), ".claude", "projects");
    const resolved = resolve(input.agent_transcript_path);
    if (resolved.startsWith(claudeProjectsRoot + sep)) {
      try {
        // Canonicalize symlinks (realpathSync throws on a missing path, which
        // the surrounding catch handles) and re-check containment so a symlink
        // inside ~/.claude/projects/ can't redirect the read outside it. Also
        // require a regular file.
        const realPath = realpathSync(resolved);
        if (realPath.startsWith(claudeProjectsRoot + sep)) {
          const stat = statSync(realPath);
          if (stat.isFile() && stat.size <= MAX_TRANSCRIPT_BYTES) {
            const raw = readFileSync(realPath, "utf-8");
            for (const line of raw.split("\n")) {
              if (line.trim().length === 0) continue;
              try {
                const entry = JSON.parse(line) as Record<string, unknown>;
                if (entry.type !== "tool_use" && !entry.tool_name) continue;
                const toolCall: ToolCall = {
                  name: (entry.tool_name as string) ?? (entry.name as string) ?? "unknown",
                  input:
                    (entry.tool_input as Record<string, unknown>) ??
                    (entry.input as Record<string, unknown>) ??
                    {},
                  output:
                    typeof entry.output === "string"
                      ? entry.output
                      : JSON.stringify(entry.output ?? "").slice(0, 2000),
                  timestamp: (entry.timestamp as string) ?? new Date().toISOString(),
                };
                extractedActions.push({
                  id: createActionId(
                    `action_subagent_${Date.now()}_${extractedActions.length}`,
                  ),
                  toolCalls: [toolCall],
                  fileEdits: [],
                  commands: [],
                  timestamp: toolCall.timestamp,
                });
              } catch {
                // Skip unparseable lines
              }
            }
          }
        }
      } catch {
        // Best-effort
      }
    }
  }

  if (extractedActions.length > 0) {
    const ops = createOps(opsConfigFromState(state, dbPath), input.session_id);
    for (const action of extractedActions) {
      try {
        await ops.reportAction(state.runId, action);
      } catch (err) {
        logSdkFailure("report subagent action", err);
        break; // stop on first failure to avoid spam
      }
    }
  }

  process.exit(0);
}

// ─── Command registration ───────────────────────────────────────────────────

export function registerHookCommand(program: Command): void {
  const hook = program
    .command("hook")
    .description("Handle Claude Code hook events (session-start, user-prompt-submit, stop, pre-tool-use, post-tool-use, session-end, subagent-start, subagent-stop)");

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
    .command("user-prompt-submit")
    .description("Called when the user submits a prompt (can block with exit code 2 — closes the chat-only enforcement gap)")
    .action(async () => {
      const dbPath = program.opts()["dbPath"] as string | undefined;
      const raw = await readStdin();
      try {
        const input = JSON.parse(raw) as HookInput;
        await handleUserPromptSubmit(input, dbPath);
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
  handleUserPromptSubmit as _handleUserPromptSubmit,
  handlePreToolUse as _handlePreToolUse,
  handlePostToolUse as _handlePostToolUse,
  handleStop as _handleStop,
  handleSessionEnd as _handleSessionEnd,
  handleSubagentStart as _handleSubagentStart,
  handleSubagentStop as _handleSubagentStop,
};
export type { HookInput, GuardContext };
